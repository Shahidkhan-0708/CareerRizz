import OpenAI from 'openai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../db/client.js';
import { getProfile } from '../db/profiles.js';
import { getEnrichmentResults } from '../db/enrichment.js';
import { runResearchSynchronously } from './research.service.js';
import { getOrCreateDefaultCampaign } from '../db/campaigns.js';
import {
  savePersonalization,
  getPersonalization,
  supersedePendingPersonalizations,
  listPersonalizations,
  updatePersonalizationStatus,
  addReviewDecision,
  getReviewDecisions,
  getProfilesReadyForPersonalization,
  getBulkStats,
} from '../db/personalization.js';
import { linkPersonalizationToOutreach } from '../db/outreach.js';
import { approveContactPersonalization } from '../db/contacts.js';
import { mapWithConcurrency } from '../utils/pool.js';

const VALID_DECISIONS = ['approved', 'rejected', 'edited'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------
// Generation
// ------------------------------------------------------------

export async function generatePersonalizedEmail(profileId, campaignId) {
  const [profile, enrichments, campaign] = await Promise.all([
    getProfile(profileId),
    getEnrichmentResults(profileId),
    campaignId ? getCampaign(campaignId) : getOrCreateDefaultCampaign(),
  ]);

  const usableFacts = (enrichments || []).filter(
    e => e.confidence == null || e.confidence >= MIN_PROMPT_EVIDENCE_CONFIDENCE
  );

  // One pending draft per profile+campaign: supersede any older pending rows
  // so the review queue never holds stale duplicates for the same person.
  await supersedePendingPersonalizations(profileId, campaign.id);

  const prompt = buildPrompt(profile, enrichments, campaign, config.smtp);
  const result = await callOpenAI(prompt);

  const personalization = {
    profileId,
    campaignId: campaign.id,
    subject: result.subject || '',
    body: result.body || '',
    // Evidence is validated against the profile's real enrichment rows: ids the
    // model invented (not traceable to a fact) are dropped, and every kept item
    // carries the real source/url/relationship so the trace is auditable.
    evidenceUsed: sanitizeEvidence(result.evidencesUsed || result.evidenceUsed || [], enrichments),
    aiModel: config.ai.model,
    generationPrompt: prompt,
    status: 'pending_review',
  };

  const saved = await savePersonalization(personalization);
  logger.info(`Generated personalization ${saved.id} for profile ${profileId} (${personalization.evidenceUsed.length} cited facts)`);
  return saved;
}

export async function regeneratePersonalization(profileId, campaignId) {
  // Superseding (rejecting) any existing pending draft happens inside
  // generatePersonalizedEmail, so regeneration always yields exactly one
  // fresh pending draft and the old one leaves the review queue.
  return generatePersonalizedEmail(profileId, campaignId);
}

// ------------------------------------------------------------
// Review workflow
// ------------------------------------------------------------

export async function submitReviewDecision(personalizationId, decision, { comments, editedSubject, editedBody, decidedBy } = {}) {
  if (!VALID_DECISIONS.includes(decision)) {
    throw new Error(`Invalid decision '${decision}'. Must be one of: ${VALID_DECISIONS.join(', ')}`);
  }

  // decidedBy maps to review_decisions.decided_by, which is a FK to contacts(id).
  // Accept an empty value, but if provided it must be a contact UUID — otherwise
  // the DB would reject the row with a confusing 500.
  if (decidedBy != null && decidedBy !== '' && !UUID_RE.test(decidedBy)) {
    throw new Error(`Invalid decidedBy '${decidedBy}'. Must be a contact UUID (see review_decisions.decided_by FK).`);
  }

  const personalization = await getPersonalization(personalizationId);
  if (!personalization) throw new Error(`Personalization ${personalizationId} not found`);

  const updates = { status: decision };

  if (decision === 'approved') {
    updates.approved_at = new Date().toISOString();
    updates.approved_by = decidedBy || null;
    // For 'edited', the operator approves with a modified copy
    if (editedSubject || editedBody) {
      updates.status = 'edited';
      updates.edited_subject = editedSubject || null;
      updates.edited_body = editedBody || null;
    }
  } else if (decision === 'rejected') {
    updates.rejected_at = new Date().toISOString();
    updates.rejected_by = decidedBy || null;
  } else if (decision === 'edited') {
    updates.edited_subject = editedSubject || null;
    updates.edited_body = editedBody || null;
  }

  await updatePersonalizationStatus(personalizationId, updates);
  await addReviewDecision({
    personalizationId,
    decision: updates.status,
    comments,
    editedSubject: editedSubject || null,
    editedBody: editedBody || null,
    decidedBy,
  });

  if (updates.status === 'approved' || updates.status === 'edited') {
    await activateForSending(personalization);
  }

  return getPersonalization(personalizationId);
}

export async function getEvidenceTrace(personalizationId) {
  const personalization = await getPersonalization(personalizationId);
  if (!personalization) throw new Error(`Personalization ${personalizationId} not found`);

  const decisions = await getReviewDecisions(personalizationId);
  return {
    personalization,
    evidenceUsed: Array.isArray(personalization.evidence_used) ? personalization.evidence_used : [],
    trace: buildEvidenceTrace(personalization.evidence_used || []),
    reviewHistory: decisions,
  };
}

// ------------------------------------------------------------
// Bulk processing
// ------------------------------------------------------------

export async function approveAndScheduleBulk({ campaignId, personalizationIds, limit = 50, decidedBy } = {}) {
  const approved = [];
  const skipped = [];

  const pending = personalizationIds && personalizationIds.length > 0
    ? await listPersonalizationsByIds(personalizationIds)
    : await listPersonalizations({ status: 'pending_review', campaignId, limit });

  for (const p of pending.slice(0, limit)) {
    try {
      await submitReviewDecision(p.id, 'approved', { decidedBy });
      approved.push(p.id);
    } catch (err) {
      logger.warn(`Bulk approve skipped personalization ${p.id}:`, { error: err.message });
      skipped.push({ id: p.id, reason: err.message });
    }
  }

  return { approved, skipped, total: pending.length };
}

export async function getProgress(campaignId) {
  const stats = await getBulkStats(campaignId);
  const sent = await getSentCount(campaignId);
  return { ...stats, sent };
}

// ------------------------------------------------------------
// Batch job entry point (called by personalization.job.js)
// ------------------------------------------------------------

export async function processPendingPersonalizations(campaignId, limit = 20) {
  const campaign = campaignId ? await getCampaign(campaignId) : await getOrCreateDefaultCampaign();
  const readyProfiles = await getProfilesReadyForPersonalization(campaign.id, limit);
  const concurrency = config.processing.personalizationConcurrency;

  const results = { enriched: 0, generated: 0, failed: 0, errors: [] };
  await mapWithConcurrency(readyProfiles, concurrency, async (profile) => {
    try {
      // Research-first: imports land without evidence. Run the research engine
      // (discovery -> identity match -> evidence) when the profile has no
      // facts yet, so the AI only ever cites real, sourced evidence.
      const enrichments = await getEnrichmentResults(profile.id);
      if (enrichments.length === 0) {
        await runResearchSynchronously(profile.id);
        results.enriched += 1;
      }
      await generatePersonalizedEmail(profile.id, campaign.id);
      results.generated += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ profileId: profile.id, error: err.message });
      logger.error(`Personalization generation failed for profile ${profile.id}:`, { error: err.message });
    }
  });

  logger.info(`Personalization batch complete (concurrency ${concurrency}). Enriched: ${results.enriched}, Generated: ${results.generated}, Failed: ${results.failed}`);
  return results;
}

// ------------------------------------------------------------
// Internals
// ------------------------------------------------------------

async function activateForSending(personalization) {
  const profile = await getProfile(personalization.profile_id);
  await linkPersonalizationToOutreach(profile.contact_id, personalization.campaign_id, personalization.id);
  await approveContactPersonalization(profile.contact_id);
}

async function getCampaign(campaignId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Campaign ${campaignId} not found`);
  return data;
}

async function listPersonalizationsByIds(ids) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('personalization_results')
    .select('*')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

async function getSentCount(campaignId) {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('outreach')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['Sent', 'Follow-up 1', 'Follow-up 2', 'Replied']);
  if (error) {
    logger.error('Error counting sent outreach:', { campaignId, error: error.message });
    return 0;
  }
  return count || 0;
}

// Evidence below this confidence never reaches the prompt — weak matches must
// not influence generated email. Manual facts (confidence null) are kept: they
// were entered by a human.
const MIN_PROMPT_EVIDENCE_CONFIDENCE = 0.3;

export function buildPrompt(profile, enrichments, campaign, senderInfo) {
  const factsForPrompt = (enrichments || [])
    .filter(e => e.confidence == null || e.confidence >= MIN_PROMPT_EVIDENCE_CONFIDENCE)
    .map(e => {
      const confidencePercent = Math.round((e.confidence || 0) * 100);
      const verified = e.verified ? 'Verified' : 'Unverified';
      // Fact ID is the enrichment_result UUID — the model must echo it back in
      // evidencesUsed so generated evidence is traceable to a real fact.
      return `- ${e.relationship}: "${e.fact_value}" (Fact ID: ${e.id}, Source: ${e.source_id || 'Manual'}, Confidence: ${confidencePercent}%, Status: ${verified})`;
    })
    .join('\n');

  const nonEmptyFields = [];
  if (profile.full_name) nonEmptyFields.push(`full_name: "${profile.full_name}"`);
  if (profile.organization) nonEmptyFields.push(`organization: "${profile.organization}"`);
  if (profile.role) nonEmptyFields.push(`role: "${profile.role}"`);
  if (profile.college) nonEmptyFields.push(`college: "${profile.college}"`);

  return `
Persona Profile:
${nonEmptyFields.join('\n') || '(no profile fields provided)'}

Verified Research & Enrichment Facts:
${factsForPrompt || '(no facts provided)'}

Campaign Context:
Campaign Name: ${campaign.name || 'N/A'}
Campaign Description: ${campaign.description || 'N/A'}

Sender Information:
Sender Name: ${senderInfo.fromName}
Sender Email: ${senderInfo.fromEmail}

Objective:
Generate a personalized outreach email that:
1. Uses only facts from the person's profile and enrichment results
2. Incorporates research results with proper source attribution
3. Demonstrates understanding of their specific role, achievements, or expertise
4. Is personalized to their unique background and interests
5. Has a compelling call-to-action

Generation Rules:
- Do NOT invent or hallucinate information that is not in the provided facts
- Reference each fact used by its Source and Confidence so they can be traced back
- Use neutral, respectful, and professional tone
- Address the person by their full name
- Clearly state your objective and what you would like to discuss

Output Format (JSON only):
{
  "subject": "A concise, personalized subject line",
  "body": "The full email body (plain text, with \\n line breaks)",
  "evidencesUsed": [
    { "id": "<fact id>", "source": "<source_id>", "confidence": 0.92, "usage": "<opening hook | credibility argument | call to action>" }
  ]
}
`;
}

export function buildEvidenceTrace(evidenceUsed) {
  if (!Array.isArray(evidenceUsed)) return [];
  return evidenceUsed.map(fact => ({
    factId: fact.id || fact.factId || null,
    source: fact.source || null,
    confidence: fact.confidence != null ? fact.confidence : null,
    usage: fact.usage || null,
  }));
}

/**
 * Keep only evidence the model actually cited that maps to a real enrichment
 * fact of THIS profile, decorated with the fact's own source/url/relationship.
 * Anything else (invented ids like "publication-1" or "persona_profile") is
 * dropped — untraceable evidence must never be presented as real.
 */
export function sanitizeEvidence(evidence, enrichments) {
  const byId = new Map((enrichments || []).map(e => [e.id, e]));
  const cleaned = [];
  for (const item of evidence || []) {
    const fact = byId.get(item.id) || byId.get(item.factId);
    if (!fact) continue;
    cleaned.push({
      id: fact.id,
      source: fact.source_id || null,
      sourceUrl: fact.source_url || null,
      relationship: fact.relationship || null,
      confidence: typeof item.confidence === 'number' ? item.confidence : (fact.confidence ?? null),
      usage: item.usage || 'cited fact',
      factValue: typeof fact.fact_value === 'string' ? fact.fact_value : JSON.stringify(fact.fact_value ?? ''),
    });
  }
  return cleaned;
}

async function callOpenAI(prompt) {
  if (!config.ai.apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const openai = new OpenAI({ apiKey: config.ai.apiKey });

  try {
    const response = await openai.chat.completions.create({
      model: config.ai.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    logger.error('OpenAI API call failed', { error: error.message });
    throw new Error('AI personalization generation failed');
  }
}
