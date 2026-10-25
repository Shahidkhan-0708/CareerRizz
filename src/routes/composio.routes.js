import express from 'express';
import { requireAuth } from '../middleware/supabase-auth.js';
import { logger } from '../utils/logger.js';
import {
  createGmailConnectLink,
  createLinkedInConnectLink,
  fetchGmailInbox,
  getGmailConnectionStatus,
  getLinkedInConnectionStatus,
  getLinkedInPersonProfile,
  getMyLinkedInProfile,
  testGmailConnection,
} from '../services/composio.service.js';

export const composioRouter = express.Router();

composioRouter.use(requireAuth);

function fail(res, error, label) {
  logger.error(label, { error: error.message, logId: error.logId || undefined });
  res.status(error.statusCode || 502).json({
    success: false,
    error: error.message,
    logId: error.logId || null,
  });
}

composioRouter.get('/integrations/composio/gmail', async (req, res) => {
  try {
    const status = await getGmailConnectionStatus(req.user.id);
    res.json({ success: true, integration: 'gmail', ...status });
  } catch (error) {
    fail(res, error, 'Could not read Composio Gmail connection status');
  }
});

composioRouter.post('/integrations/composio/gmail/connect', async (req, res) => {
  try {
    const connection = await createGmailConnectLink(req.user.id);
    res.status(201).json({ success: true, integration: 'gmail', ...connection });
  } catch (error) {
    fail(res, error, 'Could not create Composio Gmail Connect Link');
  }
});

composioRouter.post('/integrations/composio/gmail/test', async (req, res) => {
  try {
    const result = await testGmailConnection(req.user.id);
    res.json({ success: true, ...result });
  } catch (error) {
    fail(res, error, 'Composio Gmail test call failed');
  }
});

composioRouter.get('/integrations/composio/gmail/inbox', async (req, res) => {
  try {
    const result = await fetchGmailInbox(req.user.id, {
      limit: req.query.limit,
      query: req.query.query,
      pageToken: req.query.pageToken,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    fail(res, error, 'Composio Gmail inbox read failed');
  }
});

composioRouter.get('/integrations/composio/linkedin', async (req, res) => {
  try {
    const status = await getLinkedInConnectionStatus(req.user.id);
    res.json({ success: true, integration: 'linkedin', ...status });
  } catch (error) {
    fail(res, error, 'Could not read Composio LinkedIn connection status');
  }
});

composioRouter.post('/integrations/composio/linkedin/connect', async (req, res) => {
  try {
    const connection = await createLinkedInConnectLink(req.user.id);
    res.status(201).json({ success: true, integration: 'linkedin', ...connection });
  } catch (error) {
    fail(res, error, 'Could not create Composio LinkedIn Connect Link');
  }
});

composioRouter.get('/integrations/composio/linkedin/me', async (req, res) => {
  try {
    const result = await getMyLinkedInProfile(req.user.id);
    res.json({ success: true, ...result });
  } catch (error) {
    fail(res, error, 'Composio LinkedIn self-profile read failed');
  }
});

composioRouter.get('/integrations/composio/linkedin/people/:personId', async (req, res) => {
  try {
    const result = await getLinkedInPersonProfile(req.user.id, req.params.personId);
    res.json({ success: true, ...result });
  } catch (error) {
    fail(res, error, 'Composio LinkedIn person-profile read failed');
  }
});
