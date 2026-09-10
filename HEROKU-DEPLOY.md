# Heroku Deployment Guide

## Prerequisites

- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- Heroku account with Student Developer Pack credit ($13/mo for 24 months)
- All env vars ready (see `.env.example`)

## 1. Create the Heroku app

```bash
heroku login
heroku create your-app-name
```

## 2. Set environment variables

```bash
# Required
heroku config:set NODE_ENV=production
heroku config:set BASE_URL=https://your-app-name.herokuapp.com
heroku config:set SUPABASE_URL=https://your-project.supabase.co
heroku config:set SUPABASE_SERVICE_KEY=your-service-key
heroku config:set SUPABASE_ANON_KEY=your-anon-key
heroku config:set ADMIN_API_KEY=$(openssl rand -hex 32)
heroku config:set UNSUBSCRIBE_JWT_SECRET=$(openssl rand -hex 32)
heroku config:set WEBHOOK_SECRET=$(openssl rand -hex 32)
heroku config:set OPENAI_API_KEY=sk-your-key
heroku config:set OPENAI_MODEL=gpt-4o

# SMTP
heroku config:set SMTP_HOST=smtp-relay.brevo.com
heroku config:set SMTP_PORT=587
heroku config:set SMTP_SECURE=false
heroku config:set SMTP_USER=your-smtp-user
heroku config:set SMTP_PASS=your-smtp-pass
heroku config:set MAIL_FROM_EMAIL=your-outreach@your-domain.com
heroku config:set MAIL_FROM_NAME="Your Org Name"

# Gmail (optional — for reply detection)
heroku config:set GMAIL_CLIENT_ID=your-client-id
heroku config:set GMAIL_CLIENT_SECRET=your-client-secret
heroku config:set GMAIL_REDIRECT_URI=https://your-app-name.herokuapp.com/auth/google/callback
heroku config:set GMAIL_REFRESH_TOKEN=your-refresh-token

# Airtable (optional — for dashboard sync)
heroku config:set AIRTABLE_TOKEN=pat_your_token
heroku config:set AIRTABLE_BASE_ID=app_your_base_id
heroku config:set AIRTABLE_TABLE_NAME=Outreach

# Outreach config (optional — defaults work fine)
heroku config:set DAILY_SEND_LIMIT=10

heroku config:set FOLLOWUP_1_DAYS=7
heroku config:set FOLLOWUP_2_DAYS=14
heroku config:set SEND_DELAY_MS=2000
heroku config:set SMTP_CONCURRENCY=1
heroku config:set PERSONALIZATION_CONCURRENCY=5
```

## 3. Build frontend with API key

Before deploying, build the frontend with your admin key embedded:

```bash
cd f && VITE_ADMIN_API_KEY=your-admin-api-key npm run build && cd ..
```

The `VITE_ADMIN_API_KEY` must match the `ADMIN_API_KEY` you set above.

## 4. Deploy

```bash
git add Procfile package.json HEROKU-DEPLOY.md
git commit -m "chore: add Heroku deployment config"
git push heroku main
```

Heroku will:
1. Detect the Node.js buildpack
2. Run `npm install` (backend deps)
3. Run `heroku-postbuild` → installs frontend deps + builds `f/dist`
4. Start with `node src/server.js` (from Procfile)

## 5. Verify

```bash
# Check logs
heroku logs --tail

# Health check
curl https://your-app-name.herokuapp.com/health

# Open the app
heroku open
```

## 6. Apply DB migrations

In the **Supabase SQL Editor**, run each file from `db/migrations/` in order.

## 7. Gmail OAuth (first-time setup)

1. Visit `https://your-app-name.herokuapp.com/auth/google`
2. Authorize with your Gmail account
3. Copy the refresh token
4. Set it: `heroku config:set GMAIL_REFRESH_TOKEN=the-token`

## Troubleshooting

### App crashes on start
```bash
heroku logs --tail
```
Common causes:
- Missing env vars (the app doesn't fail fast — check logs for runtime errors)
- `SUPABASE_SERVICE_KEY` or `OPENAI_API_KEY` not set

### Frontend not loading
- Make sure you built with `VITE_ADMIN_API_KEY` set
- Check `heroku logs` for static file serving errors

### Memory errors during OCR
- Heroku Basic dyno has 512 MB
- Large scanned PDFs with tesseract.js can be memory-heavy
- Consider upgrading to a Standard dyno ($25/mo, 1 GB RAM) if needed

### Cron jobs not running
- They run inside the Node.js process — if the app is up, jobs are running
- Check `heroku logs` for job execution messages
- Trigger manually: `curl -X POST https://your-app-name.herokuapp.com/api/trigger/outreach -H "x-api-key: YOUR_ADMIN_API_KEY"`
