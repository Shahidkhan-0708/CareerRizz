import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getSupabaseClient } from '../../../db/client.js';

export interface OutreachTaskPayload {
  taskId: string;
  userId: string;
  status: 'APPROVED';
  targetUrl: string;
  messageText: string;
  recipientName?: string;
  company?: string;
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Lazy Redis initialization to prevent crash if Redis is unavailable in local dev
let redisClient: Redis | null = null;
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return redisClient;
}

export const OUTREACH_QUEUE_NAME = 'linkedin-outreach-bridge';

/**
 * BullMQ Queue for staged outreach items.
 */
export const outreachQueue = new Queue<OutreachTaskPayload>(OUTREACH_QUEUE_NAME, {
  connection: {
    host: new URL(REDIS_URL).hostname || 'localhost',
    port: parseInt(new URL(REDIS_URL).port || '6379', 10),
  },
});

/**
 * Memory fallback queue if Redis is running in mock/offline mode.
 */
const inMemoryStagedQueue: OutreachTaskPayload[] = [];

/**
 * Enqueue an approved outreach task to be pulled by the Chrome Extension.
 */
export async function enqueueOutreachTask(payload: OutreachTaskPayload): Promise<void> {
  try {
    await outreachQueue.add('dispatch-to-extension', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
    });
  } catch (err) {
    console.warn('[outreach-bridge] Redis unavailable, buffering to in-memory staged queue:', (err as Error).message);
    inMemoryStagedQueue.push(payload);
  }
}

/**
 * Fetches the next pending approved task for the Chrome Extension client.
 * Called by GET /api/outreach/pending-task.
 */
export async function getNextPendingOutreachTask(): Promise<OutreachTaskPayload | null> {
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
    console.warn('[outreach-bridge] Supabase polling error:', (dbErr as Error).message);
  }

  return null;
}
