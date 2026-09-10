// Live cross-page sync test — drives the API exactly like the React UI and
// verifies every endpoint the pages read reflects the change. Read/write test
// data: creates + cleans up one contact. Delete this script after use.
import { getSupabaseClient } from '../src/db/client.js';

const BASE = 'http://localhost:5000';
const H = { 'x-bypass-auth': 'true', 'Content-Type': 'application/json' };

let passed = 0, failed = 0;
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

const EMAIL = `sync.test.${Date.now()}@example.com`;
let contactId = null;
let profileId = null;
let personalizationId = null;

const run = async () => {
  // Check backend reachability first — skip gracefully if not running.
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) { console.log('\n⏭️  Backend not healthy — skipping sync check'); process.exit(0); }
  } catch { console.log('\n⏭️  Backend not running — skipping sync check'); process.exit(0); }

  console.log('\n===== CROSS-PAGE SYNC TEST (UI actions → all endpoints) =====\n');

  // 1. Add lead (PeoplePage "Add lead" action)
  console.log('STEP 1 — Add lead (PeoplePage)');
  const lead = await api('/leads', { method: 'POST', body: JSON.stringify({ name: 'Sync Test Person', email: EMAIL, organization: 'Sync University', role: 'Professor' }) });
  contactId = lead.contact?.id;
  ok('lead created', !!contactId);
  const contacts = (await api('/contacts?limit=200')).contacts;
  ok('contacts endpoint shows it', contacts.some(c => c.email === EMAIL));
  const stats1 = (await api('/dashboard/stats')).stats;
  ok('stats.contacts reflects it', stats1.contacts === contacts.length, `${stats1.contacts}`);
  const profiles = (await api('/profiles?limit=200')).profiles;
  profileId = profiles.find(p => p.contactId === contactId)?.id;
  ok('profile created + linked', !!profileId);

  // 2. Generate personalization (PersonDetailPage / ResearchPage action)
  console.log('\nSTEP 2 — Generate AI draft');
  const gen = await api(`/personalization/generate/${profileId}`, { method: 'POST', body: JSON.stringify({}) });
  personalizationId = gen.personalization?.id;
  ok('draft generated', !!personalizationId && gen.personalization.status === 'pending_review');
  const queue1 = (await api('/review/queue?limit=50')).queue;
  ok('review queue shows it', queue1.some(q => q.id === personalizationId));
  const stats2 = (await api('/dashboard/stats')).stats;
  ok('stats.reviewQueue shows it', stats2.reviewQueue >= 1, `${stats2.reviewQueue}`);

  // 3. Reject (ReviewPage) — checks the reject → stats sync gap
  console.log('\nSTEP 3 — Reject draft');
  await api(`/review/${personalizationId}`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) });
  const queue2 = (await api('/review/queue?limit=50')).queue;
  ok('draft leaves review queue', !queue2.some(q => q.id === personalizationId));
  const stats3 = (await api('/dashboard/stats')).stats;
  ok('stats.reviewQueue decremented after reject', stats3.reviewQueue === 0, `stats.reviewQueue=${stats3.reviewQueue}`);

  // 4. Generate again → approve (ReviewPage approve path)
  console.log('\nSTEP 4 — Generate → Approve');
  const gen2 = await api(`/personalization/generate/${profileId}`, { method: 'POST', body: JSON.stringify({}) });
  const pers2 = gen2.personalization?.id;
  await api(`/review/${pers2}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
  const contacts2 = (await api('/contacts?limit=200')).contacts;
  const mine2 = contacts2.find(c => c.email === EMAIL);
  ok('contact marked approved', mine2?.personalizationApproved === true);
  const outreach1 = (await api('/outreach?limit=200')).outreach.filter(o => o.contact_id === contactId);
  ok('outreach row linked + Ready', outreach1.length >= 1 && outreach1[0].status === 'Ready', `status=${outreach1[0]?.status}`);

  // 5. Dispatch (BulkSendPage / sidebar action)
  console.log('\nSTEP 5 — Dispatch');
  const send = await api('/trigger/outreach', { method: 'POST' });
  ok('batch ran', send.success === true, `claimed=${send.result?.claimed}`);
  const outreach2 = (await api('/outreach?limit=200')).outreach.filter(o => o.contact_id === contactId);
  ok('outreach now Sent', outreach2.some(o => o.status === 'Sent'), `statuses=${outreach2.map(o => o.status).join(',')}`);
  const stats4 = (await api('/dashboard/stats')).stats;
  ok('stats.outreach.sent incremented', stats4.outreach.sent >= 1, `${stats4.outreach.sent}`);

  // 6. Campaigns aggregation (CampaignsPage)
  console.log('\nSTEP 6 — Campaigns aggregation');
  const campaigns = (await api('/campaigns')).campaigns;
  ok('campaign counts include the send', campaigns.some(c => c.sent >= 1), campaigns.map(c => `${c.name}:${c.sent}/${c.total}`).join(', '));

  // 7. Replies endpoint shape (RepliesPage)
  console.log('\nSTEP 7 — Replies endpoint');
  const replies = (await api('/replies')).replies;
  ok('replies endpoint returns array', Array.isArray(replies));

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
};

run()
  .then(async () => {
    // Cleanup: delete the test contact + all related rows. FK-safe order —
    // outreach references personalization_results (personalization_id, no
    // cascade), so outreach must be deleted BEFORE personalization_results.
    if (contactId) {
      const sb = getSupabaseClient();
      const { data: profs } = await sb.from('profiles').select('id').eq('contact_id', contactId);
      const pids = (profs || []).map(p => p.id);
      let persIds = [];
      if (pids.length) {
        const { data: pers } = await sb.from('personalization_results').select('id').in('profile_id', pids);
        persIds = (pers || []).map(p => p.id);
        if (persIds.length) await sb.from('review_decisions').delete().in('personalization_id', persIds);
      }
      await sb.from('outreach').delete().eq('contact_id', contactId);
      if (persIds.length) await sb.from('personalization_results').delete().in('id', persIds);
      if (pids.length) {
        await sb.from('enrichment_results').delete().in('profile_id', pids);
        await sb.from('profiles').delete().in('id', pids);
      }
      await sb.from('contacts').delete().eq('id', contactId);
      console.log(`\nCleaned up test contact ${EMAIL}`);
    }
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(err => { console.error('\n❌ SYNC TEST ABORTED:', err.message); process.exit(1); });
