import { Worker, type Job } from 'bullmq';
import {
  loadMonorepoEnv,
  getPlatformSupabase,
  getRedis,
  duplicateRedis,
  RedisRateLimiter,
  saveNormalizedListing,
  wrapAgentRun,
  writeAudit,
  closeRedis,
  enqueueDiscoveryProcess,
  scheduleRecurringDiscoveryScan,
  DISCOVERY_PROCESS_QUEUE,
  type DiscoveryProcessJob,
  type DiscoveryScanJob,
} from '@jobsearch/db';
import { buildSourcesFromEnv, normalizeListing } from '@jobsearch/sources';
import type { RawJobDetail } from '@jobsearch/shared-types';

loadMonorepoEnv();

const logger = console;

// ---------------------------------------------------------------------------
// Worker 1: discovery.scan — fans out one discovery.process job per listing
// ---------------------------------------------------------------------------

export function startScanWorker(): Worker<DiscoveryScanJob> {
  const supabase = getPlatformSupabase();
  const limiter = new RedisRateLimiter(getRedis());

  const worker = new Worker<DiscoveryScanJob>(
    'discovery.scan',
    async (job: Job<DiscoveryScanJob>) => {
      const sources = buildSourcesFromEnv();
      const selected = job.data.sources?.length
        ? sources.filter((s) => job.data.sources!.includes(s.sourceType))
        : sources;

      if (selected.length === 0) {
        logger.warn('[discovery.scan] no sources configured (set JOB_SOURCES_* env vars)');
        return { scanned: 0, enqueued: 0 };
      }

      let enqueued = 0;

      for (const source of selected) {
        const boardToken = job.data.query?.boardToken ?? source.sourceType;
        try {
          // Rate limit per source+board (doc §9)
          const allowed = await limiter.consume(source.sourceType, boardToken, 30);
          if (!allowed) {
            logger.warn(`[discovery.scan] rate limited: ${source.sourceType}/${boardToken}`);
            continue;
          }

          const listings = await source.discover({ ...(job.data.query ?? {}) });
          logger.info(`[discovery.scan] ${source.sourceType}/${boardToken}: ${listings.length} listings`);

          for (const raw of listings) {
            await enqueueDiscoveryProcess({
              raw: raw as unknown as Record<string, unknown>,
              sourceType: source.sourceType,
              boardToken,
            });
            enqueued += 1;
          }

          await writeAudit(supabase, {
            actor: 'discovery',
            action: 'scan.source',
            entityType: 'source',
            entityId: `${source.sourceType}:${boardToken}`,
            metadata: { listings: listings.length },
          });
        } catch (err) {
          logger.error(
            `[discovery.scan] source failed: ${source.sourceType}/${boardToken}:`,
            err instanceof Error ? err.message : err,
          );
          // Continue with remaining sources — degrade gracefully (doc §20)
        }
      }

      return { scanned: selected.length, enqueued };
    },
    { connection: duplicateRedis(), concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[discovery.scan] job ${job?.id} failed after retries:`, err.message);
  });

  return worker;
}

// ---------------------------------------------------------------------------
// Worker 2: discovery.process — normalize + dedup + persist one listing
// ---------------------------------------------------------------------------

export function startProcessWorker(): Worker<DiscoveryProcessJob> {
  const supabase = getPlatformSupabase();

  const worker = new Worker<DiscoveryProcessJob>(
    DISCOVERY_PROCESS_QUEUE,
    async (job: Job<DiscoveryProcessJob>) => {
      const { raw, sourceType, boardToken } = job.data;

      return wrapAgentRun(supabase, { agent_type: 'discovery', input: { sourceType, boardToken } }, async () => {
        const rawDetail = raw as unknown as RawJobDetail;
        // normalizeListing recomputes canonicalHash deterministically and
        // re-infers seniority/remote/salary as a safety net.
        const normalized = normalizeListing(rawDetail);

        const { listingId, isNew } = await saveNormalizedListing(supabase, normalized);

        return {
          listingId,
          isNew,
          title: normalized.title,
          company: normalized.company,
          canonicalHash: normalized.canonicalHash,
        };
      });
    },
    { connection: duplicateRedis(), concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[discovery.process] job ${job?.id} failed after retries:`, err.message);
  });

  return worker;
}

// ---------------------------------------------------------------------------
// Entry point: start both workers + the 5-min repeatable scan job
// ---------------------------------------------------------------------------

const isEntry = process.argv[1]?.replace(/\\/g, '/').endsWith('discovery.worker.ts');

if (isEntry) {
  const scanWorker = startScanWorker();
  const processWorker = startProcessWorker();
  scheduleRecurringDiscoveryScan().catch((err) => {
    logger.error('[discovery] failed to schedule recurring scan:', err.message);
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    logger.info(`[discovery] ${signal} received — shutting down`);
    await Promise.all([scanWorker.close(), processWorker.close()]);
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('[discovery] workers running (scan every 5 min; ctrl-c to stop)');
}
