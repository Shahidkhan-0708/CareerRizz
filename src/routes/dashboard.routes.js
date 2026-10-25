import express from 'express';
import nodemailer from 'nodemailer';
import { requireAuth } from '../middleware/supabase-auth.js';
import { getUserProfile, attachUserProfile, invalidateProfileCache } from '../middleware/rbac.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../db/client.js';
import { config } from '../config/env.js';
import { getOAuth2Client } from '../integrations/gmail/client.js';
import { getProfile } from '../db/profiles.js';
import {
  queueResearch,
  queueResearchBatch,
  getResearchStatus,
  getResearchSummary,
} from '../services/research.service.js';

export const dashboardRouter = express.Router();

function fail(res, err, label) {
  logger.error(`${label}:`, { error: err.message });
  res.status(500).json({ error: err.message });
}

// GET /api/user/profile — RBAC profile for the authenticated user
dashboardRouter.get('/user/profile', requireAuth, attachUserProfile, async (req, res) => {
  try {
    res.json({
      success: true,
      profile: req.userProfile,
    });
  } catch (err) {
    fail(res, err, 'Error fetching user profile');
  }
});

// GET /api/outreach/pending-task — Poll next pending task for Chrome Extension Bridge
dashboardRouter.get('/outreach/pending-task', requireAuth, async (req, res) => {
  try {
    const { getNextPendingOutreachTask } = await import('../services/workers/queues/outreach-bridge.js');
    const task = await getNextPendingOutreachTask();
    if (!task) {
      return res.status(204).send();
    }
    return res.json(task);
  } catch (err) {
    fail(res, err, 'Error polling pending outreach task');
  }
});

// PUT /api/user/workspace — switch active workspace
dashboardRouter.put('/user/workspace', requireAuth, async (req, res) => {
  try {
    const { workspace } = req.body;
    if (!workspace || !['outreach', 'job_search'].includes(workspace)) {
      return res.status(400).json({ error: 'Invalid workspace. Must be "outreach" or "job_search".' });
    }

    // Dev-bypass and api-key users always have both modules
    if (req.user.id === 'dev-bypass' || req.user.id === 'api-key') {
      return res.json({ success: true, active_workspace: workspace });
    }

    const profile = await getUserProfile(req.user.id);
    if (!profile) {
      return res.status(403).json({ error: 'No user profile found.' });
    }

    const moduleForWorkspace = workspace;
    if (profile.role !== 'owner' && !profile.enabled_modules.includes(moduleForWorkspace)) {
      return res.status(403).json({ error: `Your account does not have access to the "${workspace}" workspace.` });
    }

    const supabase = getSupabaseClient();
    const { error: updateErr } = await supabase
      .from('user_profiles')
      .update({ active_workspace: workspace })
      .eq('user_id', req.user.id);

    if (updateErr) throw updateErr;

    invalidateProfileCache(req.user.id);
    res.json({ success: true, active_workspace: workspace });
  } catch (err) {
    fail(res, err, 'Workspace switch error');
  }
});

// GET /api/campaigns — campaigns with per-campaign outreach counts
dashboardRouter.get('/campaigns', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { data: outreach, error: oErr } = await supabase
      .from('outreach')
      .select('campaign_id, status, ai_category');

    if (oErr) throw oErr;

    const byCampaign = new Map();
    for (const row of outreach || []) {
      const entry = byCampaign.get(row.campaign_id) || { total: 0, sent: 0, replied: 0, active: 0 };
      entry.total += 1;
      if (['Sent', 'Delivered', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Closed'].includes(row.status)) entry.sent += 1;
      if (row.status === 'Replied' || (row.ai_category && row.ai_category !== 'OTHER')) entry.replied += 1;
      if (['Ready', 'Claimed', 'Sending', 'Sent', 'Follow-up 1', 'Follow-up 2'].includes(row.status)) entry.active += 1;
      byCampaign.set(row.campaign_id, entry);
    }

    res.json({
      success: true,
      campaigns: (campaigns || []).map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        senderEmail: c.sender_email,
        senderName: c.sender_name,
        createdAt: c.created_at,
        ...(byCampaign.get(c.id) || { total: 0, sent: 0, replied: 0, active: 0 }),
      })),
    });
  } catch (err) {
    fail(res, err, 'Error listing campaigns');
  }
});

// GET /api/contacts — contacts with their latest outreach status
dashboardRouter.get('/contacts', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;

    let query = supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const search = (req.query.search || '').toString().trim();
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,organization.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const ids = (data || []).map(c => c.id);
    let statusMap = new Map();
    if (ids.length > 0) {
      const { data: outreach, error: oErr } = await supabase
        .from('outreach')
        .select('contact_id, status, campaign_id, sent_at, reply_received_at')
        .in('contact_id', ids);
      if (oErr) throw oErr;
      for (const row of outreach || []) {
        if (!statusMap.has(row.contact_id)) statusMap.set(row.contact_id, []);
        statusMap.get(row.contact_id).push(row);
      }
    }

    res.json({
      success: true,
      contacts: (data || []).map(c => ({
        id: c.id,
        email: c.email,
        name: c.name,
        organization: c.organization,
        role: c.role,
        personalization: c.personalization,
        personalizationApproved: c.personalization_approved,
        suppressed: c.suppressed,
        createdAt: c.created_at,
        outreach: statusMap.get(c.id) || [],
      })),
    });
  } catch (err) {
    fail(res, err, 'Error listing contacts');
  }
});

// GET /api/outreach — outreach records joined with contact + campaign
dashboardRouter.get('/outreach', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;

    let query = supabase
      .from('outreach')
      .select('*, contacts(*), campaigns(*)')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const status = (req.query.status || '').toString().trim();
    if (status) query = supabase
      .from('outreach')
      .select('*, contacts(*), campaigns(*)')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const campaignId = (req.query.campaignId || '').toString().trim();
    if (campaignId) query = supabase
      .from('outreach')
      .select('*, contacts(*), campaigns(*)')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, outreach: data || [] });
  } catch (err) {
    fail(res, err, 'Error listing outreach');
  }
});

// GET /api/replies — outreach records with inbound replies
dashboardRouter.get('/replies', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const { data, error } = await supabase
      .from('outreach')
      .select('*, contacts(*), campaigns(*)')
      .not('reply_received_at', 'is', null)
      .order('reply_received_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({ success: true, replies: data || [] });
  } catch (err) {
    fail(res, err, 'Error listing replies');
  }
});

// GET /api/dashboard/stats — aggregate KPIs for the dashboard
dashboardRouter.get('/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();

    const { count: contacts, error: cErr } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true });
    if (cErr) throw cErr;

    const { count: campaignCount, error: camErr } = await supabase
      .from('campaigns')
      .select('id', { count: 'exact', head: true });
    if (camErr) throw camErr;

    // ONE canonical query drives every delivery metric. Every rate below is
    // derived from this same row set (never mixed with a second, differently
    // filtered query), and percentages are clamped so the UI can never show
    // impossible values like "3 of 2 delivered" or 150%.
    //
    // Definitions (per the product audit):
    //   sent     = emails accepted by the provider (status in the sent set)
    //   delivered= confirmed delivery via provider webhook
    //   bounced  = confirmed bounce via provider webhook
    //   failed   = provider rejected / blocked (hard failure)
    //   pending  = accepted by provider, delivery unconfirmed
    // Invariants enforced here: delivered <= sent, replied <= sent, bounced <= sent.
    const { data: outreach, error: oErr } = await supabase
      .from('outreach')
      .select('status, ai_category, delivery_status');
    if (oErr) throw oErr;

    const SENT_STATUSES = ['Sent', 'Delivered', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Closed'];
    const byStatus = {};
    let sent = 0, replied = 0, ready = 0;
    let delivered = 0, bounced = 0, failed = 0, deliveryPending = 0;
    for (const row of outreach || []) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      if (SENT_STATUSES.includes(row.status)) sent += 1;
      if (row.status === 'Replied' || (row.ai_category && row.ai_category !== 'OTHER')) replied += 1;
      if (['Ready', 'Claimed'].includes(row.status)) ready += 1;

      // Delivery buckets only make sense for rows that were actually sent;
      // rows still Ready/Claimed/Error stay out of the delivery math entirely.
      if (SENT_STATUSES.includes(row.status)) {
        if (row.delivery_status === 'Delivered') delivered += 1;
        else if (row.delivery_status === 'Bounced') bounced += 1;
        else if (row.delivery_status === 'Failed' || row.delivery_status === 'Blocked') failed += 1;
        else deliveryPending += 1; // Sent / Pending / Queued — accepted, unconfirmed
      }
    }

    const rate = (n) => (sent > 0 ? Math.min(100, Math.round((n / sent) * 100)) : 0);
    // Clamp numerators defensively so even skewed legacy rows can never
    // produce delivered > sent in the response payload.
    const delivery = {
      sent,
      delivered: Math.min(delivered, sent),
      bounced: Math.min(bounced, sent),
      failed: Math.min(failed, sent),
      pending: Math.max(0, sent - Math.min(delivered, sent) - Math.min(bounced, sent) - Math.min(failed, sent)),
      deliveryRate: rate(delivered),
      bounceRate: rate(bounced),
      replyRate: rate(replied),
    };

    const { data: pending, error: pErr } = await supabase
      .from('personalization_results')
      .select('id')
      .eq('status', 'pending_review')
      .limit(500);
    if (pErr) throw pErr;

    const { data: importJobs, error: iErr } = await supabase
      .from('import_jobs')
      .select('status')
      .limit(500);
    if (iErr) throw iErr;

    const importByStatus = {};
    for (const j of importJobs || []) importByStatus[j.status] = (importByStatus[j.status] || 0) + 1;

    res.json({
      success: true,
      stats: {
        contacts: contacts || 0,
        campaigns: campaignCount || 0,
        outreach: { total: (outreach || []).length, sent, replied, ready, byStatus, delivery },
        reviewQueue: (pending || []).length,
        importJobs: importByStatus,
        config: {
          dailySendLimit: config.outreach.dailySendLimit,
          followup1Days: config.outreach.followup1Days,
          followup2Days: config.outreach.followup2Days,
          sendDelayMs: config.outreach.sendDelayMs,
          smtpConcurrency: config.outreach.smtpConcurrency,
          smtpHost: config.smtp.host,
          senderEmail: config.smtp.fromEmail,
          senderName: config.smtp.fromName,
          aiModel: config.ai.model,
          baseUrl: config.baseUrl,            integrations: {
            // Configured = credentials present in env. Supabase is always the
            // source of truth (this very request proved it reachable).
            supabase: Boolean(config.supabase.url && config.supabase.serviceKey),
            smtp: Boolean(config.smtp.user && config.smtp.pass),
            gmail: Boolean(config.gmail.clientId && config.gmail.clientSecret && config.gmail.refreshToken),
            openai: Boolean(config.ai.apiKey),
            airtable: Boolean(config.airtable.token && config.airtable.baseId),
            apify: Boolean(config.apify?.token),
          },
        },
      },
    });
  } catch (err) {
    fail(res, err, 'Error building dashboard stats');
  }
});

// GET /api/profiles — profiles joined with contact info + enrichment & personalization status
// (Used by the personalization UI to pick profiles for AI generation)
dashboardRouter.get('/profiles', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*, contacts(*)');
    if (error) throw error;

    const ids = (profiles || []).map(p => p.id);
    const enrichCounts = new Map();
    const personalizationStatus = new Map();
    const latestDrafts = new Map();
    if (ids.length > 0) {
      const { data: enrich, error: eErr } = await supabase
        .from('enrichment_results')
        .select('profile_id');
      if (!eErr) {
        for (const r of enrich || []) enrichCounts.set(r.profile_id, (enrichCounts.get(r.profile_id) || 0) + 1);
      }

      // Latest AI draft per profile (any status). Enables the person detail
      // page to render the actual generated email — pending, approved, or
      // edited — instead of falling back to an empty state.
      const { data: pers, error: pErr } = await supabase
        .from('personalization_results')
        .select('id, profile_id, status, subject, body, edited_subject, edited_body, evidence_used, created_at')
        .in('profile_id', ids)
        .order('created_at', { ascending: false });
      if (!pErr) {
        for (const r of pers || []) {
          if (!personalizationStatus.has(r.profile_id)) {
            personalizationStatus.set(r.profile_id, r.status);
            latestDrafts.set(r.profile_id, {
              id: r.id,
              status: r.status,
              subject: r.edited_subject || r.subject,
              body: r.edited_body || r.body,
              evidence_used: Array.isArray(r.evidence_used) ? r.evidence_used : [],
            });
          }
        }
      }
    }

    res.json({
      success: true,
      profiles: (profiles || []).map(p => ({
        id: p.id,
        contactId: p.contact_id,
        fullName: p.full_name,
        organization: p.organization,
        role: p.role,
        college: p.college,
        createdAt: p.created_at,
        contactEmail: p.contacts?.email || null,
        contactName: p.contacts?.name || null,
        linkedinUrl: p.linkedin_url || null,
        enrichmentCount: enrichCounts.get(p.id) || 0,
        personalizationStatus: personalizationStatus.get(p.id) || null,
        latestDraft: latestDrafts.get(p.id) || null,
        // Research pipeline state (present when the migration is applied):
        researchStatus: p.research_status || null,
        identityConfidence: p.research_identity_confidence != null ? Number(p.research_identity_confidence) : null,
        bestMatch: p.research_best_match || null,
        candidatesCount: Array.isArray(p.research_candidates) ? p.research_candidates.length : 0,
        researchLastRunAt: p.research_last_run_at || null,
      })),
    });
  } catch (err) {
    fail(res, err, 'Error listing profiles');
  }
});

// GET /api/enrichment/:profileId — enrichment results for a single profile
// (facts fetched by the enrichment stage; source URLs + confidence for evidence)
dashboardRouter.get('/enrichment/:profileId', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('enrichment_results')
      .select('*')
      .eq('profile_id', req.params.profileId)
      .order('confidence', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      results: (data || []).map(r => ({
        id: r.id,
        profileId: r.profile_id,
        sourceId: r.source_id,
        sourceUrl: r.source_url,
        relationship: r.relationship,
        factValue: r.fact_value,
        confidence: r.confidence,
        verified: r.verified,
        extractedAt: r.extracted_at,
      })),
    });
  } catch (err) {
    fail(res, err, 'Error listing enrichment results');
  }
});

// ---------------------------------------------------------------------------
// Integration health checks (real, cheap, cached 60s)
// ---------------------------------------------------------------------------
// Four honest states per service:
//   connected     — we actually reached the service and it authenticated
//   configured    — credentials exist in env but we did not probe it
//   not_configured— no credentials in env at all
//   error         — we probed it and the check failed
// A green dot is ONLY shown for "connected"; "configured but unknown" is
// amber so the UI can never imply health we did not verify.

const HEALTH_CACHE_TTL_MS = 60 * 1000;
let healthCache = { at: 0, payload: null };

function healthResult(status, detail) {
  return { status, detail };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkSupabase() {
  // The health endpoint itself sits on Supabase, but do a real read anyway.
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('campaigns').select('id').limit(1);
  return error ? healthResult('error', error.message) : healthResult('connected', 'database reachable');
}

async function checkSmtp() {
  if (!config.smtp.user || !config.smtp.pass) return healthResult('not_configured', 'no SMTP credentials configured');
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 6000,
      greetingTimeout: 6000,
      socketTimeout: 8000,
    });
    await transporter.verify();
    transporter.close();
    return healthResult('connected', 'SMTP authentication OK');
  } catch (err) {
    return healthResult('error', `SMTP verification failed: ${err.message}`);
  }
}

async function checkGmail() {
  if (!config.gmail.clientId || !config.gmail.clientSecret || !config.gmail.refreshToken) {
    return healthResult('not_configured', 'no Gmail OAuth credentials configured');
  }
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: config.gmail.refreshToken });
    const { token } = await oauth2Client.getAccessToken();
    return token ? healthResult('connected', 'OAuth token valid') : healthResult('error', 'token refresh returned no token');
  } catch (err) {
    return healthResult('error', `OAuth token refresh failed: ${err.message}`);
  }
}

async function checkOpenai() {
  if (!config.ai.apiKey) return healthResult('not_configured', 'no OpenAI API key configured');
  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${config.ai.apiKey}` },
    });
    return res.ok
      ? healthResult('connected', 'API reachable')
      : healthResult('error', `API returned HTTP ${res.status}`);
  } catch (err) {
    return healthResult('error', `unreachable: ${err.message}`);
  }
}

async function checkApify() {
  if (!config.apify?.token) return healthResult('not_configured', 'no Apify token configured');
  try {
    const res = await fetchWithTimeout(
      `https://api.apify.com/v2/acts?token=${config.apify.token}&limit=1`
    );
    return res.ok
      ? healthResult('connected', 'Apify API reachable')
      : healthResult('error', `Apify API returned HTTP ${res.status}`);
  } catch (err) {
    return healthResult('error', `unreachable: ${err.message}`);
  }
}

async function checkAirtable() {
  if (!config.airtable.token || !config.airtable.baseId) {
    return healthResult('not_configured', 'no Airtable credentials configured');
  }
  // Probe a DATA endpoint (the same one the sync job actually uses), not the
  // schema/meta endpoint. Personal Access Tokens default to data scopes only
  // (data.records:read/write); /v0/meta/bases requires the schema.bases:read
  // scope and returns 403 for such tokens even though syncing works fine.
  try {
    const table = encodeURIComponent(config.airtable.tableName);
    const res = await fetchWithTimeout(
      `https://api.airtable.com/v0/${config.airtable.baseId}/${table}?maxRecords=1`,
      { headers: { Authorization: `Bearer ${config.airtable.token}` } }
    );
    return res.ok
      ? healthResult('connected', 'base reachable')
      : healthResult('error', `API returned HTTP ${res.status}`);
  } catch (err) {
    return healthResult('error', `unreachable: ${err.message}`);
  }
}

dashboardRouter.get('/integrations/health', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    if (healthCache.payload && now - healthCache.at < HEALTH_CACHE_TTL_MS) {
      return res.json({ success: true, checkedAt: new Date(healthCache.at).toISOString(), cached: true, services: healthCache.payload });
    }

    const [supabase, smtp, gmail, openai, airtable, apify] = await Promise.allSettled([
      checkSupabase(),
      checkSmtp(),
      checkGmail(),
      checkOpenai(),
      checkAirtable(),
      checkApify(),
    ]);
    const settle = (p) => (p.status === 'fulfilled' ? p.value : healthResult('error', p.reason?.message || 'check threw'));
    const services = {
      supabase: settle(supabase),
      smtp: settle(smtp),
      gmail: settle(gmail),
      openai: settle(openai),
      airtable: settle(airtable),
      apify: settle(apify),
    };

    healthCache = { at: now, payload: services };
    res.json({ success: true, checkedAt: new Date(now).toISOString(), cached: false, services });
  } catch (err) {
    fail(res, err, 'Error checking integration health');
  }
});

// ---------------------------------------------------------------------------
// Research engine routes
// ---------------------------------------------------------------------------

// GET /api/research/status — live job states across all profiles
// (queued / discovering / matching / extracting / validating / completed / failed)
dashboardRouter.get('/research/status', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, ...(await getResearchStatus()) });
  } catch (err) {
    fail(res, err, 'Error getting research status');
  }
});

// GET /api/research/:profileId — research summary + evidence for one profile
dashboardRouter.get('/research/:profileId', requireAuth, async (req, res) => {
  try {
    const summary = await getResearchSummary(req.params.profileId);
    res.json({ success: true, ...summary });
  } catch (err) {
    fail(res, err, 'Error getting research summary');
  }
});

// POST /api/research/:profileId/run — kick off an async research run (202)
dashboardRouter.post('/research/:profileId/run', requireAuth, async (req, res) => {
  try {
    await getProfile(req.params.profileId);
    const job = queueResearch(req.params.profileId);
    res.status(202).json({ success: true, job });
  } catch (err) {
    fail(res, err, 'Error queueing research');
  }
});

// POST /api/research/run — queue research for many (or all) profiles
// body: { profileIds?: string[] } — defaults to every profile
// Requires the profiles list; the batch runs RESEARCH_CONCURRENCY at a time.
dashboardRouter.post('/research/run', requireAuth, async (req, res) => {
  try {
    const requested = req.body?.profileIds;
    let ids = requested;
    if (!ids || ids.length === 0) {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('profiles').select('id');
      if (error) throw error;
      ids = (data || []).map(p => p.id);
    }
    const queued = queueResearchBatch(ids);
    res.status(202).json({ success: true, ...queued });
  } catch (err) {
    fail(res, err, 'Error queueing research batch');
  }
});

// GET /api/import/jobs is provided by import.routes.js
