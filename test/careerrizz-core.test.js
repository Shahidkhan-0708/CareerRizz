import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRawHtml, fallbackHeuristicExtract, ExtractedKeywordsSchema } from '../src/services/workers/filters/keyword-extractor.js';
import { enqueueOutreachTask, getNextPendingOutreachTask } from '../src/services/workers/queues/outreach-bridge.js';

test('Keyword Extractor: sanitizeRawHtml strips scripts, styles and HTML tags cleanly', () => {
  const dirtyHtml = `
    <html>
      <head>
        <script>alert("malicious script");</script>
        <style>.job-title { color: red; }</style>
      </head>
      <body>
        <div class="job-header">
          <h1>Senior Full-Stack Engineer &amp; Architect</h1>
          <p>We are looking for a rockstar with 5+ years of experience in <strong>TypeScript</strong> and <em>React</em>.</p>
          <noscript>Please enable javascript</noscript>
        </div>
      </body>
    </html>
  `;

  const clean = sanitizeRawHtml(dirtyHtml);
  assert.ok(!clean.includes('<script>'));
  assert.ok(!clean.includes('alert'));
  assert.ok(!clean.includes('<style>'));
  assert.ok(!clean.includes('.job-title'));
  assert.ok(!clean.includes('<noscript>'));
  assert.ok(!clean.includes('<div>'));
  assert.ok(!clean.includes('<strong>'));
  assert.ok(clean.includes('Senior Full-Stack Engineer & Architect'));
  assert.ok(clean.includes('TypeScript'));
  assert.ok(clean.includes('5+ years of experience'));
});

test('Keyword Extractor: fallbackHeuristicExtract extracts hard engineering tags and YOE', () => {
  const sampleDescription = `
    About the Role:
    We are seeking a Backend Infrastructure Engineer.
    Requirements:
    - 4+ years of experience building distributed systems.
    - Strong proficiency in TypeScript, Python, and Go.
    - Deep hands-on experience with FastAPI, Express, and React.
    - Production database experience with PostgreSQL and Redis.
    - Cloud infrastructure familiarity with Docker, Kubernetes, and AWS.
  `;

  const extracted = fallbackHeuristicExtract(sampleDescription);

  assert.equal(extracted.min_years_experience, 4);
  assert.ok(extracted.languages.includes('typescript'));
  assert.ok(extracted.languages.includes('python'));
  assert.ok(extracted.languages.includes('go'));
  assert.ok(extracted.frameworks.includes('fastapi'));
  assert.ok(extracted.frameworks.includes('express'));
  assert.ok(extracted.databases.includes('postgresql'));
  assert.ok(extracted.databases.includes('redis'));
  assert.ok(extracted.infrastructure.includes('docker'));
  assert.ok(extracted.infrastructure.includes('aws'));

  // Validate shape against Zod schema
  const validation = ExtractedKeywordsSchema.safeParse(extracted);
  assert.equal(validation.success, true);
});

test('Outreach Bridge: Buffers task into staged queue and retrieves next task', async () => {
  const mockTask = {
    taskId: 'test-task-' + Date.now(),
    userId: 'user-123',
    status: 'APPROVED',
    targetUrl: 'https://linkedin.com/in/test-recruiter',
    messageText: 'Hello, I have submitted my tailored application for the Senior Engineer opening.',
  };

  await enqueueOutreachTask(mockTask);
  const task = await getNextPendingOutreachTask();

  assert.ok(task !== null);
  assert.equal(task.status, 'APPROVED');
  assert.equal(task.targetUrl, mockTask.targetUrl);
  assert.equal(task.messageText, mockTask.messageText);
});
