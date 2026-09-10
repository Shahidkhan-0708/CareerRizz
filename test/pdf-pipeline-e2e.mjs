// ---------------------------------------------------------------------------
// End-to-end pipeline regression using test/email_personalization_test_dataset.pdf.
// Drives the real HTTP API exactly like the React UI:
//
//   PDF → import → contacts/profiles/outreach → enrich (batch) → 5 unique
//   AI drafts → review → approve → SMTP send → idempotency + webhook auth.
//
// Requires the backend on :5000 with real integrations (dev auth via
// x-bypass-auth). Creates test data, then cleans it all up at the end
// (FK-safe order). Sends go to reserved @example.edu addresses only.
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../src/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:5000';
const H = { 'x-bypass-auth': 'true', 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function api(pathName, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = isForm ? { 'x-bypass-auth': 'true' } : H;
  const res = await fetch(`${BASE}/api${pathName}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${pathName} -> HTTP ${res.status}: ${body.error || res.statusText}`);
  return body;
}

const EXPECTED = [
  { email: 'sarah.chen@example.edu', name: 'Sarah Chen', context: 'algorithmic fairness' },
  { email: 'marcus.webb@example.edu', name: 'Marcus Webb', context: 'autonomous' },
  { email: 'priya.sharma@example.edu', name: 'Priya Sharma', context: 'solar' },
  { email: 'elena.petrova@example.edu', name: 'Elena Petrova', context: 'brain-computer' },
  { email: 'james.okafor@example.edu', name: 'James Okafor', context: 'disease' },
];

// FK-safe delete order — CRITICAL: outreach references personalization_results
// via personalization_id (no cascade), so outreach must go BEFORE
// personalization_results or the delete fails silently. Every delete reports
// errors instead of swallowing them.
const del = async (label, query) => {
  const { error } = await query;
  if (error) console.log(`  ⚠ cleanup ${label}: ${error.message}`);
};

const cleanup = async () => {
  const sb = getSupabaseClient();
  const { data: contacts } = await sb.from('contacts').select('id').in('email', EXPECTED.map(e => e.email));
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
  console.log(`\n🧹 Cleaned up ${contactIds.length} test contact(s) + all related rows`);
};

const run = async () => {
  // Check backend reachability first — skip gracefully if not running.
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) { console.log('\n⏭️  Backend not healthy — skipping PDF pipeline E2E tests'); process.exit(0); }
  } catch { console.log('\n⏭️  Backend not running — skipping PDF pipeline E2E tests'); process.exit(0); }

  console.log('\n============== E2E — 5-RECIPIENT PDF PIPELINE ==============\n');

  // ---- STAGE 1: Import the PDF -------------------------------------------
  console.log('STAGE 1 — PDF import');
  const pdfBuf = fs.readFileSync(path.join(__dirname, 'email_personalization_test_dataset.pdf'));
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(pdfBuf)], { type: 'application/pdf' }), 'email_personalization_test_dataset.pdf');
  const queued = await api('/import', { method: 'POST', body: form });
  ok('PDF import queued', !!queued.jobId, `jobId ${queued.jobId}`);
  const job = await api('/import/process', { method: 'POST', body: JSON.stringify({ jobId: queued.jobId }) });
  ok('import job completed', job.job?.status === 'completed', `created=${job.job?.created_records}`);
  ok('5 contacts created', job.job?.created_records === 5, `created=${job.job?.created_records}`);

  // ---- STAGE 2: contacts / profiles / outreach ---------------------------
  console.log('\nSTAGE 2 — Contacts, profiles, outreach');
  const contacts = (await api('/contacts?limit=200')).contacts.filter(c => c.email.endsWith('@example.edu'));
  const mine = contacts.filter(c => EXPECTED.some(e => e.email === c.email));
  ok('5 contacts present with correct emails', mine.length === 5, mine.map(c => c.email).join(', '));
  for (const e of EXPECTED) {
    const c = mine.find(x => x.email === e.email);
    ok(`contact ${e.email} has name`, c && c.name.toLowerCase().includes(e.name.toLowerCase().split(' ')[1].toLowerCase()), c?.name);
  }
  const profiles = (await api('/profiles?limit=200')).profiles.filter(p => mine.some(c => c.id === p.contactId));
  ok('5 profiles created', profiles.length === 5);
  const outreach = (await api('/outreach?limit=200')).outreach.filter(o => mine.some(c => c.id === o.contact_id));
  ok('5 outreach rows (Ready)', outreach.length === 5 && outreach.every(o => o.status === 'Ready'), outreach.map(o => o.status).join(','));

  // ---- STAGE 3: Enrichment + personalization batch -----------------------
  console.log('\nSTAGE 3 — Enrich-first batch + AI generation (real OpenAI)');
  const batch = await api('/trigger/personalization', { method: 'POST', body: JSON.stringify({ limit: 20 }) });
  ok('batch ran', batch.success === true, JSON.stringify(batch.result));
  ok('5 drafts generated', batch.result?.generated === 5, `generated=${batch.result?.generated}, enriched=${batch.result?.enriched}, failed=${batch.result?.failed}`);
  ok('no generation failures', batch.result?.failed === 0, JSON.stringify(batch.result?.errors || []));

  const queue = (await api('/review/queue?limit=50')).queue;
  ok('review queue holds 5 drafts', queue.length === 5, `${queue.length} drafts`);

  // The queue payload embeds profiles but not their contacts — map via profile.contactId.
  const profilesById = Object.fromEntries(profiles.map(p => [p.id, p]));
  const contactById = Object.fromEntries(mine.map(c => [c.id, c]));
  const draftsByEmail = {};
  for (const d of queue) {
    const prof = profilesById[d.profiles?.id];
    const contact = prof ? contactById[prof.contactId] : null;
    if (contact) draftsByEmail[contact.email] = d;
  }

  // ---- STAGE 4: no cross-contamination ------------------------------------
  console.log('\nSTAGE 4 — Recipient-specific drafts (no cross-contamination)');
  for (const e of EXPECTED) {
    const draft = draftsByEmail[e.email];
    const subjectOk = draft && draft.subject && draft.subject.length > 0;
    const selfMention = draft && (draft.body + draft.subject).toLowerCase().includes(e.name.split(' ')[1].toLowerCase());
    const others = EXPECTED.filter(x => x.email !== e.email).map(x => x.name.split(' ')[1].toLowerCase());
    const foreignMention = draft && others.some(n => (draft.body + draft.subject).toLowerCase().includes(n));
    ok(`${e.email} has draft + mentions self`, !!draft && subjectOk && selfMention, draft?.subject?.slice(0, 60));
    ok(`${e.email} contains no other recipient name`, !foreignMention, foreignMention ? 'cross-contamination!' : 'clean');
  }

  // Evidence must come from the draft's own profile only: every evidence id
  // cited by a draft must be an enrichment_result row of that same profile.
  let evidenceCrossContaminated = 0;
  const sb = getSupabaseClient();
  for (const d of queue) {
    const profId = d.profiles?.id;
    if (!profId) continue;
    const { data: enrichRows } = await sb.from('enrichment_results').select('id').eq('profile_id', profId);
    const ownIds = new Set((enrichRows || []).map(r => r.id));
    const evidence = Array.isArray(d.evidence_used) ? d.evidence_used : [];
    for (const ev of evidence) {
      const eid = ev.id || ev.factId;
      if (eid && !ownIds.has(eid)) {
        evidenceCrossContaminated += 1;
        console.log(`  ⚠ draft ${d.id} cites evidence ${eid} not owned by profile ${profId}`);
      }
    }
  }
  ok('no evidence cross-contamination across profiles', evidenceCrossContaminated === 0, `${evidenceCrossContaminated} foreign evidence refs`);

  // ---- STAGE 5: Approve all ----------------------------------------------
  console.log('\nSTAGE 5 — Approve');
  const approverId = mine[0].id; // decidedBy must be a contact UUID
  for (const d of queue) {
    await api(`/review/${d.id}`, { method: 'POST', body: JSON.stringify({ decision: 'approved', decidedBy: approverId }) });
  }
  const queueAfter = (await api('/review/queue?limit=50')).queue;
  ok('review queue empty after approvals', queueAfter.length === 0);
  const stats = (await api('/dashboard/stats')).stats;
  ok('stats.reviewQueue = 0', stats.reviewQueue === 0, `queue=${stats.reviewQueue}`);
  const contactsAfter = (await api('/contacts?limit=200')).contacts.filter(c => mine.some(m => m.id === c.id));
  ok('all contacts marked approved', contactsAfter.length === 5 && contactsAfter.every(c => c.personalizationApproved === true));

  // ---- STAGE 6: Send -------------------------------------------------------
  console.log('\nSTAGE 6 — SMTP dispatch (reserved-domain recipients)');
  const send = await api('/trigger/outreach', { method: 'POST' });
  ok('outreach batch ran', send.success === true, `claimed=${send.result?.claimed}, sent=${send.result?.sent}, failed=${send.result?.failed}`);
  ok('5 claimed + 5 sent', send.result?.claimed === 5 && send.result?.sent === 5, JSON.stringify(send.result));
  const sentRows = (await api('/outreach?limit=200')).outreach.filter(o => mine.some(c => c.id === o.contact_id));
  ok('all outreach rows Sent', sentRows.length === 5 && sentRows.every(o => o.status === 'Sent'), sentRows.map(o => o.status).join(','));
  ok('provider message ids recorded', sentRows.every(o => !!o.provider_message_id), sentRows.map(o => o.provider_message_id?.slice(0, 12)).join(', '));
  ok('sent_at recorded', sentRows.every(o => !!o.sent_at));
  ok('follow-up scheduled (next_action_at set)', sentRows.every(o => !!o.next_action_at));

  // ---- STAGE 7: Idempotency ------------------------------------------------
  console.log('\nSTAGE 7 — Idempotency (run again → nothing double-processed)');
  const send2 = await api('/trigger/outreach', { method: 'POST' });
  ok('second outreach run claims nothing', send2.result?.claimed === 0, `claimed=${send2.result?.claimed}`);
  const sentCountAfter2 = (await api('/outreach?limit=200')).outreach.filter(o => mine.some(c => c.id === o.contact_id) && o.status === 'Sent').length;
  ok('no duplicate sends', sentCountAfter2 === 5, `${sentCountAfter2} Sent rows`);
  const batch2 = await api('/trigger/personalization', { method: 'POST', body: JSON.stringify({ limit: 20 }) });
  ok('second personalization run generates nothing', batch2.result?.generated === 0, `generated=${batch2.result?.generated}`);
  const queueAfter2 = (await api('/review/queue?limit=50')).queue;
  ok('no duplicate drafts in queue', queueAfter2.length === 0, `${queueAfter2.length} in queue`);

  // ---- STAGE 8: Webhook auth (security regression) -------------------------
  console.log('\nSTAGE 8 — Webhook auth');
  const noSecret = await fetch(`${BASE}/webhooks/email-events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'BOUNCED', email: EXPECTED[0].email }) });
  ok('webhook without secret rejected (401)', noSecret.status === 401, `status=${noSecret.status}`);
  const { config } = await import('../src/config/env.js');
  const withSecret = await fetch(`${BASE}/webhooks/email-events?secret=${encodeURIComponent(config.security.webhookSecret)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'BOUNCED', email: EXPECTED[0].email }) });
  ok('webhook with secret accepted (200)', withSecret.status === 200, `status=${withSecret.status}`);

  console.log(`\n============== RESULT: ${passed} passed, ${failed} failed ==============`);
  return failed === 0;
};

run()
  .then(async (success) => {
    await cleanup();
    process.exit(success ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\n❌ E2E ABORTED:', err.message);
    await cleanup();
    process.exit(1);
  });
