import { getSupabaseClient } from './client.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

export async function claimReadyLeads(claimId, limit = 10) {
  const supabase = getSupabaseClient();
  
  // 1. Select eligible records. The pipeline is strict: a lead may only be
  // claimed when BOTH the contact is approved AND the outreach record is
  // linked to a personalization that was actually approved/edited. This
  // closes the old bypass where a contact flagged personalization_approved
  // with no draft at all could be sent the generic template.
  const { data: eligible, error: selectErr } = await supabase
    .from('outreach')
    .select('*, contacts!inner(*)')
    .eq('status', 'Ready')
    .eq('contacts.do_not_contact', false)
    .eq('contacts.suppressed', false)
    .eq('contacts.personalization_approved', true)
    .not('personalization_id', 'is', null)
    .limit(limit);

  if (selectErr || !eligible || eligible.length === 0) {
    if (selectErr) logger.error('Error selecting ready leads:', { error: selectErr.message });
    return [];
  }

  // 2. Keep only records whose linked personalization is approved/edited.
  // A rejected/superseded draft must never go out as-is.
  const persIds = eligible.map(row => row.personalization_id);
  const { data: persRows, error: persErr } = await supabase
    .from('personalization_results')
    .select('id, status')
    .in('id', persIds);
  if (persErr) {
    logger.error('Error checking linked personalizations:', { error: persErr.message });
    return [];
  }
  const approvedIds = new Set(
    (persRows || []).filter(p => p.status === 'approved' || p.status === 'edited').map(p => p.id)
  );
  const eligibleApproved = eligible.filter(row => approvedIds.has(row.personalization_id));
  if (eligibleApproved.length === 0) return [];

  const ids = eligibleApproved.map(row => row.id);
  const now = new Date().toISOString();

  // 2. Atomically claim them. The status guard matters: two overlapping job
  // runs could both read the same eligible ids before either writes, so the
  // update also requires status='Ready' — only rows this run actually
  // transitioned are returned, and a second run can never claim them again.
  const { data: claimed, error: updateErr } = await supabase
    .from('outreach')
    .update({
      status: 'Claimed',
      claim_id: claimId,
      claimed_at: now,
      updated_at: now,
    })
    .in('id', ids)
    .eq('status', 'Ready')
    .select('*, contacts(*)');

  if (updateErr) {
    logger.error('Error claiming leads:', { error: updateErr.message });
    return [];
  }

  return claimed || [];
}

export async function getFollowUpsDue() {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('outreach')
    .select('*, contacts!inner(*)')
    .lte('next_action_at', now)
    .in('status', ['Sent', 'Follow-up 1'])
    .eq('contacts.do_not_contact', false)
    .eq('contacts.suppressed', false);

  if (error) {
    logger.error('Error getting follow ups due:', { error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Atomically claim follow-up records that are due. Only rows still in a
 * pre-follow-up status (Sent / Follow-up 1) are transitioned to 'Sending' with
 * the given claim_id (`fu:<jobId>`); rows claimed by a concurrent run are not
 * returned, which is what makes duplicate follow-up sends impossible.
 */
export async function claimFollowUpsDue(ids, claimId) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('outreach')
    .update({
      status: 'Sending',
      claim_id: claimId,
      claimed_at: now,
      updated_at: now,
    })
    .in('id', ids)
    .in('status', ['Sent', 'Follow-up 1'])
    .select('*, contacts(*)');

  if (error) {
    logger.error('Error claiming follow-ups:', { error: error.message });
    return [];
  }
  return data || [];
}

export async function getOutreachByContactAndCampaign(contactId, campaignId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('outreach')
    .select('*')
    .eq('contact_id', contactId)
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (error) {
    logger.error('Error getting outreach by contact/campaign:', { contactId, campaignId, error: error.message });
    throw error;
  }
  return data;
}

export async function linkPersonalizationToOutreach(contactId, campaignId, personalizationId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('outreach')
    .update({ personalization_id: personalizationId, updated_at: new Date().toISOString() })
    .eq('contact_id', contactId)
    .eq('campaign_id', campaignId)
    .select()
    .maybeSingle();

  if (error) {
    logger.error('Error linking personalization to outreach:', { contactId, campaignId, error: error.message });
    throw error;
  }
  return data;
}

export async function updateOutreachRecord(id, fields) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('outreach')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, contacts(*)')
    .single();

  if (error) {
    logger.error(`Error updating outreach record ${id}:`, { error: error.message });
    throw error;
  }

  return data;
}

/**
 * Crash recovery for in-flight work. Two kinds of stale rows are handled:
 *
 * 1. status 'Claimed' — claimed by an outreach run that died before sending.
 *    Safe to reset to Ready: no email was sent yet.
 *
 * 2. status 'Sending' — the process died between setting the in-flight status
 *    and confirming the send. The claim_id prefix tells us the origin:
 *    - `fu:` → a follow-up send; restore to the pre-follow-up status derived
 *      from sequence_step (0 → 'Sent', >= 1 → 'Follow-up 1').
 *    - otherwise → an initial outreach send; restore to 'Ready'.
 *
 * NOTE: restoring 'Sending' rows is at-least-once — if the provider accepted
 * the email but the DB update never landed, the retry can resend. That window
 * is small and documented; without provider-side dedup keys it is the only
 * safe automatic recovery.
 */
export async function resetStaleClaims(timeoutMinutes = 10) {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('outreach')
    .update({
      status: 'Ready',
      claim_id: null,
      claimed_at: null,
      updated_at: now,
    })
    .eq('status', 'Claimed')
    .lte('claimed_at', cutoff)
    .select('id');

  if (error) {
    logger.error('Error resetting stale claims:', { error: error.message });
  } else if (data && data.length > 0) {
    logger.info(`Reset ${data.length} stale claimed records back to Ready`);
  }

  // Stale in-flight sends (status 'Sending') — recover by origin AND by
  // whether the provider actually accepted the email:
  //
  //  - provider_message_id IS NULL: the provider never accepted it (or we
  //    never got a message id). Safe to restore to a retryable state.
  //  - provider_message_id IS NOT NULL: the email WAS accepted; only the
  //    success write was lost. Recover to the post-send state instead of
  //    Ready, so a retry can NEVER resend an email the recipient already got.
  //
  // This closes the biggest duplicate-send window (crash between provider
  // accept and DB update) that a plain "restore to Ready" recovery had.
  const { data: sending, error: sendErr } = await supabase
    .from('outreach')
    .select('id, claim_id, sequence_step, provider_message_id, claimed_at')
    .eq('status', 'Sending')
    .lte('claimed_at', cutoff);

  if (sendErr) {
    logger.error('Error selecting stale sending records:', { error: sendErr.message });
    return;
  }

  const { followup1Days, followup2Days } = config.outreach;
  let recovered = 0;
  for (const row of sending || []) {
    const isFollowup = String(row.claim_id || '').startsWith('fu:');
    const step = row.sequence_step || 0;

    let updates;
    if (row.provider_message_id) {
      if (isFollowup) {
        if (step === 0) {
          // Follow-up 1 was accepted -> advance to Follow-up 1 and schedule FU2.
          updates = {
            status: 'Follow-up 1',
            sequence_step: 1,
            next_action_at: new Date(Date.now() + followup2Days * 86400 * 1000).toISOString(),
            delivery_status: 'Sent',
            error_message: 'Recovered: follow-up accepted by provider (state write interrupted) — not resent',
          };
        } else {
          // Follow-up 2 (terminal) was accepted -> close the sequence.
          updates = {
            status: 'Closed',
            sequence_step: step + 1,
            next_action_at: null,
            delivery_status: 'Sent',
            error_message: 'Recovered: final follow-up accepted by provider (state write interrupted) — not resent',
          };
        }
      } else {
        // Initial email accepted -> mark Sent and schedule follow-up 1.
        updates = {
          status: 'Sent',
          sent_at: row.claimed_at || now,
          last_outbound_at: row.claimed_at || now,
          next_action_at: new Date(Date.now() + followup1Days * 86400 * 1000).toISOString(),
          delivery_status: 'Sent',
          error_message: 'Recovered: email accepted by provider (state write interrupted) — not resent',
        };
      }
    } else {
      updates = {
        status: isFollowup ? (step >= 1 ? 'Follow-up 1' : 'Sent') : 'Ready',
        error_message: `Recovered: send was interrupted before provider acceptance (${isFollowup ? 'follow-up' : 'initial'})`,
      };
    }

    const { error: upErr } = await supabase
      .from('outreach')
      .update({
        ...updates,
        claim_id: null,
        claimed_at: null,
        updated_at: now,
      })
      .eq('id', row.id);
    if (upErr) {
      logger.error(`Error recovering stale Sending record ${row.id}:`, { error: upErr.message });
    } else {
      recovered += 1;
    }
  }

  if (sending && sending.length > 0) {
    logger.info(`Recovered ${recovered}/${sending.length} stale Sending record(s) by origin`);
  }
}

export async function isGmailMessageProcessed(messageId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('processed_gmail_messages')
    .select('message_id')
    .eq('message_id', messageId)
    .maybeSingle();

  if (error) {
    logger.error('Error checking processed message ID:', { error: error.message });
    return false;
  }
  return Boolean(data);
}

export async function markGmailMessageProcessed(messageId) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('processed_gmail_messages')
    .upsert({ message_id: messageId, processed_at: new Date().toISOString() });

  if (error) {
    logger.error('Error marking Gmail message as processed:', { error: error.message });
  }
}

export async function findOutreachByGmailThreadId(threadId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('outreach')
    .select('*, contacts(*)')
    .eq('gmail_thread_id', threadId)
    .maybeSingle();

  if (error) {
    logger.error('Error finding outreach by thread ID:', { error: error.message });
    return null;
  }
  return data;
}

export async function clearProcessedGmailMessages() {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('processed_gmail_messages')
    .delete()
    .not('message_id', 'is', null);

  if (error) {
    logger.error('Error clearing processed Gmail messages:', { error: error.message });
    throw error;
  }
  logger.info('Cleared processed_gmail_messages table.');
}


