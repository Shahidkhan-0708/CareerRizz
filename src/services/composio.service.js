import { Composio } from '@composio/core';
import { config } from '../config/env.js';

const GMAIL_TOOLKIT = 'gmail';
const GMAIL_PROFILE_TOOL = 'GMAIL_GET_PROFILE';
const GMAIL_FETCH_TOOL = 'GMAIL_FETCH_EMAILS';
const LINKEDIN_TOOLKIT = 'linkedin';
const LINKEDIN_MY_INFO_TOOL = 'LINKEDIN_GET_MY_INFO';
const LINKEDIN_PERSON_TOOL = 'LINKEDIN_GET_PERSON';
const DEFAULT_INBOX_LIMIT = 10;
const MAX_INBOX_LIMIT = 25;

let client;

function requireComposioKey() {
  if (!config.composio?.apiKey) {
    throw new Error('Composio is not configured. Set COMPOSIO_API_KEY in .env.');
  }
}

function getComposioClient() {
  requireComposioKey();
  client ||= new Composio();
  return client;
}

function requireUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('A stable authenticated user ID is required for Composio.');
  }
}

export async function createComposioSession(userId) {
  requireUserId(userId);

  return getComposioClient().sessions.create(userId, {
    toolkits: [GMAIL_TOOLKIT],
    preload: { tools: [GMAIL_PROFILE_TOOL, GMAIL_FETCH_TOOL] },
    sandbox: { enable: false },
  });
}

export async function createLinkedInSession(userId) {
  requireUserId(userId);

  return getComposioClient().sessions.create(userId, {
    toolkits: [LINKEDIN_TOOLKIT],
    preload: { tools: [LINKEDIN_MY_INFO_TOOL, LINKEDIN_PERSON_TOOL] },
    sandbox: { enable: false },
  });
}

function findFirstByKey(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return null;

  for (const key of keys) {
    const candidate = value[key];
    if (candidate != null && ['string', 'number', 'boolean'].includes(typeof candidate)) {
      return candidate;
    }
  }

  for (const candidate of Object.values(value)) {
    const found = findFirstByKey(candidate, keys, depth + 1);
    if (found != null) return found;
  }

  return null;
}

function sanitizeLinkedInProfile(data) {
  return {
    personId: findFirstByKey(data, ['id', 'personId', 'person_id']),
    firstName: findFirstByKey(data, ['localizedFirstName', 'firstName', 'first_name']),
    lastName: findFirstByKey(data, ['localizedLastName', 'lastName', 'last_name']),
    headline: findFirstByKey(data, ['localizedHeadline', 'headline']),
    vanityName: findFirstByKey(data, ['vanityName', 'vanity_name']),
    profilePicture: findFirstByKey(data, ['profilePicture', 'profile_picture', 'profilePictureUrl']),
  };
}

function validateLinkedInPersonId(personId) {
  if (typeof personId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(personId)) {
    const error = new Error('personId must be a valid LinkedIn person identifier.');
    error.statusCode = 400;
    throw error;
  }
}

async function executeLinkedInProfileTool(userId, tool, arguments_ = {}) {
  const session = await createLinkedInSession(userId);
  const result = await session.execute(tool, arguments_);

  if (result.error) {
    const error = new Error(result.error);
    error.logId = result.logId;
    throw error;
  }

  return {
    sessionId: session.sessionId,
    tool,
    logId: result.logId,
    profile: sanitizeLinkedInProfile(result.data),
  };
}

export async function getLinkedInConnectionStatus(userId) {
  const session = await createLinkedInSession(userId);
  const result = await session.toolkits({ toolkits: [LINKEDIN_TOOLKIT], limit: 1 });
  const linkedin = result.items?.find((toolkit) => toolkit.slug === LINKEDIN_TOOLKIT);

  return {
    sessionId: session.sessionId,
    connected: Boolean(linkedin?.connection?.isActive),
    connectedAccountId: linkedin?.connection?.connectedAccount?.id || null,
  };
}

export async function createLinkedInConnectLink(userId) {
  const session = await createLinkedInSession(userId);
  const request = await session.authorize(LINKEDIN_TOOLKIT);

  return {
    sessionId: session.sessionId,
    connectionRequestId: request.id,
    redirectUrl: request.redirectUrl,
  };
}

export async function getMyLinkedInProfile(userId) {
  return executeLinkedInProfileTool(userId, LINKEDIN_MY_INFO_TOOL);
}

export async function getLinkedInPersonProfile(userId, personId) {
  validateLinkedInPersonId(personId);
  return executeLinkedInProfileTool(userId, LINKEDIN_PERSON_TOOL, { person_id: personId });
}

function validateInboxOptions({ limit, query, pageToken } = {}) {
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_INBOX_LIMIT;

  if (safeLimit < 1 || safeLimit > MAX_INBOX_LIMIT) {
    const error = new Error(`limit must be between 1 and ${MAX_INBOX_LIMIT}.`);
    error.statusCode = 400;
    throw error;
  }

  if (query != null && (typeof query !== 'string' || query.length > 500)) {
    const error = new Error('query must be a string of at most 500 characters.');
    error.statusCode = 400;
    throw error;
  }

  if (pageToken != null && (typeof pageToken !== 'string' || pageToken.length > 2048)) {
    const error = new Error('pageToken must be a valid string of at most 2048 characters.');
    error.statusCode = 400;
    throw error;
  }

  return {
    limit: safeLimit,
    query: query?.trim() || undefined,
    pageToken: pageToken || undefined,
  };
}

function toTimestamp(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function sanitizeInboxMessage(message) {
  return {
    messageId: message.messageId || null,
    threadId: message.threadId || null,
    subject: message.subject || null,
    sender: message.sender || null,
    to: message.to || null,
    timestamp: message.messageTimestamp || null,
    labelIds: Array.isArray(message.labelIds) ? message.labelIds : [],
  };
}

export async function getGmailConnectionStatus(userId) {
  const session = await createComposioSession(userId);
  const result = await session.toolkits({ toolkits: [GMAIL_TOOLKIT], limit: 1 });
  const gmail = result.items?.find((toolkit) => toolkit.slug === GMAIL_TOOLKIT);

  return {
    sessionId: session.sessionId,
    connected: Boolean(gmail?.connection?.isActive),
    connectedAccountId: gmail?.connection?.connectedAccount?.id || null,
  };
}

export async function createGmailConnectLink(userId, callbackUrl) {
  const session = await createComposioSession(userId);
  const request = await session.authorize(GMAIL_TOOLKIT, callbackUrl ? { callbackUrl } : undefined);

  return {
    sessionId: session.sessionId,
    connectionRequestId: request.id,
    redirectUrl: request.redirectUrl,
  };
}

export async function testGmailConnection(userId) {
  const session = await createComposioSession(userId);
  const result = await session.execute(GMAIL_PROFILE_TOOL, { user_id: 'me' });

  if (result.error) {
    const error = new Error(result.error);
    error.logId = result.logId;
    throw error;
  }

  return {
    sessionId: session.sessionId,
    tool: GMAIL_PROFILE_TOOL,
    logId: result.logId,
    profile: {
      emailAddress: result.data?.emailAddress || result.data?.email_address || null,
      messagesTotal: result.data?.messagesTotal ?? result.data?.messages_total ?? null,
      threadsTotal: result.data?.threadsTotal ?? result.data?.threads_total ?? null,
    },
  };
}

export async function fetchGmailInbox(userId, options = {}) {
  const { limit, query, pageToken } = validateInboxOptions(options);
  const session = await createComposioSession(userId);
  const arguments_ = {
    user_id: 'me',
    max_results: limit,
    label_ids: ['INBOX'],
    include_payload: false,
    include_spam_trash: false,
    verbose: false,
  };

  if (query) arguments_.query = query;
  if (pageToken) arguments_.page_token = pageToken;

  const result = await session.execute(GMAIL_FETCH_TOOL, arguments_);
  if (result.error) {
    const error = new Error(result.error);
    error.logId = result.logId;
    throw error;
  }

  const messages = (Array.isArray(result.data?.messages) ? result.data.messages : [])
    .map(sanitizeInboxMessage)
    .sort((a, b) => (toTimestamp(b.timestamp) || 0) - (toTimestamp(a.timestamp) || 0));

  return {
    sessionId: session.sessionId,
    tool: GMAIL_FETCH_TOOL,
    logId: result.logId,
    messages,
    nextPageToken: result.data?.nextPageToken || null,
  };
}
