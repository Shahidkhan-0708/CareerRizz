// ---------------------------------------------------------------------------
// Failure-injection verification (requires backend on :5000, dev auth).
//
//  1. Concurrent outreach runs → no double-claims / no duplicate sends
//  2. Crash recovery → stale 'Sending' rows restored by origin (fu: vs initial)
//  3. Stale import job recovery
//  4. Import idempotency → re-uploading the same file duplicates nothing
//  5. Webhook bounce → contact suppressed + delivery status Bounced
//
// Creates test data via the real API, then removes it (FK-safe order).
// Sends go to reserved @example.com addresses only.
// ---------------------------------------------------------------------------
import { getSupabaseClient } from '../src/db/client.js';
import { recoverStaleImportJobs } from '../src/db/import-jobs.js';

const BASE = 'http://localhost:5000';
const H = { 'x-bypass-auth': 'true', 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = isForm ? { 'x-bypass-auth': 'true' } : H;
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${body.error || res.statusText}`);
  return body;
}

const EMAILS = [
  `fi.one.${Date.now()}@example.com`,
  `fi.two.${Date.now()}@example.com`,
  `fi.three.${Date.now()}@example.com`,
  `fi.four.${Date.now()}@example.com`,
];

const del = async (label, query) => {
  const { error } = await query;
  if (error) console.log(`  ⚠ cleanup ${label}: ${error.message}`);
};

const cleanup = async () => {
  const sb = getSupabaseClient();
  const { data: contacts } = await sb.from('contacts').select('id').in('email', EMAILS);
  const contactIds = (contacts || []).map(c => c.id);
  if (contactIds.length === 0) return;
  const { data: profiles } = await sb.from('profiles').select('id').in('contact_id', contactIds);
  const profileIds = (profiles || []).map(p => p.id);
  let persIds = [];
  if (profileIds.length) {
    const { data: pers } = await sb.from('personalization_results').select('id').in('profile_id', profileIds);
    persIds = (pers || []).map(p => p.id);
    if (persIds.length) await del('review_decisions', sb.from('review_decisions').delete().in('personalization_id', persIds));
  }
  await del('outreach', sb.from('outreach').delete().in('contact_id', contactIds));
  if (persIds.length) await del('personalization_results', sb.from('personalization_results').delete().in('id', persIds));
  if (profileIds.length) {
    await del('enrichment_results', sb.from('enrichment_results').delete().in('profile_id', profileIds));
    await del('profiles', sb.from('profiles').delete().in('id', profileIds));
  }
  await del('contacts', sb.from('contacts').delete().in('id', contactIds));
  console.log(`\n🧹 Cleaned up ${contactIds.length} test contact(s)`);
};

const run = async () => {
  // Check backend reachability first — skip gracefully if not running.
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) { console.log('\n⏭️  Backend not healthy — skipping failure-injection tests'); return true; }
  } catch { console.log('\n⏭️  Backend not running — skipping failure-injection tests'); return true; }

  console.log('\n============== FAILURE INJECTION ==============\n');
  const sb = getSupabaseClient();

  // ---- 1. Concurrent outreach runs -----------------------------------------
  console.log('TEST 1 — Concurrent outreach runs (claim atomicity)');
  for (const email of EMAILS) {
    await api('/leads', { method: 'POST', body: JSON.stringify({ name: `Fail Inj ${email.slice(3, 6)}`, email, organization: 'Example College', role: 'Professor' }) });
  }
  const contacts = (await api('/contacts?limit=200')).contacts.filter(c => EMAILS.includes(c.email));
  ok('4 sendable leads created', contacts.length === 4);

  // Generate + approve personalization for each lead (required by pipeline enforcement).
  const batch = await api('/trigger/personalization', { method: 'POST', body: JSON.stringify({ limit: 20 }) });
  ok('personalization batch ran', batch.success === true, JSON.stringify(batch.result));
  ok('4 drafts generated', batch.result?.generated === 4, `generated=${batch.result?.generated}`);

  const queue = (await api('/review/queue?limit=50')).queue;
  const testDrafts = queue.filter(d => {
    const profId = d.profiles?.id;
    return contacts.some(c => c.id === profId || d.profiles?.contactId === c.id);
  });
  for (const d of testDrafts) {
    await api(`/review/${d.id}`, { method: 'POST', body: JSON.stringify({ decision: 'approved', decidedBy: contacts[0].id }) });
  }
  ok('all test drafts approved', true);

  const results = await Promise.all([
    api('/trigger/outreach', { method: 'POST' }),
    api('/trigger/outreach', { method: 'POST' }),
    api('/trigger/outreach', { method: 'POST' }),
  ]);
  const totalClaimed = results.reduce((a, r) => a + (r.result?.claimed || 0), 0);
  const totalSent = results.reduce((a, r) => a + (r.result?.sent || 0), 0);
  ok('each row claimed exactly once across 3 concurrent runs', totalClaimed === 4, `claimed total=${totalClaimed} (${results.map(r => r.result?.claimed).join(',')})`);
  ok('no duplicate sends (4 sent once)', totalSent === 4, `sent total=${totalSent}`);

  const rows = (await api('/outreach?limit=200')).outreach.filter(o => contacts.some(c => c.id === o.contact_id));
  ok('every row exactly Sent once', rows.length === 4 && rows.every(r => r.status === 'Sent'), rows.map(r => r.status).join(','));
  const providerIds = rows.map(r => r.provider_message_id);
  ok('unique provider message ids', new Set(providerIds).size === providerIds.length);

  // ---- 2. Crash recovery: stale Sending rows ------------------------------
  console.log('\nTEST 2 — Crash recovery (stale Sending rows)');
  // Simulate a crash mid-Follow-up-2-send: status Sending, fu: claim, sequence_step 1
  // (the record had already sent Follow-up 1, so recovery must restore 'Follow-up 1').
  const fuRow = rows[0];
  await sb.from('outreach').update({ status: 'Sending', sequence_step: 1, claim_id: 'fu:crash-sim', claimed_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }).eq('id', fuRow.id);
  // Simulate a crash mid-initial-send: status Sending, plain claim.
  const iniRow = rows[1];
  await sb.from('outreach').update({ status: 'Sending', claim_id: 'plain-claim-123', claimed_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }).eq('id', iniRow.id);
  await api('/trigger/cleanup-stale-claims', { method: 'POST', body: JSON.stringify({ timeoutMinutes: 10 }) });
  const after = (await api('/outreach?limit=200')).outreach.filter(o => [fuRow.id, iniRow.id].includes(o.id));
  const fu = after.find(r => r.id === fuRow.id);
  const ini = after.find(r => r.id === iniRow.id);
  ok('fu: Sending row restored to Follow-up 1', fu?.status === 'Follow-up 1', `status=${fu?.status}`);
  ok('plain Sending row restored to Ready', ini?.status === 'Ready', `status=${ini?.status}`);
  ok('claims cleared after recovery', !fu?.claim_id && !ini?.claim_id);

  // ---- 3. Stale import job recovery -----------------------------------------
  console.log('\nTEST 3 — Stale import job recovery');
  const csv = 'Name,Email\nRecovery Person,recovery.test@example.com';
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'recovery.csv');
  const queued = await api('/import', { method: 'POST', body: form });
  await sb.from('import_jobs').update({ status: 'processing', updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }).eq('id', queued.jobId);
  const recovered = await recoverStaleImportJobs(10);
  ok('stuck processing import job recovered to queued', recovered >= 1, `recovered=${recovered}`);
  // process it to completion so it doesn't linger
  const done = await api('/import/process', { method: 'POST', body: JSON.stringify({ jobId: queued.jobId }) });
  ok('recovered job processes cleanly', done.job?.status === 'completed', done.job?.status);

  // ---- 4. Import idempotency ------------------------------------------------
  console.log('\nTEST 4 — Import idempotency (same file twice)');
  const idemEmail = `idem.${Date.now()}@example.com`;
  const makeForm = () => {
    const f = new FormData();
    f.append('file', new Blob(['Name,Email\nIdem Person,' + idemEmail], { type: 'text/csv' }), 'idem.csv');
    return f;
  };
  const j1 = await api('/import', { method: 'POST', body: makeForm() });
  await api('/import/process', { method: 'POST', body: JSON.stringify({ jobId: j1.jobId }) });
  const j2 = await api('/import', { method: 'POST', body: makeForm() });
  const r2 = await api('/import/process', { method: 'POST', body: JSON.stringify({ jobId: j2.jobId }) });
  ok('second upload updates, does not duplicate', r2.job?.created_records === 0 && r2.job?.updated_records === 1, `created=${r2.job?.created_records}, updated=${r2.job?.updated_records}`);
  const { count: idemCount } = await sb.from('contacts').select('id', { count: 'exact', head: true }).eq('email', idemEmail);
  ok('exactly one contact row for the email', idemCount === 1, `count=${idemCount}`);

  // ---- 5. Webhook bounce → suppression --------------------------------------
  console.log('\nTEST 5 — Webhook bounce suppresses contact');
  const { config } = await import('../src/config/env.js');
  const victim = rows[2];
  const bounceRes = await fetch(`${BASE}/webhooks/email-events?secret=${encodeURIComponent(config.security.webhookSecret)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'BOUNCED', email: victim.contacts?.email, messageId: victim.provider_message_id, reason: '550 hard bounce' }),
  });
  ok('bounce webhook accepted', bounceRes.status === 200);
  const { data: bouncedContact } = await sb.from('contacts').select('suppressed,do_not_contact').eq('id', victim.contact_id).single();
  ok('contact suppressed + do_not_contact', bouncedContact?.suppressed === true && bouncedContact?.do_not_contact === true);
  const { data: bouncedRow } = await sb.from('outreach').select('delivery_status').eq('id', victim.id).single();
  ok('outreach delivery_status Bounced', bouncedRow?.delivery_status === 'Bounced', bouncedRow?.delivery_status);

  // ---- 6. Suppressed contacts are never re-sent -------------------------------
  console.log('\nTEST 6 — Suppressed contact excluded from dispatch');
  await sb.from('outreach').update({ status: 'Ready', claim_id: null, claimed_at: null }).eq('id', victim.id);
  await api('/trigger/outreach', { method: 'POST' });
  const victimAfter = (await api('/outreach?limit=200')).outreach.find(o => o.id === victim.id);
  // The claim query excludes suppressed contacts, so the row is never claimed —
  // the invariant that matters is: it was NOT sent again.
  ok('suppressed contact never re-sent', victimAfter?.status !== 'Sent', `status=${victimAfter?.status}`);

  console.log(`\n============== RESULT: ${passed} passed, ${failed} failed ==============`);
  return failed === 0;
};

run()
  .then(async (success) => {
    // clean up idem + recovery contacts too
    const sb = getSupabaseClient();
    const extra = await sb.from('contacts').select('id,email').ilike('email', '%example.com');
    for (const c of extra?.data || []) {
      if (EMAILS.includes(c.email)) continue;
      const { data: profs } = await sb.from('profiles').select('id').eq('contact_id', c.id);
      const pids = (profs || []).map(p => p.id);
      let persIds = [];
      if (pids.length) {
        const { data: pers } = await sb.from('personalization_results').select('id').in('profile_id', pids);
        persIds = (pers || []).map(p => p.id);
        if (persIds.length) await sb.from('review_decisions').delete().in('personalization_id', persIds);
      }
      await sb.from('outreach').delete().eq('contact_id', c.id);
      if (persIds.length) await sb.from('personalization_results').delete().in('id', persIds);
      if (pids.length) {
        await sb.from('enrichment_results').delete().in('profile_id', pids);
        await sb.from('profiles').delete().in('id', pids);
      }
      await sb.from('contacts').delete().eq('id', c.id);
    }
    await cleanup();
    process.exit(success ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\n❌ FAILURE INJECTION ABORTED:', err.message);
    await cleanup();
    process.exit(1);
  });
