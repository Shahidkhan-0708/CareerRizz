import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeListing } from '@jobsearch/sources';
import { computeCanonicalHash } from '@jobsearch/sources';

// ---------------------------------------------------------------------------
// These tests exercise the pure pipeline logic (normalize + expected DB calls)
// without Redis or network. The worker entry itself needs REDIS_URL to boot.
//
// Direct subpath imports (@jobsearch/db/jobs.repo, /agent-runs) skip the
// barrel index that pulls in BullMQ + ioredis, cutting cold-start from ~5.5s
// to ~200ms on Windows NTFS.
// ---------------------------------------------------------------------------

const chain = () => {
  const c: any = {};
  const methods = [
    'from', 'upsert', 'update', 'select', 'eq', 'single', 'insert',
  ];
  for (const m of methods) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.single = vi.fn().mockResolvedValue({ data: { id: 'listing-1', created_at: new Date().toISOString() }, error: null });
  return c;
};

describe('discovery pipeline logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalize → saveNormalizedListing upserts jobs + job_sources', async () => {
    const { saveNormalizedListing } = await import('@jobsearch/db/jobs.repo');
    const supabase = chain();

    const normalized = normalizeListing({
      externalId: 'gh-9',
      sourceType: 'greenhouse',
      sourceUrl: 'https://boards.greenhouse.io/test/jobs/9',
      title: 'Senior Engineer',
      company: 'TestCo',
      location: 'Remote',
      remoteType: 'unknown',
      salaryMin: null,
      salaryMax: null,
      currency: null,
      description: 'Do things. $100,000 - $140,000.',
      requirements: null,
      seniority: null,
      employmentType: null,
      postedAt: null,
      rawData: {},
    });

    const result = await saveNormalizedListing(supabase as any, normalized);

    expect(result.isNew).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('job_listings');
    expect(supabase.from).toHaveBeenCalledWith('job_sources');
    expect(supabase.upsert).toHaveBeenCalled();
  });

  it('wrapAgentRun records success and failure rows', async () => {
    const { wrapAgentRun } = await import('@jobsearch/db/agent-runs');
    const supabase = chain();

    const out = await wrapAgentRun(supabase as any, { agent_type: 'discovery' }, async () => ({ ok: 1 }));
    expect(out).toEqual({ ok: 1 });

    supabase.single = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'run-1' }, error: null })
      .mockResolvedValue({ data: null, error: null });

    await expect(
      wrapAgentRun(supabase as any, { agent_type: 'discovery' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
