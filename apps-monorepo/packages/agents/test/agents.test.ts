import { describe, it, expect } from 'vitest';
import { buildResearchPrompt, cleanCompanyName } from '../src/research-agent.js';
import { buildMatchPrompt, parseVector, type JobCore, type CandidateCore } from '../src/matching-agent.js';
import { cosineSimilarity } from '../src/similarity.js';

describe('cleanCompanyName', () => {
  it('strips common corporate suffixes', () => {
    expect(cleanCompanyName('Vercel Inc.')).toBe('Vercel');
    expect(cleanCompanyName('Acme Corp')).toBe('Acme');
    expect(cleanCompanyName('Globex LLC')).toBe('Globex');
    expect(cleanCompanyName('Initech')).toBe('Initech');
  });

  it('leaves multiword names intact', () => {
    expect(cleanCompanyName('Data Systems Group')).toBe('Data Systems Group');
  });
});

describe('buildResearchPrompt', () => {
  const job = {
    id: 'job-1',
    title: 'Senior Engineer',
    company: 'Vercel',
    location: 'Remote',
    description: 'Build edge tooling.',
  };

  it('includes job fields and facts with sources', () => {
    const prompt = buildResearchPrompt(job, [
      { topic: 'company_overview', content: 'Vercel makes a frontend cloud.', source: 'https://en.wikipedia.org/wiki/Vercel', confidence: 0.85 },
    ]);
    expect(prompt).toContain('Senior Engineer');
    expect(prompt).toContain('Vercel');
    expect(prompt).toContain('Vercel makes a frontend cloud.');
    expect(prompt).toContain('https://en.wikipedia.org/wiki/Vercel');
  });

  it('has a no-facts branch that instructs low confidence', () => {
    const prompt = buildResearchPrompt(job, []);
    expect(prompt).toContain('no web facts found');
    expect(prompt).toContain('confidence <= 0.3');
  });

  it('demands JSON output', () => {
    expect(buildResearchPrompt(job, [])).toContain('Respond as JSON');
  });
});

describe('parseVector', () => {
  it('parses pgvector string form', () => {
    expect(parseVector('[0.1,0.2,0.3]')).toEqual([0.1, 0.2, 0.3]);
    expect(parseVector(' [0.1, 0.2] ')).toEqual([0.1, 0.2]);
  });

  it('accepts plain arrays and rejects garbage', () => {
    expect(parseVector([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseVector('not a vector')).toBeNull();
    expect(parseVector(null)).toBeNull();
    expect(parseVector(undefined)).toBeNull();
    expect(parseVector('[0.1,abc]')).toBeNull();
  });
});

describe('buildMatchPrompt', () => {
  const job: JobCore = {
    id: 'job-1',
    title: 'Staff Engineer',
    company: 'Netflix',
    location: 'Los Gatos',
    remote_type: 'onsite',
    salary_min: 200000,
    salary_max: 300000,
    description: 'Big streaming.',
    requirements: '10 years experience',
    seniority: 'staff',
    status: 'eligible',
    embedding: null,
  };

  const candidate: CandidateCore = {
    id: 'cand-1',
    full_name: 'Ada Lovelace',
    target_roles: ['Staff Engineer'],
    preferred_locations: ['Bay Area'],
    remote_preference: 'remote',
    min_salary: 180000,
    max_salary: 260000,
    skills: ['TypeScript', 'Node.js'],
    must_have_keywords: ['TypeScript'],
    exclude_keywords: ['crypto'],
    years_experience: 9,
  };

  it('contains candidate and job blocks, exclusions, and the similarity signal', () => {
    const prompt = buildMatchPrompt(job, candidate, 0.812);
    expect(prompt).toContain('Ada Lovelace');
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('crypto');
    expect(prompt).toContain('Staff Engineer');
    expect(prompt).toContain('0.812');
    expect(prompt).toContain('Respond as JSON');
  });

  it('omits the similarity line when embedding is unavailable', () => {
    const prompt = buildMatchPrompt(job, candidate, null);
    expect(prompt).not.toContain('Semantic embedding similarity');
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors, 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is scale-invariant and safe on zero vectors / mismatched lengths', () => {
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});
