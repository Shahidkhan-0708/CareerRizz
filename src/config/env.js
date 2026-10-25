import dotenv from 'dotenv';

dotenv.config();

function getEnv(key, defaultValue = undefined, required = false) {
  const value = process.env[key] || defaultValue;
  if (required && (value === undefined || value === '')) {
    throw new Error(`[Config Error] Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = Object.freeze({
  env: getEnv('NODE_ENV', 'development'),
  port: parseInt(getEnv('PORT', '5000'), 10),
  baseUrl: getEnv('BASE_URL', 'http://localhost:5000'),

  supabase: {
    url: getEnv('SUPABASE_URL', '', false),
    serviceKey: getEnv('SUPABASE_SERVICE_KEY', '', false),
    anonKey: getEnv('SUPABASE_ANON_KEY', '', false),
  },

  airtable: {
    token: getEnv('AIRTABLE_TOKEN', '', false),
    baseId: getEnv('AIRTABLE_BASE_ID', '', false),
    tableName: getEnv('AIRTABLE_TABLE_NAME', 'Outreach'),
  },

  smtp: {
    host: getEnv('SMTP_HOST', 'smtp.mailtrap.io'),
    port: parseInt(getEnv('SMTP_PORT', '587'), 10),
    secure: getEnv('SMTP_SECURE', 'false') === 'true',
    user: getEnv('SMTP_USER', ''),
    pass: getEnv('SMTP_PASS', ''),
    fromEmail: getEnv('MAIL_FROM_EMAIL', 'shahid@gmail.com'),
    fromName: getEnv('MAIL_FROM_NAME', 'Shahid'),
  },

  gmail: {
    clientId: getEnv('GMAIL_CLIENT_ID', ''),
    clientSecret: getEnv('GMAIL_CLIENT_SECRET', ''),
    redirectUri: getEnv('GMAIL_REDIRECT_URI', 'http://localhost:5000/auth/google/callback'),
    refreshToken: getEnv('GMAIL_REFRESH_TOKEN', ''),
  },

  ai: {
    apiKey: getEnv('OPENAI_API_KEY', ''),
    model: getEnv('OPENAI_MODEL', 'gpt-4o'),
  },

  outreach: {
    dailySendLimit: parseInt(getEnv('DAILY_SEND_LIMIT', '10'), 10),
    followup1Days: parseInt(getEnv('FOLLOWUP_1_DAYS', '7'), 10),
    followup2Days: parseInt(getEnv('FOLLOWUP_2_DAYS', '14'), 10),
    sendDelayMs: parseInt(getEnv('SEND_DELAY_MS', '2000'), 10),
    smtpConcurrency: parseInt(getEnv('SMTP_CONCURRENCY', '1'), 10),
  },

  processing: {
    personalizationConcurrency: parseInt(getEnv('PERSONALIZATION_CONCURRENCY', '5'), 10),
    // How many profiles the research batch job researches in parallel (kept
    // low on purpose — public web sources must be treated politely).
    researchConcurrency: parseInt(getEnv('RESEARCH_CONCURRENCY', '3'), 10),
  },

  apify: {
    token: getEnv('APIFY_TOKEN', ''),
  },

  composio: {
    apiKey: getEnv('COMPOSIO_API_KEY', ''),
  },

  security: {
    adminApiKey: getEnv('ADMIN_API_KEY', 'dev_admin_key_123'),
    unsubscribeJwtSecret: getEnv('UNSUBSCRIBE_JWT_SECRET', 'super_secret_unsubscribe_jwt_key'),
    webhookSecret: getEnv('WEBHOOK_SECRET', 'webhook_secret_key'),
  },
});
