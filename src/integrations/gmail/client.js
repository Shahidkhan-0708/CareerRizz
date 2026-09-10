import { google } from 'googleapis';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { extractEmailAddress, extractPlainTextBody } from '../../utils/email-parser.js';
import { mapWithConcurrency } from '../../utils/pool.js';

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
}

export function generateAuthUrl() {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
  });
}

export async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export function getAuthenticatedGmailClient() {
  const oauth2Client = getOAuth2Client();
  if (config.gmail.refreshToken) {
    oauth2Client.setCredentials({ refresh_token: config.gmail.refreshToken });
  } else {
    logger.warn('GMAIL_REFRESH_TOKEN is missing in env. Gmail API calls may fail until authorized.');
  }
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export async function getRecentReplies(afterTimestampDate = null) {
  try {
    if (!config.gmail.refreshToken) {
      logger.warn('GMAIL_REFRESH_TOKEN is not configured. Visit /auth/google to authorize Gmail.');
      return [];
    }

    const gmail = getAuthenticatedGmailClient();

    // Convert date to epoch seconds for Gmail search query if provided
    let query = 'is:inbox';
    if (afterTimestampDate) {
      const epochSeconds = Math.floor(new Date(afterTimestampDate).getTime() / 1000);
      query += ` after:${epochSeconds}`;
    }

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) return [];

    const replyDetails = await mapWithConcurrency(messages, 10, async (msgSummary) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgSummary.id,
          format: 'full',
        });

        const messageData = msgRes.data;
        const headers = messageData.payload?.headers || [];

        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        const dateHeader = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
        const inReplyTo = headers.find(h => h.name.toLowerCase() === 'in-reply-to')?.value || '';
        const references = headers.find(h => h.name.toLowerCase() === 'references')?.value || '';

        const senderEmail = extractEmailAddress(fromHeader);
        const bodyText = extractPlainTextBody(messageData.payload);

        return {
          id: messageData.id,
          threadId: messageData.threadId,
          fromEmail: senderEmail,
          rawFrom: fromHeader,
          subject: subjectHeader,
          receivedAt: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
          body: bodyText,
          inReplyTo,
          references,
        };
      } catch (msgErr) {
        logger.warn(`Failed to fetch details for Gmail message ${msgSummary.id}:`, { error: msgErr.message });
        return null;
      }
    });

    return replyDetails.filter(Boolean);
  } catch (err) {
    if (err.message === 'invalid_grant' || err.code === 400 || err.code === 401) {
      logger.error('Error fetching recent Gmail replies: Gmail OAuth token expired or revoked (invalid_grant). Please visit http://localhost:5000/auth/google to obtain a fresh refresh token.', { error: err.message });
    } else {
      logger.error('Error fetching recent Gmail replies:', { error: err.message });
    }
    return [];
  }
}

export async function testGmail(req, res) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      config.gmail.clientId,
      config.gmail.clientSecret,
      config.gmail.redirectUri
    );

    oauth2Client.setCredentials({
      refresh_token: config.gmail.refreshToken
    });

    const gmail = google.gmail({
      version: 'v1',
      auth: oauth2Client
    });

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10
    });

    res.json({
      success: true,
      messages: response.data.messages || [],
      resultSizeEstimate: response.data.resultSizeEstimate || 0
    });

  } catch (error) {
    logger.error('Gmail API test failed:', { error: error.message });

    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
}

