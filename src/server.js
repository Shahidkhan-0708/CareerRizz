import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database & Services
import { getOrCreateDefaultCampaign } from './db/campaigns.js';
import { createOrUpdateContact, markContactSuppressed } from './db/contacts.js';
import { createOrUpdateProfile } from './db/profiles.js';
import { getSupabaseClient } from './db/client.js';
import { processOutreachBatch } from './services/outreach.service.js';
import { processFollowUpsBatch } from './services/followup.service.js';
import { processPendingPersonalizations } from './services/personalization.service.js';
import { processIncomingReplies } from './services/reply.service.js';
import { syncSupabaseToAirtable } from './integrations/airtable/sync.js';
import { resetStaleClaims, clearProcessedGmailMessages } from './db/outreach.js';

// Integrations & Webhooks
import { generateAuthUrl, exchangeCodeForTokens, testGmail } from './integrations/gmail/client.js';
import { webhookRouter } from './webhooks/email-events.js';
import { requireApiKey } from './middleware/api-key.js';
import { requireAuth } from './middleware/supabase-auth.js';
import { requireModule, attachUserProfile } from './middleware/rbac.js';

// API Routers
import { authRouter } from './routes/auth.routes.js';
import { importRouter } from './routes/import.routes.js';
import { personalizationRouter } from './routes/personalization.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { alumniRouter } from './routes/alumni.routes.js';
import { jobSearchRouter } from './routes/job-search.routes.js';

// Scheduled Jobs
import { scheduleOutreachJob } from './jobs/send-outreach.job.js';
import { scheduleFollowUpJob } from './jobs/followups.job.js';
import { scheduleReplyCheckJob } from './jobs/replies.job.js';
import { scheduleAirtableSyncJob } from './jobs/airtable-sync.job.js';
import { scheduleCleanupStaleClaimsJob } from './jobs/cleanup-stale-claims.job.js';
import { scheduleImportJob } from './jobs/import.job.js';
import { schedulePersonalizationJob } from './jobs/personalization.job.js';

const app = express();
app.use(express.json());

// Serve the built React frontend when available. Prefer the V2 redesign
// (f/dist); fall back to the earlier React build (frontend/dist); otherwise
// fall back to the legacy static dashboard (public/).
const v2ReactDist = path.join(__dirname, '..', 'f', 'dist');
const reactDist = path.join(__dirname, '..', 'frontend', 'dist');
const legacyRoot = path.join(__dirname, '..', 'public');
const staticRoot = fs.existsSync(v2ReactDist)
  ? v2ReactDist
  : fs.existsSync(reactDist)
    ? reactDist
    : legacyRoot;

// Landing page (public) — served BEFORE the SPA static middleware so
// /, /login, /signup show the marketing page instead of the dashboard SPA.
const landingPath = path.join(__dirname, '..', 'f', 'public', 'landing.html');
const hasLanding = fs.existsSync(landingPath);
if (hasLanding) {
  app.get('/', (_req, res) => res.sendFile(landingPath));
}

// Dashboard SPA static assets (f/dist) — serves JS/CSS bundles and index.html
app.use(express.static(staticRoot));

// ----------------------------------------------------
// Health Check Endpoint
// ----------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'College Outreach Automation System V2',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    config: {
      dailySendLimit: config.outreach.dailySendLimit,
      smtpHost: config.smtp.host,
      senderEmail: config.smtp.fromEmail,
      aiModel: config.ai.model,
    },
  });
});

// ----------------------------------------------------
// Auth Routes (signup, login, session)
// ----------------------------------------------------
app.use('/auth', authRouter);

// ----------------------------------------------------
// Gmail OAuth 2.0 Flow & Test Endpoints
// ----------------------------------------------------
// Diagnostic endpoint — must be behind the admin key like every other /api route.
app.get('/api/test/gmail', requireAuth, testGmail);

app.get('/auth/google', (req, res) => {

  try {
    const url = generateAuthUrl();
    res.redirect(url);
  } catch (err) {
    logger.error('Error generating Google OAuth URL:', { error: err.message });
    res.status(500).send('Error generating Google OAuth URL');
  }
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }
  try {
    const tokens = await exchangeCodeForTokens(code);
    logger.info('Successfully obtained Google OAuth tokens.');

    res.send(`
      <h2>Google Authorization Successful!</h2>
      <p>Save the following <strong>Refresh Token</strong> in your <code>.env</code> file under <code>GMAIL_REFRESH_TOKEN</code>:</p>
      <pre style="background: #f4f4f4; padding: 15px; border-radius: 5px;">${tokens.refresh_token || 'No refresh token returned (was prompt=consent specified?)'}</pre>
    `);
  } catch (err) {
    logger.error('Error exchanging OAuth code:', { error: err.message });
    res.status(500).send(`OAuth Exchange Error: ${err.message}`);
  }
});

// ----------------------------------------------------
// Unsubscribe Endpoint
// ----------------------------------------------------
app.get('/unsubscribe', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('Missing unsubscribe token');
  }
  try {
    const decoded = jwt.verify(token, config.security.unsubscribeJwtSecret);
    const supabase = getSupabaseClient();
    
    const { data: contact } = await supabase
      .from('contacts')
      .select('email')
      .eq('id', decoded.contactId)
      .maybeSingle();

    if (contact) {
      await markContactSuppressed(contact.email, 'User clicked unsubscribe link');
      logger.info(`Contact ${contact.email} unsubscribed successfully.`);
    }

    res.send(`
      <div style="max-width: 500px; margin: 50px auto; font-family: sans-serif; text-align: center;">
        <h2>You have been unsubscribed</h2>
        <p>Your email address has been removed from our outreach list and you will receive no further messages.</p>
      </div>
    `);
  } catch (err) {
    logger.error('Error processing unsubscribe token:', { error: err.message });
    res.status(400).send('Invalid or expired unsubscribe link.');
  }
});

// ----------------------------------------------------
// Webhooks Router
// ----------------------------------------------------
app.use('/webhooks', webhookRouter);

// ----------------------------------------------------
// API Routers (Import, Personalization, Review, Bulk, Data)
// Outreach module — gated by requireModule('outreach')
// ----------------------------------------------------
app.use('/api', requireModule('outreach'), importRouter);
app.use('/api', requireModule('outreach'), personalizationRouter);
app.use('/api', requireModule('outreach'), dashboardRouter);
app.use('/api', requireModule('outreach'), alumniRouter);

// Job Search module — gated by requireModule('job_search')
app.use('/api', jobSearchRouter);

// ----------------------------------------------------
// SPA fallback: serve index.html for client-side routes
// (must come after API/auth/webhook routes)
// ----------------------------------------------------
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/webhooks') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// ----------------------------------------------------
// Secured API Manual Trigger & Helper Endpoints
// ----------------------------------------------------
app.post('/api/trigger/outreach', requireAuth, async (req, res) => {
  logger.info('Manual trigger request received for Outreach job.');
  try {
    const result = await processOutreachBatch();
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Manual outreach trigger failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trigger/followups', requireAuth, async (req, res) => {
  logger.info('Manual trigger request received for Follow-ups job.');
  try {
    const result = await processFollowUpsBatch();
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Manual followups trigger failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trigger/replies', requireAuth, async (req, res) => {
  logger.info('Manual trigger request received for Reply detection job.');
  try {
    const result = await processIncomingReplies();
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Manual reply trigger failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trigger/replies/reset', requireAuth, async (req, res) => {
  logger.info('Manual reset & scan request received for Reply detection job.');
  try {
    await clearProcessedGmailMessages();
    const result = await processIncomingReplies();
    res.json({ success: true, reset: true, result });
  } catch (err) {
    logger.error('Manual reply reset & trigger failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trigger/personalization', requireAuth, async (req, res) => {
  logger.info('Manual trigger request received for Personalization batch job.');
  try {
    const campaignId = req.body?.campaignId || null;
    const limit = parseInt(req.body?.limit, 10) || 20;
    const result = await processPendingPersonalizations(campaignId, limit);
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Manual personalization trigger failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trigger/cleanup-stale-claims', requireAuth, async (req, res) => {
  logger.info('Manual trigger request received for stale-claim cleanup job.');
  try {
    await resetStaleClaims(parseInt(req.body?.timeoutMinutes, 10) || 10);
    res.json({ success: true, message: 'Stale claim cleanup completed' });
  } catch (err) {
    logger.error('Manual stale-claim cleanup trigger failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trigger/airtable-sync', requireAuth, async (req, res) => {
  logger.info('Manual trigger request received for Airtable sync job.');
  try {
    await syncSupabaseToAirtable();
    res.json({ success: true, message: 'Airtable sync triggered' });
  } catch (err) {
    logger.error('Manual airtable sync trigger failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Helper endpoint to seed a lead for testing
// NOTE: approval defaults to FALSE. The intended pipeline is import -> research
// -> AI personalization -> human review -> approve -> send. Auto-approving a
// lead with no personalization used to let generic template emails bypass the
// whole review workflow (see product audit). opt in explicitly if you really
// want a test lead pre-approved.
app.post('/api/leads', requireAuth, async (req, res) => {
  try {
    const { name, email, organization, role, personalization, approvePersonalization = false } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and Email are required' });
    }

    const contact = await createOrUpdateContact({
      name,
      email,
      organization: organization || 'University',
      role: role || 'Professor',
      personalization: personalization || 'Recent paper on artificial intelligence',
      personalization_approved: Boolean(approvePersonalization),
    });

    // Mirrors the import pipeline: every contact gets a profile so enrichment
    // and AI personalization can target it (Research page, Regenerate button).
    await createOrUpdateProfile({
      contact_id: contact.id,
      full_name: name,
      organization: organization || 'University',
      role: role || 'Professor',
    });

    const campaign = await getOrCreateDefaultCampaign();
    const supabase = getSupabaseClient();

    const { data: outreach, error } = await supabase
      .from('outreach')
      .upsert({
        contact_id: contact.id,
        campaign_id: campaign.id,
        status: 'Ready',
        claim_id: null,
        claimed_at: null,
        sequence_step: 0,
        delivery_status: 'Pending',
      }, { onConflict: 'contact_id,campaign_id' })
      .select('*, contacts(*)')
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, contact, outreach });
  } catch (err) {
    logger.error('Error creating lead:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Register Cron Jobs & Start Server
// ----------------------------------------------------
scheduleOutreachJob();
scheduleFollowUpJob();
scheduleReplyCheckJob();
scheduleAirtableSyncJob();
scheduleCleanupStaleClaimsJob();
scheduleImportJob();
schedulePersonalizationJob();

if (config.env === 'production') {
  const usingDefaults = [];
  if (config.security.adminApiKey === 'dev_admin_key_123') usingDefaults.push('ADMIN_API_KEY');
  if (config.security.unsubscribeJwtSecret === 'super_secret_unsubscribe_jwt_key') usingDefaults.push('UNSUBSCRIBE_JWT_SECRET');
  if (config.security.webhookSecret === 'webhook_secret_key') usingDefaults.push('WEBHOOK_SECRET');
  if (usingDefaults.length > 0) {
    logger.warn(`SECURITY: production is running with default secrets (${usingDefaults.join(', ')}). Set strong random values in .env.`);
  }
}

app.listen(config.port, '0.0.0.0', () => {
  logger.info(`=======================================================`);
  logger.info(`🚀 Outreach Automation Backend V2 running on port ${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`Health check: ${config.baseUrl}/health`);
  logger.info(`Google OAuth URL: ${config.baseUrl}/auth/google`);
  logger.info(`=======================================================`);
});
