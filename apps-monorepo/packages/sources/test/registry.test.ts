import { describe, it, expect } from 'vitest';
import { parseBoardSpec, buildSourcesFromEnv } from '../src/registry.js';

describe('parseBoardSpec', () => {
  it('parses token:company pairs', () => {
    expect(parseBoardSpec('stripe:Stripe,vercel:Vercel')).toEqual([
      { token: 'stripe', company: 'Stripe' },
      { token: 'vercel', company: 'Vercel' },
    ]);
  });

  it('defaults company to token when omitted', () => {
    expect(parseBoardSpec('ramp')).toEqual([{ token: 'ramp', company: 'ramp' }]);
  });

  it('returns empty for undefined/empty spec', () => {
    expect(parseBoardSpec(undefined)).toEqual([]);
    expect(parseBoardSpec('')).toEqual([]);
  });
});

describe('buildSourcesFromEnv', () => {
  it('builds adapters from env specs', () => {
    const sources = buildSourcesFromEnv({
      JOB_SOURCES_GREENHOUSE: 'stripe:Stripe',
      JOB_SOURCES_LEVER: 'netflix:Netflix',
      JOB_SOURCES_ASHBY: 'ramp:Ramp',
    });
    expect(sources.map((s) => s.sourceType)).toEqual(['greenhouse', 'lever', 'ashby']);
  });

  it('includes adzuna only when both credentials are set', () => {
    const withCreds = buildSourcesFromEnv({
      ADZUNA_APP_ID: 'id',
      ADZUNA_APP_KEY: 'key',
    });
    expect(withCreds.map((s) => s.sourceType)).toContain('adzuna');

    const without = buildSourcesFromEnv({});
    expect(without.map((s) => s.sourceType)).not.toContain('adzuna');
  });
});
