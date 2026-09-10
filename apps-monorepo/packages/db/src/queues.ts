import { Queue } from 'bullmq';
import { duplicateRedis } from './redis.js';
import type { SearchQuery, ResearchRunJob, MatchingRunJob } from '@jobsearch/shared-types';

export const DISCOVERY_SCAN_QUEUE = 'discovery.scan';
export const DISCOVERY_PROCESS_QUEUE = 'discovery.process';
export const RESEARCH_RUN_QUEUE = 'research.run';
export const MATCHING_RUN_QUEUE = 'matching.run';

export interface DiscoveryScanJob {
  sources?: string[];
  query?: SearchQuery & { boardToken?: string };
  triggeredBy?: 'cron' | 'manual';
}

export interface DiscoveryProcessJob {
  raw: Record<string, unknown>;
  sourceType: string;
  boardToken: string;
}

let scanQueue: Queue<DiscoveryScanJob> | null = null;
let processQueue: Queue<DiscoveryProcessJob> | null = null;

export function getScanQueue(): Queue<DiscoveryScanJob> {
  if (!scanQueue) {
    scanQueue = new Queue<DiscoveryScanJob>(DISCOVERY_SCAN_QUEUE, {
      connection: duplicateRedis(),
    });
  }
  return scanQueue;
}

export function getProcessQueue(): Queue<DiscoveryProcessJob> {
  if (!processQueue) {
    processQueue = new Queue<DiscoveryProcessJob>(DISCOVERY_PROCESS_QUEUE, {
      connection: duplicateRedis(),
    });
  }
  return processQueue;
}

export async function enqueueDiscoveryScan(job: DiscoveryScanJob): Promise<string> {
  const q = getScanQueue();
  const added = await q.add('scan', job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: false,
  });
  return added.id ?? 'unknown';
}

export async function enqueueDiscoveryProcess(job: DiscoveryProcessJob): Promise<string> {
  const q = getProcessQueue();
  const added = await q.add('process', job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 500,
    removeOnFail: false,
  });
  return added.id ?? 'unknown';
}

export async function scheduleRecurringDiscoveryScan(): Promise<void> {
  const q = getScanQueue();

  await q.add(
    'scan',
    { triggeredBy: 'cron' },
    {
      repeat: { every: 5 * 60 * 1000 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 50,
      removeOnFail: false,
    },
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — Intelligence queues (research + matching)
// ---------------------------------------------------------------------------

export type ResearchRunJobData = ResearchRunJob;
export type MatchingRunJobData = MatchingRunJob;

let researchQueue: Queue<ResearchRunJobData> | null = null;
let matchingQueue: Queue<MatchingRunJobData> | null = null;

export function getResearchQueue(): Queue<ResearchRunJobData> {
  if (!researchQueue) {
    researchQueue = new Queue<ResearchRunJobData>(RESEARCH_RUN_QUEUE, {
      connection: duplicateRedis(),
    });
  }
  return researchQueue;
}

export function getMatchingQueue(): Queue<MatchingRunJobData> {
  if (!matchingQueue) {
    matchingQueue = new Queue<MatchingRunJobData>(MATCHING_RUN_QUEUE, {
      connection: duplicateRedis(),
    });
  }
  return matchingQueue;
}

export async function enqueueResearchRun(job: ResearchRunJobData): Promise<string> {
  const added = await getResearchQueue().add('research', job, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: false,
  });
  return added.id ?? 'unknown';
}

export async function enqueueMatchingRun(job: MatchingRunJobData): Promise<string> {
  const added = await getMatchingQueue().add('match', job, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 200,
    removeOnFail: false,
  });
  return added.id ?? 'unknown';
}

