import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  getPlatformSupabase,
  writeAudit,
  getScanQueue,
  getProcessQueue,
  getRedis,
  enqueueDiscoveryScan,
  enqueueResearchRun,
  enqueueMatchingRun,
  wrapAgentRun,
  upsertCandidateProfile,
  DISCOVERY_SCAN_QUEUE,
  DISCOVERY_PROCESS_QUEUE,
} from '@jobsearch/db';
import { createLLMGateway, loadRouterConfig, MemoryBudgetStore, RedisBudgetStore } from '@jobsearch/llm-gateway';
import { runResearch, runMatch } from '@jobsearch/agents';
import { buildSourcesFromEnv } from '@jobsearch/sources';
import { TriggerScanRequest, CandidateProfileInsert, ResearchRunJob, MatchingRunJob } from '@jobsearch/shared-types';

/**
 * Budget store: Redis-backed when REDIS_URL is present, in-memory otherwise
 * (dev/Redis-less mode). Same interface either way.
 */
function createBudgetStore() {
  return process.env.REDIS_URL ? new RedisBudgetStore(getRedis()) : new MemoryBudgetStore();
}

/**
 * Queue-or-run-inline: with Redis, Phase 3 jobs go through BullMQ (doc §7);
 * without Redis, they run inline inside the API process so the pipeline is
 * testable end-to-end. Every path still writes agent_runs via wrapAgentRun.
 */
async function researchOrEnqueue(supabase: ReturnType<typeof getPlatformSupabase>, data: ResearchRunJob): Promise<{ mode: 'queued' | 'inline' }> {
  if (process.env.REDIS_URL) {
    await enqueueResearchRun(data);
    return { mode: 'queued' };
  }
  const gateway = createLLMGateway(loadRouterConfig(), createBudgetStore());
  await wrapAgentRun(
    supabase,
    { agent_type: 'research', job_id: data.jobId, candidate_id: data.candidateId ?? null, input: { jobId: data.jobId } },
    () => runResearch(supabase, gateway, data.jobId, data.candidateId),
  );
  return { mode: 'inline' };
}

async function matchOrEnqueue(supabase: ReturnType<typeof getPlatformSupabase>, data: MatchingRunJob): Promise<{ mode: 'queued' | 'inline' }> {
  if (process.env.REDIS_URL) {
    await enqueueMatchingRun(data);
    return { mode: 'queued' };
  }
  const gateway = createLLMGateway(loadRouterConfig(), createBudgetStore());
  await wrapAgentRun(
    supabase,
    { agent_type: 'matching', job_id: data.jobId, candidate_id: data.candidateId, input: { jobId: data.jobId, resumeId: data.resumeId } },
    () => runMatch(supabase, gateway, data.jobId, data.candidateId, data.resumeId),
  );
  return { mode: 'inline' };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // Optional admin-key gate (mirrors the legacy backend convention)
  app.addHook('onRequest', async (req, reply) => {
    const required = process.env.PLATFORM_ADMIN_KEY;
    if (!required) return; // open when unset (dev)
    if (req.url === '/health' || req.url === '/api/health') return;
    const provided = req.headers['x-api-key'];
    if (provided !== required) {
      await reply.code(401).send({ error: 'Invalid or missing x-api-key' });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'jobsearch-api',
    ts: new Date().toISOString(),
  }));

  // Jobs (read from job_listings)
  app.get('/api/jobs', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const supabase = getPlatformSupabase();

    let query = supabase
      .from('job_listings')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(Math.min(Number(q.limit ?? 50), 200));

    if (q.status) query = query.eq('status', q.status);
    if (q.company) query = query.ilike('company', `%${q.company}%`);
    if (q.remote) query = query.eq('remote_type', q.remote);

    const { data, error } = await query;
    if (error) throw error;
    return { success: true, jobs: data ?? [] };
  });

  app.get('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const supabase = getPlatformSupabase();
    const { data, error } = await supabase
      .from('job_listings')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return reply.code(404).send({ error: 'Job not found' });
    return { success: true, job: data };
  });

  // Sources — current env-configured adapters
  app.get('/api/sources', async () => {
    const sources = buildSourcesFromEnv();
    return {
      success: true,
      sources: sources.map((s) => ({ sourceType: s.sourceType })),
    };
  });

  // Agent runs (Activity feed)
  app.get('/api/agent/runs', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const supabase = getPlatformSupabase();
    let query = supabase
      .from('agent_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(Math.min(Number(q.limit ?? 50), 200));
    if (q.type) query = query.eq('agent_type', q.type);
    if (q.status) query = query.eq('status', q.status);
    const { data, error } = await query;
    if (error) throw error;
    return { success: true, runs: data ?? [] };
  });

  // Trigger a discovery scan now (manual)
  app.post('/api/discovery/scan', async (req, reply) => {
    const parsed = TriggerScanRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const jobId = await enqueueDiscoveryScan({
      triggeredBy: 'manual',
      sources: parsed.data.boards,
      query: { keywords: parsed.data.keywords, location: parsed.data.location },
    });
    await writeAudit(getPlatformSupabase(), {
      actor: 'api',
      action: 'discovery.scan.triggered',
      entityType: 'queue_job',
      entityId: jobId,
      metadata: { ...parsed.data },
    });
    return reply.code(202).send({ success: true, queueJobId: jobId });
  });

  // Queue health (depths)
  app.get('/api/queue/health', async () => {
    const [scanCounts, processCounts] = await Promise.all([
      getScanQueue().getJobCounts('waiting', 'active', 'failed', 'completed'),
      getProcessQueue().getJobCounts('waiting', 'active', 'failed', 'completed'),
    ]);
    return {
      success: true,
      queues: {
        [DISCOVERY_SCAN_QUEUE]: scanCounts,
        [DISCOVERY_PROCESS_QUEUE]: processCounts,
      },
    };
  });

  // -------------------------------------------------------------------------
  // Phase 3 — Intelligence routes
  // -------------------------------------------------------------------------

  // Candidate profiles (create-or-update by full_name)
  app.post('/api/candidates', async (req, reply) => {
    const parsed = CandidateProfileInsert.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid candidate profile', details: parsed.error.flatten() });
    }
    try {
      const { id, created } = await upsertCandidateProfile(getPlatformSupabase(), parsed.data);
      await writeAudit(getPlatformSupabase(), {
        actor: 'api',
        action: created ? 'candidate.created' : 'candidate.updated',
        entityType: 'candidate_profile',
        entityId: id,
        metadata: { fullName: parsed.data.full_name },
      });
      return reply.code(created ? 201 : 200).send({ success: true, candidateId: id, created });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to save candidate' });
    }
  });

  app.get('/api/candidates', async () => {
    const { data, error } = await getPlatformSupabase()
      .from('candidate_profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return { success: true, candidates: data ?? [] };
  });

  // Research one job (queues with Redis, runs inline without)
  app.post('/api/jobs/:id/research', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { candidateId?: string };
    const parsed = ResearchRunJob.safeParse({ jobId: id, candidateId: body.candidateId ?? null });
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid job id', details: parsed.error.flatten() });
    }
    try {
      const { mode } = await researchOrEnqueue(getPlatformSupabase(), parsed.data);
      await writeAudit(getPlatformSupabase(), {
        actor: 'api',
        action: 'research.triggered',
        entityType: 'job_listing',
        entityId: id,
        metadata: { mode },
      });
      return reply.code(202).send({ success: true, mode });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Research failed' });
    }
  });

  // Read research facts for a job
  app.get('/api/jobs/:id/research', async (req) => {
    const { id } = req.params as { id: string };
    const { data, error } = await getPlatformSupabase()
      .from('job_research')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return { success: true, research: data ?? [] };
  });

  // Match one job against a candidate (queues with Redis, runs inline without)
  app.post('/api/jobs/:id/match', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { candidateId?: string; resumeId?: string };
    if (!body.candidateId) {
      return reply.code(400).send({ error: 'candidateId is required' });
    }
    const parsed = MatchingRunJob.safeParse({ jobId: id, candidateId: body.candidateId, resumeId: body.resumeId ?? null });
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid match request', details: parsed.error.flatten() });
    }
    try {
      const { mode } = await matchOrEnqueue(getPlatformSupabase(), parsed.data);
      await writeAudit(getPlatformSupabase(), {
        actor: 'api',
        action: 'match.triggered',
        entityType: 'job_listing',
        entityId: id,
        metadata: { mode, candidateId: body.candidateId },
      });
      return reply.code(202).send({ success: true, mode });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Match failed' });
    }
  });

  // Read matches for a job (or all matches for a candidate via ?candidateId=)
  app.get('/api/matches', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const supabase = getPlatformSupabase();
    let query = supabase
      .from('job_matches')
      .select('*')
      .order('overall_score', { ascending: false })
      .limit(Math.min(Number(q.limit ?? 50), 200));
    if (q.jobId) query = query.eq('job_id', q.jobId);
    if (q.candidateId) query = query.eq('candidate_id', q.candidateId);
    const { data, error } = await query;
    if (error) throw error;
    return { success: true, matches: data ?? [] };
  });

  return app;
}
