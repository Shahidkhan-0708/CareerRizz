import { getSupabaseClient } from '../../../db/client.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const OUTREACH_QUEUE_NAME = 'linkedin-outreach-bridge';

let outreachQueue = null;

// Dynamically attempt to initialize BullMQ if installed in node_modules
async function getQueueInstance() {
  if (outreachQueue) return outreachQueue;

  try {
    const { Queue } = await import('bullmq');
    const url = new URL(REDIS_URL);
    outreachQueue = new Queue(OUTREACH_QUEUE_NAME, {
      connection: {
        host: url.hostname || 'localhost',
        port: parseInt(url.port || '6379', 10),
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
      },
    });
    return outreachQueue;
  } catch {
    // BullMQ not installed or Redis offline; proceed with in-memory buffer
    return null;
  }
}

/**
 * Memory fallback queue if Redis is running in offline mode.
 */
const inMemoryStagedQueue = [];

/**
 * Enqueue an approved outreach task to be pulled by the Chrome Extension.
 */
export async function enqueueOutreachTask(payload) {
  try {
    const queue = await getQueueInstance();
    if (queue) {
      await queue.add('dispatch-to-extension', payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      });
      return;
    }
  } catch (err) {
    console.warn('[outreach-bridge] Redis/BullMQ unavailable, buffering to in-memory staged queue:', err.message);
  }
  inMemoryStagedQueue.push(payload);
}

/**
 * Fetches the next pending approved task for the Chrome Extension client.
 * Called by GET /api/outreach/pending-task.
 */
export async function getNextPendingOutreachTask() {
  // 1. Check in-memory fallback
  if (inMemoryStagedQueue.length > 0) {
    return inMemoryStagedQueue.shift() || null;
  }

  // 2. Query Supabase for approved outreach items waiting for extension bridge
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('outreach')
        .select('id, contact_id, status, metadata, scheduled_at')
        .eq('status', 'approved')
        .limit(1);

      if (data && data.length > 0) {
        const item = data[0];
        const targetUrl = item.metadata?.linkedin_url || item.metadata?.targetUrl || 'https://www.linkedin.com';
        const messageText = item.metadata?.draft_body || item.metadata?.messageText || 'Hello, I recently submitted my application.';

        // Mark as claimed/in-progress
        await supabase
          .from('outreach')
          .update({ status: 'claimed', claimed_at: new Date().toISOString() })
          .eq('id', item.id);

        return {
          taskId: item.id,
          userId: item.contact_id || 'system',
          status: 'APPROVED',
          targetUrl,
          messageText,
        };
      }
    }
  } catch (dbErr) {
    console.warn('[outreach-bridge] Supabase polling error:', dbErr.message);
  }

  return null;
}
