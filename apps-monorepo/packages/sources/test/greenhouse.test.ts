import { describe, it, expect } from 'vitest';
import { createGreenhouseSource } from '../src/greenhouse.js';

describe('greenhouse adapter (unit, no network)', () => {
  const source = createGreenhouseSource({ boardToken: 'test', company: 'TestCo' });

  it('normalizes a greenhouse job payload', () => {
    const raw = {
      id: 12345,
      title: 'Senior Software Engineer',
      absolute_url: 'https://boards.greenhouse.io/test/jobs/12345',
      updated_at: '2026-09-01T10:00:00-04:00',
      first_published: '2026-09-01T10:00:00-04:00',
      content: '<div><p>We are hiring. Salary: $150,000 - $200,000</p><script>evil()</script></div>',
      location: { name: 'Remote — US' },
      offices: [{ name: 'NYC' }, { name: 'SF' }],
    };

    const n = source.normalize(raw);
    expect(n.externalId).toBe('12345');
    expect(n.company).toBe('TestCo');
    expect(n.title).toBe('Senior Software Engineer');
    expect(n.location).toBe('Remote — US');
    expect(n.remoteType).toBe('remote');
    expect(n.description).toContain('We are hiring');
    expect(n.description).not.toContain('evil()');
    expect(n.salaryMin).toBe(150000);
    expect(n.salaryMax).toBe(200000);
    expect(n.postedAt).toBe('2026-09-01T10:00:00-04:00');
  });

  it('falls back to offices when location missing', () => {
    const raw = {
      id: 1,
      title: 'Engineer',
      absolute_url: 'https://x/',
      offices: [{ name: 'Berlin' }, { name: 'Paris' }],
    };
    const n = source.normalize(raw);
    expect(n.location).toBe('Berlin; Paris');
  });

  it('discover throws SourceError without boardToken', async () => {
    const noToken = createGreenhouseSource({ boardToken: '', company: 'X' });
    await expect(noToken.discover({})).rejects.toThrow(/boardToken/);
  });
});
