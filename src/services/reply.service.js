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

    // If still no matching outreach record, check for Job Application / ATS / Recruiter replies
    if (!outreachRecord) {
      try {
        const matchedJobOrRecruiter = await matchJobApplicationReply(reply);
        if (matchedJobOrRecruiter) {
          await markGmailMessageProcessed(reply.id);
          processedCount++;
          continue;
        }
      } catch (jobErr) {
        logger.warn(`Error checking job application reply for ${reply.fromEmail}:`, { error: jobErr.message });
      }

      logger.debug(`No matching outreach or job record found for reply from ${reply.fromEmail} (Subject: ${reply.subject}). Skipping.`);
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

/**
 * Matches inbound messages against recruiter outreach, job applications,
 * and third-party ATS domains (Greenhouse, Lever, Workday, Ashby).
 */
async function matchJobApplicationReply(reply) {
  const supabase = getSupabaseClient();
  const fromEmail = (reply.fromEmail || '').toLowerCase();
  const subject = (reply.subject || '').toLowerCase();
  const body = (reply.body || '').toLowerCase();
  const now = new Date().toISOString();

  // 1. Check Recruiter Outreach by email
  if (fromEmail) {
    const { data: recruiters } = await supabase
      .from('recruiter_outreach')
      .select('*, jobs(*)')
      .eq('recruiter_email', fromEmail)
      .limit(1);

    if (recruiters && recruiters.length > 0) {
      const rec = recruiters[0];
      logger.info(`Matched reply to recruiter outreach ${rec.id} (${rec.recruiter_name} @ ${rec.company})`);
      
      const classification = await classifyReply(reply.body || reply.subject || 'Recruiter response');

      await supabase
        .from('recruiter_outreach')
        .update({
          status: 'replied',
          reply_received_at: now,
          updated_at: now,
        })
        .eq('id', rec.id);

      if (rec.job_id) {
        await supabase
          .from('jobs')
          .update({
            status: 'interviewing',
            notes: `[Recruiter Reply ${now.slice(0, 10)}] ${classification.category}: ${classification.summary}`,
            updated_at: now,
          })
          .eq('id', rec.job_id);
      }

      return true;
    }
  }

  // 2. Check ATS Provider Domains or Direct Company Replies
  const atsDomains = ['greenhouse.io', 'lever.co', 'myworkday.com', 'workday.com', 'ashbyhq.com', 'smartrecruiters.com', 'icims.com'];
  const isAtsEmail = atsDomains.some(d => fromEmail.includes(d));

  const { data: appliedJobs } = await supabase
    .from('jobs')
    .select('*, applications(*)')
    .in('status', ['applied', 'interviewing', 'discovered', 'researching', 'applying'])
    .order('updated_at', { ascending: false })
    .limit(50);

  if (!appliedJobs || appliedJobs.length === 0) return false;

  let matchedJob = null;
  for (const job of appliedJobs) {
    const compLower = (job.company || '').toLowerCase().trim();
    if (!compLower || compLower.length < 3) continue;

    if (subject.includes(compLower) || (isAtsEmail && body.includes(compLower)) || fromEmail.includes(compLower)) {
      matchedJob = job;
      break;
    }
  }

  if (!matchedJob) return false;

  logger.info(`Matched inbound reply to job ${matchedJob.id} (${matchedJob.title} @ ${matchedJob.company})`);

  const classification = await classifyReply(reply.body || reply.subject || `Inbound message from ${matchedJob.company}`);

  let newAppStatus = 'pending_response';
  let newJobStatus = matchedJob.status;

  const interviewSignals = ['interview', 'schedule', 'calendly.com', 'meet.google.com', 'zoom.us', 'availability', 'chat with our team', 'invitation to interview'];
  const oaSignals = ['hackerrank', 'codesignal', 'assessment', 'coding challenge', 'take-home', 'online test'];
  const rejectionSignals = ['unfortunately', 'not moving forward', 'pursuing other candidates', 'not selected', 'other applicants', 'impressed with your qualifications, but'];

  const combinedText = `${subject} ${body}`;

  if (interviewSignals.some(s => combinedText.includes(s)) || classification.category === 'MEETING_REQUEST') {
    newAppStatus = 'interview';
    newJobStatus = 'interviewing';
  } else if (oaSignals.some(s => combinedText.includes(s))) {
    newAppStatus = 'technical_round';
    newJobStatus = 'interviewing';
  } else if (rejectionSignals.some(s => combinedText.includes(s)) || classification.category === 'NOT_INTERESTED') {
    newAppStatus = 'rejected';
    newJobStatus = 'rejected';
  }

  const existingApp = matchedJob.applications?.[0];
  const appNote = `[Gmail Reply ${now.slice(0, 10)}] Subject: "${reply.subject}". Category: ${classification.category}. ${classification.summary}`;

  if (existingApp) {
    await supabase
      .from('applications')
      .update({
        status: newAppStatus,
        notes: existingApp.notes ? `${existingApp.notes}\n\n${appNote}` : appNote,
        updated_at: now,
      })
      .eq('id', existingApp.id);
  } else {
    await supabase
      .from('applications')
      .insert({
        user_id: matchedJob.user_id,
        job_id: matchedJob.id,
        status: newAppStatus,
        notes: appNote,
        applied_at: now,
      });
  }

  const jobNote = `[Company Reply ${now.slice(0, 10)}] ${newAppStatus.toUpperCase()} - ${reply.subject}`;
  await supabase
    .from('jobs')
    .update({
      status: newJobStatus,
      notes: matchedJob.notes ? `${matchedJob.notes}\n\n${jobNote}` : jobNote,
      updated_at: now,
    })
    .eq('id', matchedJob.id);

  logger.info(`Successfully processed company reply for ${matchedJob.company}. Status updated to: ${newJobStatus}/${newAppStatus}`);
  return true;
}
