import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db package BEFORE importing the app under test.
const mockSupabaseChain = () => {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: null, error: null })),
    then: undefined as unknown,
  };
  return chain;
};

const chain = mockSupabaseChain();

vi.mock('@jobsearch/db', () => ({
  getPlatformSupabase: () => chain,
  writeAudit: vi.fn(async () => undefined),
  enqueueDiscoveryScan: vi.fn(async () => 'test-queue-job-1'),
  getScanQueue: vi.fn(() => ({
    getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, failed: 0, completed: 0 })),
  })),
  getProcessQueue: vi.fn(() => ({
    getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, failed: 0, completed: 0 })),
  })),
  DISCOVERY_SCAN_QUEUE: 'discovery.scan',
  DISCOVERY_PROCESS_QUEUE: 'discovery.process',
}));

vi.mock('@jobsearch/sources', () => ({
  buildSourcesFromEnv: vi.fn(() => [
    { sourceType: 'greenhouse' },
    { sourceType: 'lever' },
  ]),
}));

describe('API smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_ADMIN_KEY = ''; // open gate for tests
  });

  it('GET /health returns ok', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  it('GET /api/sources lists configured adapters', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.sources).toEqual([{ sourceType: 'greenhouse' }, { sourceType: 'lever' }]);
    await app.close();
  });

  it('POST /api/discovery/scan enqueues and returns 202', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/scan',
      payload: { keywords: 'engineer' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().queueJobId).toBeTruthy();
    await app.close();
  });

  it('rejects scan trigger with invalid body', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/scan',
      payload: { boards: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/agent/runs returns list', async () => {
    chain.limit.mockResolvedValueOnce({ data: [{ id: 'run-1', agent_type: 'discovery' }], error: null });
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/agent/runs' });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toHaveLength(1);
    await app.close();
  });
});
