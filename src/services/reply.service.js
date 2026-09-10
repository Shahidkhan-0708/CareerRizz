import { logger } from '../utils/logger.js';
import { getRecentReplies } from '../integrations/gmail/client.js';
import { classifyReply } from '../integrations/ai/classifier.js';
import { 
  isGmailMessageProcessed, 
  markGmailMessageProcessed, 
  findOutreachByGmailThreadId, 
  updateOutreachRecord 
} from '../db/outreach.js';
import { findContactByEmail } from '../db/contacts.js';
import { getSupabaseClient } from '../db/client.js';

export async function processIncomingReplies() {
  logger.info('Starting incoming reply detection job.');

  const recentReplies = await getRecentReplies();
  if (recentReplies.length === 0) {
    logger.info('No new incoming replies found in Gmail inbox.');
    return { fetched: 0, processed: 0, skipped: 0 };
  }

  logger.info(`Fetched ${recentReplies.length} messages from Gmail inbox.`);

  let processedCount = 0;
  let skippedCount = 0;

  for (const reply of recentReplies) {
    // 1. Deduplication check
    const alreadyProcessed = await isGmailMessageProcessed(reply.id);
    if (alreadyProcessed) {
      skippedCount++;
      continue;
    }

    let outreachRecord = null;

    // 2. Primary matching: Thread ID (if previously recorded)
    if (reply.threadId) {
      outreachRecord = await findOutreachByGmailThreadId(reply.threadId);
      if (outreachRecord) {
        logger.info(`Matched reply via thread ID ${reply.threadId} to outreach ${outreachRecord.id}`);
      }
    }

    // 2b. Message-ID matching: In-Reply-To and References headers
    // Handles angle bracket formatting differences: <id@domain> vs id@domain
    if (!outreachRecord && (reply.inReplyTo || reply.references)) {
      const candidateIds = new Set();
      const rawHeader = `${reply.inReplyTo || ''} ${reply.references || ''}`;
      
      const angleMatches = rawHeader.match(/<[^>]+>/g) || [];
      for (const m of angleMatches) {
        candidateIds.add(m.trim());
        candidateIds.add(m.replace(/^<|>$/g, '').trim());
      }

      const plainTokens = rawHeader.split(/\s+/).filter(t => t.includes('@'));
      for (const t of plainTokens) {
        const clean = t.replace(/^<|>$/g, '').trim();
        if (clean) {
          candidateIds.add(clean);
          candidateIds.add(`<${clean}>`);
        }
      }

      if (candidateIds.size > 0) {
        const supabase = getSupabaseClient();
        const { data: records, error } = await supabase
          .from('outreach')
          .select('*, contacts(*)')
          .in('provider_message_id', Array.from(candidateIds))
          .limit(1);

        if (!error && records && records.length > 0) {
          outreachRecord = records[0];
          logger.info(`Matched reply via In-Reply-To/References to outreach ${outreachRecord.id}`);
        }
      }
    }

    // 3. Fallback matching: Sender Email
    if (!outreachRecord && reply.fromEmail) {
      try {
        const contact = await findContactByEmail(reply.fromEmail);
        if (contact) {
          const supabase = getSupabaseClient();
          const { data: records, error } = await supabase
            .from('outreach')
            .select('*, contacts(*)')
            .eq('contact_id', contact.id)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (!error && records && records.length > 0) {
            outreachRecord = records[0];
            logger.info(`Matched reply via sender email ${reply.fromEmail} to outreach ${outreachRecord.id}`);
          }
        }
      } catch (err) {
        logger.warn(`Error matching contact by email ${reply.fromEmail}:`, { error: err.message });
      }
    }

    // 4. Fallback matching: Subject Line (strip Re:, Fwd:, etc.)
    if (!outreachRecord && reply.subject) {
      const cleanedSubject = reply.subject
        .replace(/^(re|fwd|fw|\s*\[.*?\])\s*:\s*/gi, '')
        .replace(/^(re|fwd|fw|\s*\[.*?\])\s*:\s*/gi, '')
        .trim();

      if (cleanedSubject && cleanedSubject.length >= 6) {
        const supabase = getSupabaseClient();
        const { data: records, error } = await supabase
          .from('outreach')
          .select('*, contacts(*)')
          .ilike('subject', `%${cleanedSubject}%`)
          .order('sent_at', { ascending: false })
          .limit(1);

        if (!error && records && records.length > 0) {
          outreachRecord = records[0];
          logger.info(`Matched reply via Subject "${cleanedSubject}" to outreach ${outreachRecord.id}`);
        }
      }
    }

    // If still no matching outreach record, skip without permanently blacklisting in processed_gmail_messages
    if (!outreachRecord) {
      logger.debug(`No matching outreach record found for reply from ${reply.fromEmail} (Subject: ${reply.subject}). Skipping.`);
      skippedCount++;
      continue;
    }

    // Guard: If already marked Replied, mark this message processed and continue
    if (outreachRecord.status === 'Replied' && outreachRecord.reply_body) {
      logger.info(`Outreach record ${outreachRecord.id} is already marked Replied. Marking message ${reply.id} processed.`);
      await markGmailMessageProcessed(reply.id);
      skippedCount++;
      continue;
    }

    try {
      logger.info(`Matching reply detected for contact ${outreachRecord.contacts?.name || reply.fromEmail}. Classifying reply...`);

      // 5. AI Reply Classification
      const classification = await classifyReply(reply.body || reply.subject || 'Empty message body');

      // Sanitize suggested followup date so it's strictly a valid YYYY-MM-DD or null
      let safeFollowUpDate = null;
      if (classification?.suggestedFollowUpDate && typeof classification.suggestedFollowUpDate === 'string') {
        const match = classification.suggestedFollowUpDate.match(/\b\d{4}-\d{2}-\d{2}\b/);
        if (match) {
          safeFollowUpDate = match[0];
        }
      }

      // 6. Update Outreach State
      const now = new Date().toISOString();
      await updateOutreachRecord(outreachRecord.id, {
        status: 'Replied',
        reply_body: reply.body || '(No text body in reply)',
        reply_received_at: reply.receivedAt || now,
        gmail_message_id: reply.id,
        gmail_thread_id: reply.threadId,
        last_inbound_at: now,
        ai_category: classification?.category || 'OTHER',
        ai_confidence: classification?.confidence || 0.8,
        ai_sentiment: classification?.sentiment || 'neutral',
        ai_summary: classification?.summary || 'Inbound reply received',
        ai_next_action: classification?.nextAction || 'Review reply manually',
        ai_suggested_followup_date: safeFollowUpDate,
        ai_requires_human_review: classification?.requiresHumanReview ?? true,
      });

      await markGmailMessageProcessed(reply.id);
      processedCount++;
      logger.info(`Successfully processed reply for ${reply.fromEmail}. AI Category: ${classification?.category}`);
    } catch (replyErr) {
      logger.error(`Failed to process reply message ${reply.id}:`, { error: replyErr.message });
      skippedCount++;
    }
  }

  logger.info(`Reply detection job complete. Processed: ${processedCount}, Skipped: ${skippedCount}`);
  return { fetched: recentReplies.length, processed: processedCount, skipped: skippedCount };
}
