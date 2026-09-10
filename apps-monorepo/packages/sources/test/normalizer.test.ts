import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  computeCanonicalHash,
  inferSeniority,
  inferRemoteType,
  parseSalaryRange,
  normalizeListing,
} from '../src/normalizer.js';

describe('canonicalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(canonicalize('Senior Software Engineer (Remote)')).toBe('senior software engineer remote');
  });

  it('collapses whitespace and normalizes ampersands', () => {
    expect(canonicalize('Data  &  Analytics Lead')).toBe('data and analytics lead');
  });

  it('handles null/undefined', () => {
    expect(canonicalize(null)).toBe('');
    expect(canonicalize(undefined)).toBe('');
  });
});

describe('computeCanonicalHash', () => {
  it('is identical for equivalent listings with different formatting', () => {
    const a = computeCanonicalHash({
      title: 'Senior Software Engineer (Remote)',
      company: 'Stripe, Inc.',
      location: 'San Francisco, CA',
    });
    const b = computeCanonicalHash({
      title: 'senior software engineer — remote',
      company: 'stripe inc',
      location: 'san francisco, ca',
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });

  it('differs when location differs', () => {
    const a = computeCanonicalHash({ title: 'Engineer', company: 'Acme', location: 'NYC' });
    const b = computeCanonicalHash({ title: 'Engineer', company: 'Acme', location: 'SF' });
    expect(a).not.toBe(b);
  });
});

describe('inferSeniority', () => {
  it('detects senior', () => {
    expect(inferSeniority('Senior Backend Engineer')).toBe('senior');
  });

  it('detects staff', () => {
    expect(inferSeniority('Staff Software Engineer')).toBe('principal');
  });

  it('detects internship', () => {
    expect(inferSeniority('Summer Intern — Engineering')).toBe('internship');
  });

  it('returns null for no signal', () => {
    expect(inferSeniority('Software Engineer')).toBeNull();
  });
});

describe('inferRemoteType', () => {
  it('detects remote in location', () => {
    expect(inferRemoteType('Remote — US')).toBe('remote');
  });

  it('detects hybrid', () => {
    expect(inferRemoteType('New York (Hybrid)')).toBe('hybrid');
  });

  it('detects onsite via workplaceType', () => {
    expect(inferRemoteType('London', 'On-site')).toBe('onsite');
  });

  it('returns unknown when no signal', () => {
    expect(inferRemoteType('Berlin')).toBe('unknown');
  });
});

describe('parseSalaryRange', () => {
  it('parses $120,000 - $180,000', () => {
    expect(parseSalaryRange('Salary: $120,000 - $180,000 per year')).toEqual({
      min: 120000,
      max: 180000,
    });
  });

  it('parses 120k–150k', () => {
    expect(parseSalaryRange('120k–150k')).toEqual({ min: 120000, max: 150000 });
  });

  it('returns nulls when only implausible numbers exist', () => {
    expect(parseSalaryRange('Room 405, building 7')).toEqual({ min: null, max: null });
  });

  it('returns nulls for empty input', () => {
    expect(parseSalaryRange(null)).toEqual({ min: null, max: null });
  });
});

describe('normalizeListing', () => {
  const baseRaw = {
    externalId: 'gh-1',
    sourceType: 'greenhouse' as const,
    sourceUrl: 'https://boards.greenhouse.io/stripe/jobs/1',
    title: 'Senior Software Engineer',
    company: 'Stripe',
    location: 'Remote — US',
    remoteType: 'unknown' as const,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    description: 'We are hiring. Salary: $150,000 - $200,000.',
    requirements: null,
    seniority: null,
    employmentType: null,
    postedAt: '2026-09-01T00:00:00.000Z',
    rawData: {},
  };

  it('computes canonical hash and infers remote + seniority', () => {
    const n = normalizeListing(baseRaw);
    expect(n.canonicalHash).toHaveLength(64);
    expect(n.remoteType).toBe('remote');
    expect(n.seniority).toBe('senior');
    expect(n.salaryMin).toBe(150000);
    expect(n.salaryMax).toBe(200000);
  });

  it('prefers override remoteType over inference', () => {
    const n = normalizeListing(baseRaw, { remoteType: 'hybrid' });
    expect(n.remoteType).toBe('hybrid');
  });

  it('keeps source block intact', () => {
    const n = normalizeListing(baseRaw);
    expect(n.source.sourceType).toBe('greenhouse');
    expect(n.source.externalJobId).toBe('gh-1');
    expect(n.source.sourceUrl).toContain('boards.greenhouse.io');
  });
});
