import { getSupabaseClient } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { getProfile } from '../db/profiles.js';
import { getContactById } from '../db/contacts.js';
import { getEnrichmentResults, saveEnrichmentResult } from '../db/enrichment.js';
import { updateResearchState, getPersistedResearchState } from '../db/research.js';
import { mapWithConcurrency } from '../utils/pool.js';
import { config } from '../config/env.js';
import {
  researchLinkedIn,
  linkedinProfileToFacts,
  linkedinPostsToFacts,
} from './linkedin.service.js';

// ---------------------------------------------------------------------------
// Research engine — the intelligence layer of the product.
//
//   IMPORTED PERSON
//     -> DISCOVERY     LinkedIn-first: find /in/ URL via Apify search-by-name,
//                      then fall back to OpenAlex authors, Wikipedia, DuckDuckGo
//     -> MATCHING      score each candidate: is THIS the same person? produces
//                      an identity confidence + a best match
//     -> EXTRACTING    fetch evidence from the best match — LinkedIn profile
//                      + posts when available, otherwise OpenAlex/Wikipedia/DDG
//     -> VALIDATING    drop facts below a confidence floor, persist evidence
//                      with source URL + per-fact confidence, mark unverified
//     -> COMPLETED / FAILED  (with RETRY = running research again)
//
// Every evidence row carries: source URL, source id, retrieved timestamp,
// extracted claim, confidence, profile association, verification state.
// Weak identity matches never silently become facts.
//
// Job state lives in an in-memory registry (live progress for the UI) and is
// also persisted to profiles.research_* when the migration is applied.
// ---------------------------------------------------------------------------

// ---- thresholds -----------------------------------------------------------
const ACCEPT_IDENTITY = 0.55;      // minimum identity confidence to extract from a candidate
const MIN_FACT_CONFIDENCE = 0.3;   // facts below this are dropped at validation
const MAX_CANDIDATES = 6;
const MAX_WORKS = 6;
const TIMEOUT_MS = 8000;

const OPENALEX_AUTHORS_URL = 'https://api.openalex.org/authors';
const OPENALEX_WORKS_URL = 'https://api.openalex.org/works';
const WIKIPEDIA_URL = 'https://en.wikipedia.org/w/api.php';
const DDG_URL = 'https://api.duckduckgo.com/';

// ---- small helpers ---------------------------------------------------------
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_WORDS = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'sir', 'phd', 'mba', 'md', 'esq', 'assoc', 'asst', 'dept', 'univ', 'university']);

function tokens(s) {
  return normalizeText(s).split(' ').filter(w => w.length > 1 && !TITLE_WORDS.has(w));
}

/** Dice coefficient over token sets — 1 = same tokens, 0 = nothing shared. */
function diceOverlap(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta);
  let inter = 0;
  for (const t of tb) if (setA.has(t)) inter += 1;
  return (2 * inter) / (ta.length + tb.length);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- discovery --------------------------------------------------------------
/**
 * Build the discovery query set from EVERY available identifier. Searching
 * only the name misses the point — "John Smith" matches hundreds of people,
 * "John Smith MIT professor" and "johnsmith@mit.edu" resolve to one.
 */
export function buildDiscoveryQueries(profile, contact) {
  const name = (profile.full_name || '').trim();
  const org = (profile.organization || '').trim();
  const role = (profile.role || '').trim();
  const email = (contact?.email || '').trim();
  const domain = email.split('@')[1] || '';

  const queries = [name];
  if (name && org) queries.push(`${name} ${org}`);
  if (name && role) queries.push(`${name} ${role}`);
  if (name && org && role) queries.push(`${name} ${org} ${role}`);
  if (email) queries.push(email);
  if (name && domain) queries.push(`${name} ${domain}`);

  return [...new Set(queries.filter(Boolean))].slice(0, 4);
}

/** Fetch candidate OpenAlex author entities for a query. */
async function searchOpenAlexAuthors(query) {
  const params = new URLSearchParams({
    search: query,
    per_page: '5',
    mailto: 'outreach@example.com', // polite per OpenAlex API guidelines
  });
  const res = await fetchWithTimeout(`${OPENALEX_AUTHORS_URL}?${params}`);
  if (!res) return [];
  const body = await res.json();
  return (Array.isArray(body.results) ? body.results : []).map(a => {
    const affiliations = [
      ...(a.affiliations || []).map(x => x.institution?.display_name).filter(Boolean),
      ...(a.last_known_institutions || []).map(x => x.display_name).filter(Boolean),
    ];
    return {
      kind: 'openalex',
      id: a.id,
      name: a.display_name,
      label: `${a.display_name} — OpenAlex author`,
      url: a.id,
      affiliations: [...new Set(affiliations)],
      worksCount: a.works_count,
      citedByCount: a.cited_by_count,
      context: affiliations.join(' '),
    };
  });
}

/** Fetch candidate Wikipedia articles for a query. */
async function searchWikipedia(query) {
  const searchParams = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '4',
    format: 'json',
    origin: '*',
  });
  const res = await fetchWithTimeout(`${WIKIPEDIA_URL}?${searchParams}`);
  if (!res) return [];
  const body = await res.json();
  return (body?.query?.search || []).map(hit => ({
    kind: 'wikipedia',
    id: `wiki:${hit.pageid}`,
    name: hit.title,
    label: `${hit.title} — Wikipedia`,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
    affiliations: [],
    context: stripHtml(hit.snippet || ''),
  }));
}

/** Fetch DuckDuckGo instant answers as a fallback news source. */
async function searchDuckDuckGo(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  const res = await fetchWithTimeout(`${DDG_URL}?${params}`);
  if (!res) return [];
  const body = await res.json();
  const topics = [
    ...(Array.isArray(body.RelatedTopics) ? body.RelatedTopics : []),
    ...(Array.isArray(body.Topics) ? body.Topics : []),
  ];
  return topics
    .filter(t => t.Text && t.FirstURL)
    .slice(0, 3)
    .map(t => ({
      kind: 'ddg',
      id: null,
      name: t.Text.slice(0, 90),
      label: `${t.Text.slice(0, 90)} — web`,
      url: t.FirstURL,
      affiliations: [],
      context: t.Text,
    }));
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Gather candidates across all discovery strategies, deduped by id. */
async function discover(profile, contact) {
  const queries = buildDiscoveryQueries(profile, contact);
  const seen = new Map();

  // ---- LinkedIn: use stored URL directly or search by name via Apify -----
  if (profile.linkedin_url) {
    // Profile already has a LinkedIn URL — use it directly, no search needed
    const key = `linkedin:${profile.linkedin_url}`;
    seen.set(key, {
      kind: 'linkedin',
      id: key,
      name: (profile.full_name || '').trim(),
      label: `${(profile.full_name || '').trim()} — LinkedIn`,
      url: profile.linkedin_url,
      affiliations: profile.organization ? [profile.organization] : [],
      context: profile.role || '',
      linkedinUrl: profile.linkedin_url,
      headline: profile.role || null,
    });
  } else if (config.apify?.token) {
    // No stored URL — search by name via Apify
    try {
      const { searchLinkedInByName } = await import('./linkedin.service.js');
      const name = (profile.full_name || '').trim();
      const parts = name.split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';

      const linkedinCandidates = await searchLinkedInByName(firstName, lastName, {
        company: profile.organization || undefined,
      });

      for (const c of linkedinCandidates) {
        const key = `linkedin:${c.linkedinUrl}`;
        if (!seen.has(key)) {
          seen.set(key, {
            kind: 'linkedin',
            id: key,
            name: [c.firstName, c.lastName].filter(Boolean).join(' '),
            label: `${[c.firstName, c.lastName].filter(Boolean).join(' ')} — LinkedIn`,
            url: c.linkedinUrl,
            affiliations: c.currentCompany ? [c.currentCompany] : [],
            context: c.headline || '',
            linkedinUrl: c.linkedinUrl,
            headline: c.headline,
          });
        }
      }
    } catch (err) {
      logger.warn('LinkedIn search failed during discovery:', { error: err.message });
    }
  }

  // ---- Fallback: OpenAlex, Wikipedia, DuckDuckGo --------------------------
  for (const query of queries.slice(0, 2)) {
    for (const c of await searchOpenAlexAuthors(query)) {
      if (!seen.has(c.id)) seen.set(c.id, c);
    }
  }

  for (const query of queries.slice(0, 2)) {
    for (const c of await searchWikipedia(query)) {
      if (!seen.has(c.id)) seen.set(c.id, c);
    }
  }

  // DDG only as a light extra source on the primary query.
  for (const c of await searchDuckDuckGo(queries[0] || '')) {
    const key = c.url || `ddg:${c.name}`;
    if (!seen.has(key)) seen.set(key, c);
  }

  return [...seen.values()].slice(0, MAX_CANDIDATES);
}

// ---- identity matching ------------------------------------------------------
/**
 * Score how likely a candidate IS the imported person. Uses name tokens,
 * institutional affiliation overlap (incl. substring containment so "MIT"
 * matches "Massachusetts Institute of Technology"), role keywords, and a
 * small bias toward Wikipedia for fully-unique names.
 */
export function scoreIdentity(profile, candidate) {
  const nameScore = diceOverlap(profile.full_name || '', candidate.name || '');

  let bestOrg = profile.organization ? 0 : 0.3; // no org signal -> neutral
  const profileOrg = normalizeText(profile.organization);
  if (profileOrg) {
    for (const aff of candidate.affiliations || []) {
      const affNorm = normalizeText(aff);
      if (!affNorm) continue;
      const dice = diceOverlap(profileOrg, affNorm);
      const containment = affNorm.includes(profileOrg) || profileOrg.includes(affNorm) ? 0.75 : 0;
      bestOrg = Math.max(bestOrg, dice, containment);
    }
  }

  const roleScore = profile.role ? diceOverlap(profile.role, candidate.context || '') : 0;
  // LinkedIn candidates get a bonus — the platform's own identity matching
  // means a search-by-name hit is very likely the right person.
  const linkedinBonus = candidate.kind === 'linkedin' ? 0.1 : 0;
  const uniqueNameBonus = candidate.kind === 'wikipedia' ? 0.05 : 0;

  const confidence = 0.4 * nameScore + 0.35 * bestOrg + 0.1 * roleScore + linkedinBonus + uniqueNameBonus;
  return clamp(confidence, 0, 0.98);
}

// ---- evidence extraction ----------------------------------------------------
async function fetchWorksByAuthor(authorId) {
  // authorId looks like https://openalex.org/A1234 — the filter accepts the
  // numeric part.
  const id = String(authorId || '').replace(/.*\//, '');
  const params = new URLSearchParams({
    filter: `authorships.author.id:${id}`,
    per_page: String(MAX_WORKS),
    sort: 'cited_by_count:desc',
    mailto: 'outreach@example.com',
  });
  const res = await fetchWithTimeout(`${OPENALEX_WORKS_URL}?${params}`);
  if (!res) return [];
  const body = await res.json();
  return Array.isArray(body.results) ? body.results : [];
}

async function fetchWikipediaExtract(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    titles: title,
    format: 'json',
    origin: '*',
  });
  const res = await fetchWithTimeout(`${WIKIPEDIA_URL}?${params}`);
  if (!res) return null;
  const body = await res.json();
  const page = Object.values(body?.query?.pages || {})[0];
  return page?.extract || null;
}

/**
 * Extract evidence ONLY from the best-matched candidate. Every fact carries
 * the candidate's identity confidence baked into its own confidence so weak
 * matches produce low scores that validation drops.
 */
async function extractEvidence(profile, best) {
  const idConf = best.identityConfidence;
  const facts = [];

  if (best.kind === 'openalex') {
    const works = await fetchWorksByAuthor(best.id);
    for (const w of works) {
      const title = w.title || w.display_name || 'Untitled publication';
      const year = w.publication_year || w.publication_date?.slice(0, 4) || null;
      const venue = w.primary_location?.source?.display_name || null;
      const value = [year ? `(${year})` : null, title, venue ? `— ${venue}` : null].filter(Boolean).join(' ');
      facts.push({
        relationship: 'publication',
        value,
        url: w.doi || w.id || null,
        confidence: clamp(idConf * 0.85, 0, 0.98),
      });
      if (facts.length >= MAX_WORKS) break;
    }
    for (const aff of (best.affiliations || []).slice(0, 2)) {
      facts.push({
        relationship: 'affiliation',
        value: aff,
        url: best.url,
        confidence: clamp(idConf * 0.9, 0, 0.98),
      });
    }
  } else if (best.kind === 'wikipedia') {
    const extract = await fetchWikipediaExtract(best.name);
    if (extract) {
      facts.push({
        relationship: 'bio',
        value: extract.slice(0, 700),
        url: best.url,
        confidence: clamp(idConf * 0.9, 0, 0.98),
      });
    }
  } else if (best.kind === 'linkedin') {
    // LinkedIn: scrape full profile + posts for rich evidence
    try {
      const linkedinResult = await researchLinkedIn(profile, null);
      if (linkedinResult) {
        // Profile facts (headline, bio, experience, education, skills)
        const profileFacts = linkedinProfileToFacts(linkedinResult.profile, idConf);
        facts.push(...profileFacts);

        // Post facts (recent posts with engagement)
        const postFacts = linkedinPostsToFacts(linkedinResult.posts, idConf);
        facts.push(...postFacts);
      }
    } catch (err) {
      logger.warn(`LinkedIn extraction failed for profile, falling through:`, { error: err.message });
    }

    // If LinkedIn returned nothing, try the URL directly
    if (facts.length === 0 && best.linkedinUrl) {
      try {
        const { scrapeLinkedInProfile, scrapeLinkedInPosts } = await import('./linkedin.service.js');
        const lp = await scrapeLinkedInProfile(best.linkedinUrl);
        if (lp) facts.push(...linkedinProfileToFacts(lp, idConf));
        const posts = await scrapeLinkedInPosts(best.linkedinUrl, 5);
        if (posts.length > 0) facts.push(...linkedinPostsToFacts(posts, idConf));
      } catch (err) {
        logger.warn('LinkedIn direct scrape failed:', { error: err.message });
      }
    }
  } else if (best.kind === 'ddg' && best.context) {
    facts.push({
      relationship: 'news',
      value: best.context.slice(0, 400),
      url: best.url,
      confidence: clamp(idConf * 0.6, 0, 0.98),
    });
  }

  return facts;
}

/** Validation: keep only facts above the confidence floor and persist them. */
async function replaceEvidence(profileId, facts) {
  const supabase = getSupabaseClient();

  // Re-runs refresh the evidence: drop previous unverified rows (human-verified
  // facts survive), then insert the fresh set.
  const { error: delErr } = await supabase
    .from('enrichment_results')
    .delete()
    .eq('profile_id', profileId)
    .eq('verified', false);
  if (delErr) {
    logger.warn(`Could not clear stale enrichment for profile ${profileId}:`, { error: delErr.message });
  }

  const saved = [];
  for (const fact of facts) {
    if ((fact.confidence ?? 0) < MIN_FACT_CONFIDENCE) continue;
    try {
      const row = await saveEnrichmentResult({
        profileId,
        sourceId: fact.relationship === 'publication' || fact.relationship === 'affiliation' ? 'academic_db' : 'news_api',
        sourceUrl: fact.url,
        relationship: fact.relationship,
        factValue: fact.value,
        confidence: fact.confidence,
        verified: false, // third-party source; human review can verify
      });
      saved.push(row);
    } catch (err) {
      logger.warn(`Could not save enrichment fact for profile ${profileId}:`, { error: err.message });
    }
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Job registry + run orchestration
// ---------------------------------------------------------------------------

const jobs = new Map(); // profileId -> { …job, promise }

function createJob(profileId) {
  return {
    profileId,
    status: 'queued',
    stage: null,
    steps: {},
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    identityConfidence: null,
    bestMatch: null,
    candidates: [],
    result: null,
    promise: null,
  };
}

function serializeJob(job) {
  return {
    profileId: job.profileId,
    status: job.status,
    stage: job.stage,
    steps: job.steps,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    identityConfidence: job.identityConfidence,
    bestMatch: job.bestMatch,
    candidates: job.candidates,
  };
}

function setStage(job, stage) {
  job.stage = stage;
  job.steps[stage] = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
}

async function runResearchForProfile(profileId) {
  const job = jobs.get(profileId);
  const now = new Date().toISOString();
  job.status = 'queued';
  job.error = null;
  job.finishedAt = null;
  job.result = null;
  await updateResearchState(profileId, { research_status: 'queued', research_stage: null, research_error: null, research_last_run_at: now });

  try {
    job.status = 'running';
    job.startedAt = now;

    // DISCOVERING
    setStage(job, 'discovering');
    await updateResearchState(profileId, { research_status: 'running', research_stage: 'discovering' });
    const profile = await getProfile(profileId);
    const contact = profile.contact_id ? await getContactById(profile.contact_id) : null;
    const candidates = await discover(profile, contact);
    job.candidates = candidates;

    // MATCHING
    setStage(job, 'matching');
    await updateResearchState(profileId, { research_stage: 'matching' });
    const scored = candidates
      .map(c => ({ ...c, identityConfidence: scoreIdentity(profile, c) }))
      .sort((a, b) => b.identityConfidence - a.identityConfidence)
      .slice(0, MAX_CANDIDATES);
    const best = scored[0] || null;
    job.identityConfidence = best ? best.identityConfidence : 0;
    job.bestMatch = best ? best.label : null;

    // Persist LinkedIn URL if found (feature-detects the column)
    if (best?.kind === 'linkedin' && best.linkedinUrl) {
      try {
        const supabase = getSupabaseClient();
        await supabase
          .from('profiles')
          .update({ linkedin_url: best.linkedinUrl })
          .eq('id', profileId);
      } catch {
        // Column may not exist yet — migration not applied. Silent no-op.
      }
    }

    // EXTRACTING — only from a confident match
    setStage(job, 'extracting');
    await updateResearchState(profileId, { research_stage: 'extracting' });
    const facts = best && best.identityConfidence >= ACCEPT_IDENTITY ? await extractEvidence(profile, best) : [];

    // VALIDATING
    setStage(job, 'validating');
    await updateResearchState(profileId, { research_stage: 'validating' });
    const evidence = await replaceEvidence(profileId, facts);

    // COMPLETED
    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    job.steps.completed = job.finishedAt;
    job.result = {
      evidence,
      identityConfidence: job.identityConfidence,
      bestMatch: job.bestMatch,
      candidates: scored.map(c => ({ name: c.name, label: c.label, url: c.url, identityConfidence: c.identityConfidence })),
    };
    await updateResearchState(profileId, {
      research_status: 'completed',
      research_stage: null,
      research_identity_confidence: job.identityConfidence || null,
      research_best_match: job.bestMatch,
      research_candidates: job.result.candidates,
      research_error: null,
    });

    logger.info(`Research completed for profile ${profileId}: identity ${job.identityConfidence?.toFixed(2)}, ${evidence.length} facts, best ${job.bestMatch}`);
    return job.result;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    await updateResearchState(profileId, {
      research_status: 'failed',
      research_stage: null,
      research_error: err.message,
    });
    logger.error(`Research failed for profile ${profileId}:`, { error: err.message });
    throw err;
  }
}

/** Queue an async research run for a profile. Idempotent per profile. */
export function queueResearch(profileId) {
  const existing = jobs.get(profileId);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return serializeJob(existing);
  }
  const job = createJob(profileId);
  jobs.set(profileId, job);
  job.promise = runResearchForProfile(profileId)
    .catch(() => { /* state already recorded on the job */ });
  return serializeJob(job);
}

/** Run research for a profile and await completion (used by the sync route + personalization). */
export async function runResearchSynchronously(profileId) {
  const existing = jobs.get(profileId);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    await existing.promise;
    return existing.result;
  }
  const job = queueResearch(profileId);
  await job.promise;
  return job.result;
}

/** Queue research for many profiles, running RESEARCH_CONCURRENCY at a time. */
export function queueResearchBatch(profileIds) {
  const unique = [...new Set(profileIds)].filter(Boolean);
  const concurrency = Math.max(1, config.processing.researchConcurrency);
  (async () => {
    await mapWithConcurrency(unique, concurrency, async (id) => {
      await runResearchSynchronously(id);
    });
  })().catch(err => {
    logger.error('Research batch failed:', { error: err.message });
  });
  return { queued: unique.length, concurrency };
}

/** Live status of all recent research jobs (queued/running + last 30 min done). */
export async function getResearchStatus() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  const list = [];
  const seenProfiles = new Set();

  // 1. In-memory jobs (live progress + recently finished)
  for (const job of jobs.values()) {
    const finishedTs = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
    if (job.status === 'queued' || job.status === 'running' || finishedTs >= cutoff) {
      list.push(serializeJob(job));
      seenProfiles.add(job.profileId);
    }
  }

  // 2. Persisted state for profiles NOT in the in-memory registry.
  //    This covers profiles whose research was interrupted by a server restart
  //    — the in-memory Map is empty but the DB still has the last known state.
  if (getPersistedResearchState) {
    try {
      const supabase = getSupabaseClient();
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, research_status, research_stage, research_identity_confidence, research_best_match, research_last_run_at, research_error')
        .not('research_status', 'is', null)
        .order('research_last_run_at', { ascending: false })
        .limit(50);

      for (const p of profiles || []) {
        if (seenProfiles.has(p.id)) continue;
        // Only include profiles with activity in the last 30 minutes or still running
        const lastRun = p.research_last_run_at ? new Date(p.research_last_run_at).getTime() : 0;
        if (p.research_status === 'running' || p.research_status === 'queued' || lastRun >= cutoff) {
          list.push({
            profileId: p.id,
            status: p.research_status || 'not_started',
            stage: p.research_stage || null,
            steps: {},
            startedAt: p.research_last_run_at || null,
            updatedAt: p.research_last_run_at || null,
            finishedAt: p.research_last_run_at || null,
            error: p.research_error || null,
            identityConfidence: p.research_identity_confidence != null ? Number(p.research_identity_confidence) : null,
            bestMatch: p.research_best_match || null,
            candidates: [],
          });
          seenProfiles.add(p.id);
        }
      }
    } catch (err) {
      logger.warn('Could not fetch persisted research state for status:', { error: err.message });
    }
  }

  const counts = { queued: 0, running: 0, completed: 0, failed: 0 };
  for (const j of list) {
    if (counts[j.status] != null) counts[j.status] += 1;
  }
  return { jobs: list, counts, running: counts.running, queued: counts.queued, completed: counts.completed, failed: counts.failed };
}

/** Research summary for one profile: persisted state (if any) + live job + evidence. */
export async function getResearchSummary(profileId) {
  const [profile, evidence, persisted] = await Promise.all([
    getProfile(profileId),
    getEnrichmentResults(profileId),
    getPersistedResearchState(profileId),
  ]);
  const job = jobs.get(profileId);

  const research = {
    status: job?.status || persisted?.research_status || 'not_started',
    stage: job?.stage || persisted?.research_stage || null,
    identityConfidence:
      job?.identityConfidence ??
      (persisted?.research_identity_confidence != null ? Number(persisted.research_identity_confidence) : null),
    bestMatch: job?.bestMatch || persisted?.research_best_match || null,
    candidates: job?.candidates || persisted?.research_candidates || [],
    lastRunAt: job?.finishedAt || persisted?.research_last_run_at || null,
    error: job?.error || persisted?.research_error || null,
    steps: job?.steps || {},
  };

  return {
    profile: {
      id: profile.id,
      fullName: profile.full_name,
      organization: profile.organization,
      role: profile.role,
      contactId: profile.contact_id,
    },
    research,
    evidence: (evidence || []).map(r => ({
      id: r.id,
      profileId: r.profile_id,
      sourceId: r.source_id,
      sourceUrl: r.source_url,
      relationship: r.relationship,
      factValue: r.fact_value,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      verified: r.verified,
      extractedAt: r.extracted_at,
    })),
  };
}
