import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGmailInbox, getLinkedInPersonProfile } from '../src/services/composio.service.js';

test('Gmail inbox read rejects a limit above the server cap', async () => {
  await assert.rejects(
    fetchGmailInbox('test-user', { limit: 26 }),
    /limit must be between 1 and 25/,
  );
});

test('Gmail inbox read rejects an oversized search query', async () => {
  await assert.rejects(
    fetchGmailInbox('test-user', { query: 'x'.repeat(501) }),
    /query must be a string of at most 500 characters/,
  );
});

test('Gmail inbox read rejects an oversized pagination token', async () => {
  await assert.rejects(
    fetchGmailInbox('test-user', { pageToken: 'x'.repeat(2049) }),
    /pageToken must be a valid string of at most 2048 characters/,
  );
});

test('LinkedIn person read rejects an invalid contextual person ID', async () => {
  await assert.rejects(
    getLinkedInPersonProfile('test-user', 'https://linkedin.com/in/not-a-person-id'),
    /personId must be a valid LinkedIn person identifier/,
  );
});
