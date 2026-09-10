import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Job Search API-level tests — require a running backend (default :5000).
// Uses a real Supabase JWT via /auth/signup + /auth/login.
// If the backend is down, the suite is skipped.
// ---------------------------------------------------------------------------

const BASE = process.env.API_BASE_URL || 'http://localhost:5000';
let up = false;
let ownerToken = null;
let operatorToken = null;
let ownerId = null;
let hasJobSearchAccess = false;

const OWNER_EMAIL = `js-test-owner-${Date.now()}@test.com`;
const OPERATOR_EMAIL = `js-test-operator-${Date.now()}@test.com`;
const PASSWORD = 'TestPass123!';

async function authedFetch(path, token, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// --- Setup ---

before(async () => {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    up = res.ok;
  } catch {
    up = false;
  }

  if (!up) return;

  // Sign up owner
  const ownerRes = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD, name: 'Test Owner' }),
  });
  const ownerData = await ownerRes.json();
  ownerToken = ownerData.session?.access_token;
  ownerId = ownerData.user?.id;

  // Check if this user actually got owner role + job_search module
  if (ownerToken) {
    const profileRes = await authedFetch('/auth/profile', ownerToken);
    const profile = profileRes.body?.profile;
    hasJobSearchAccess = profile?.role === 'owner' ||
      (profile?.enabled_modules || []).includes('job_search');
  }

  // Sign up operator
  const opRes = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OPERATOR_EMAIL, password: PASSWORD, name: 'Test Operator' }),
  });
  const opData = await opRes.json();
  operatorToken = opData.session?.access_token;
});

function requireSetup(t) {
  if (!up) { t.skip('backend not running — run npm start first'); throw new Error('skip'); }
  if (!ownerToken) { t.skip('owner auth failed'); throw new Error('skip'); }
}

function requireJobSearch(t) {
  requireSetup(t);
  if (!hasJobSearchAccess) { t.skip('owner does not have job_search module (existing profiles in DB)'); throw new Error('skip'); }
}

// ===========================================================================
// RBAC enforcement — operator should be blocked from job_search routes
// ===========================================================================

test('RBAC: operator blocked from GET /api/jobs', async (t) => {
  requireSetup(t);
  if (!operatorToken) return t.skip('operator auth failed');
  const { status, body } = await authedFetch('/api/jobs', operatorToken);
  assert.equal(status, 403);
  assert.equal(body.error, 'Forbidden');
  assert.match(body.message, /job_search/);
});

test('RBAC: operator blocked from POST /api/jobs', async (t) => {
  requireSetup(t);
  if (!operatorToken) return t.skip('operator auth failed');
  const { status, body } = await authedFetch('/api/jobs', operatorToken, {
    method: 'POST',
    body: JSON.stringify({ title: 'Blocked', company: 'Test' }),
  });
  assert.equal(status, 403);
  assert.match(body.message, /job_search/);
});

test('RBAC: operator blocked from GET /api/applications', async (t) => {
  requireSetup(t);
  if (!operatorToken) return t.skip('operator auth failed');
  const { status } = await authedFetch('/api/applications', operatorToken);
  assert.equal(status, 403);
});

test('RBAC: operator blocked from GET /api/recruiter-outreach', async (t) => {
  requireSetup(t);
  if (!operatorToken) return t.skip('operator auth failed');
  const { status } = await authedFetch('/api/recruiter-outreach', operatorToken);
  assert.equal(status, 403);
});

test('RBAC: operator blocked from GET /api/job-stats', async (t) => {
  requireSetup(t);
  if (!operatorToken) return t.skip('operator auth failed');
  const { status } = await authedFetch('/api/job-stats', operatorToken);
  assert.equal(status, 403);
});

test('RBAC: operator blocked from GET /api/follow-ups', async (t) => {
  requireSetup(t);
  if (!operatorToken) return t.skip('operator auth failed');
  const { status } = await authedFetch('/api/follow-ups', operatorToken);
  assert.equal(status, 403);
});

test('RBAC: no auth → 401 on job search routes', async (t) => {
  requireSetup(t);
  const res = await fetch(`${BASE}/api/jobs`);
  assert.equal(res.status, 401);
});

// ===========================================================================
// Job Discovery CRUD (only if owner has job_search access)
// ===========================================================================

test('POST /api/jobs — creates a job', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/jobs', ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Test Engineer',
      company: 'TestCorp',
      location: 'Remote',
      description: 'Build things',
      source: 'LinkedIn',
    }),
  });
  assert.equal(status, 201);
  assert.equal(body.success, true);
  assert.equal(body.job.title, 'Test Engineer');
  assert.equal(body.job.company, 'TestCorp');
  assert.equal(body.job.status, 'discovered');
  assert.ok(body.job.id);
});

test('GET /api/jobs — lists jobs for the authenticated user', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/jobs', ownerToken);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.jobs));
  assert.ok(body.jobs.length >= 1, 'expected at least 1 job');
  assert.equal(body.jobs[0].title, 'Test Engineer');
});

test('PATCH /api/jobs/:id — updates job status', async (t) => {
  requireJobSearch(t);
  const { body: list } = await authedFetch('/api/jobs', ownerToken);
  const jobId = list.jobs[0]?.id;
  if (!jobId) return t.skip('no jobs to update');

  const { status, body } = await authedFetch(`/api/jobs/${jobId}`, ownerToken, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'researching' }),
  });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.job.status, 'researching');
});

test('POST /api/jobs — rejects missing required fields', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/jobs', ownerToken, {
    method: 'POST',
    body: JSON.stringify({ title: 'No Company' }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /Title and company are required/);
});

// ===========================================================================
// Job Research
// ===========================================================================

test('POST /api/jobs/:id/research — fetches company research', async (t) => {
  requireJobSearch(t);
  const { body: list } = await authedFetch('/api/jobs', ownerToken);
  const jobId = list.jobs[0]?.id;
  if (!jobId) return t.skip('no jobs to research');

  const { status, body } = await authedFetch(`/api/jobs/${jobId}/research`, ownerToken, {
    method: 'POST',
  });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.facts));
  assert.ok(body.job.notes !== undefined, 'job notes should be updated');
});

// ===========================================================================
// Resumes
// ===========================================================================

test('POST /api/resumes/upload — uploads a text resume', async (t) => {
  requireJobSearch(t);
  const formData = new FormData();
  const blob = new Blob(['John Doe\nSoftware Engineer\nSkills: JavaScript, React'], { type: 'text/plain' });
  formData.append('resume', blob, 'test-resume.txt');

  const res = await fetch(`${BASE}/api/resumes/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: formData,
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.resume.filename, 'test-resume.txt');
  assert.ok(body.resume.id);
});

test('GET /api/resumes — lists uploaded resumes', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/resumes', ownerToken);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.resumes));
  assert.ok(body.resumes.length >= 1, 'expected at least 1 resume');
});

// ===========================================================================
// Recruiter Outreach
// ===========================================================================

test('POST /api/recruiter-outreach — creates outreach record', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/recruiter-outreach', ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      recruiter_name: 'Jane Smith',
      recruiter_email: 'jane@testcorp.com',
      company: 'TestCorp',
    }),
  });
  assert.equal(status, 201);
  assert.equal(body.success, true);
  assert.equal(body.outreach.recruiter_name, 'Jane Smith');
  assert.equal(body.outreach.status, 'draft');
});

test('GET /api/recruiter-outreach — lists outreach records', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/recruiter-outreach', ownerToken);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.outreach));
  assert.ok(body.outreach.length >= 1);
});

test('POST /api/recruiter-outreach — rejects missing required fields', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/recruiter-outreach', ownerToken, {
    method: 'POST',
    body: JSON.stringify({ company: 'No Name' }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /Recruiter name and email are required/);
});

// ===========================================================================
// Follow-ups
// ===========================================================================

test('GET /api/follow-ups — returns an array', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/follow-ups', ownerToken);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.followUps));
});

// ===========================================================================
// Job Stats & Timeline
// ===========================================================================

test('GET /api/job-stats — returns aggregate stats', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/job-stats', ownerToken);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(typeof body.stats.totalJobs, 'number');
  assert.equal(typeof body.stats.totalApplications, 'number');
  assert.equal(typeof body.stats.interviews, 'number');
  assert.equal(typeof body.stats.offers, 'number');
  assert.equal(typeof body.stats.recruiterOutreach, 'number');
  assert.ok(body.stats.byStatus);
});

test('GET /api/job-timeline — returns timeline events', async (t) => {
  requireJobSearch(t);
  const { status, body } = await authedFetch('/api/job-timeline', ownerToken);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.events));
  assert.ok(body.events.length >= 1, 'expected at least 1 timeline event');
  assert.ok(body.events[0].type);
  assert.ok(body.events[0].date);
  assert.ok(body.events[0].title);
});

// ===========================================================================
// Cleanup
// ===========================================================================

test('DELETE /api/jobs/:id — cleans up test jobs', async (t) => {
  requireJobSearch(t);
  const { body: list } = await authedFetch('/api/jobs', ownerToken);
  for (const job of list.jobs || []) {
    await authedFetch(`/api/jobs/${job.id}`, ownerToken, { method: 'DELETE' });
  }
  const { body: after } = await authedFetch('/api/jobs', ownerToken);
  assert.equal(after.jobs.length, 0);
});
