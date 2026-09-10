import { Worker, type Job } from 'bullmq';
import {
  loadMonorepoEnv,
  getPlatformSupabase,
  getRedis,
  duplicateRedis,
  closeRedis,
  wrapAgentRun,
} from '@jobsearch/db';
import { createLLMGateway, loadRouterConfig, RedisBudgetStore } from '@jobsearch/llm-gateway';
import { runResearch, runMatch } from '@jobsearch/agents';
import type { ResearchRunJob, MatchingRunJob } from '@jobsearch/shared-types';

loadMonorepoEnv();

const logger = console;

export function buildGateway() {
  return createLLMGateway(loadRouterConfig(), new RedisBudgetStore(getRedis()));
}

// ---------------------------------------------------------------------------
// Worker: research.run — web research + LLM synthesis → job_research
// ---------------------------------------------------------------------------

export function startResearchWorker(gateway = buildGateway()): Worker<ResearchRunJob> {
  const supabase = getPlatformSupabase();

  const worker = new Worker<ResearchRunJob>(
    'research.run',
    async (job: Job<ResearchRunJob>) => {
      const { jobId, candidateId } = job.data;

      return wrapAgentRun(
        supabase,
        { agent_type: 'research', job_id: jobId, candidate_id: candidateId ?? null, input: { jobId } },
        async () => runResearch(supabase, gateway, jobId, candidateId),
      );
    },
    { connection: duplicateRedis(), concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[research.run] job ${job?.id} failed after retries:`, err.message);
  });

  return worker;
}

// ---------------------------------------------------------------------------
// Worker: matching.run — embeddings + LLM scoring → job_matches
// ---------------------------------------------------------------------------

export function startMatchingWorker(gateway = buildGateway()): Worker<MatchingRunJob> {
  const supabase = getPlatformSupabase();

  const worker = new Worker<MatchingRunJob>(
    'matching.run',
    async (job: Job<MatchingRunJob>) => {
      const { jobId, candidateId, resumeId } = job.data;

      return wrapAgentRun(
        supabase,
        { agent_type: 'matching', job_id: jobId, candidate_id: candidateId, input: { jobId, resumeId } },
        async () => runMatch(supabase, gateway, jobId, candidateId, resumeId),
      );
    },
    { connection: duplicateRedis(), concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[matching.run] job ${job?.id} failed after retries:`, err.message);
  });

  return worker;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isEntry = process.argv[1]?.replace(/\\/g, '/').endsWith('intelligence.worker.ts');

if (isEntry) {
  const gateway = buildGateway();
  const researchWorker = startResearchWorker(gateway);
  const matchingWorker = startMatchingWorker(gateway);

  const shutdown = async (signal: string) => {
    logger.info(`[intelligence] ${signal} received — shutting down`);
    await Promise.all([researchWorker.close(), matchingWorker.close()]);
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('[intelligence] research + matching workers running (ctrl-c to stop)');
}
