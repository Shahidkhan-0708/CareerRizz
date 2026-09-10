import { createHash } from 'node:crypto';
import type { NormalizedJob, RawJobDetail } from '@jobsearch/shared-types';

// ---------------------------------------------------------------------------
// canonical_hash — dedup identity per architecture doc §5/§9
// hash(normalized title + company + location), lowercased, whitespace-collapsed
// ---------------------------------------------------------------------------

export function canonicalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function computeCanonicalHash(input: {
  title: string;
  company: string;
  location?: string | null;
}): string {
  const parts = [
    canonicalize(input.title),
    canonicalize(input.company),
    canonicalize(input.location),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

const SENIORITY_PATTERNS: Array<{ re: RegExp; level: string }> = [
  { re: /\b(chief|c-level|cto|ceo|cfo|coo)\b/i, level: 'executive' },
  { re: /\b(vp|vice president|head of)\b/i, level: 'director_plus' },
  { re: /\b(director)\b/i, level: 'director' },
  { re: /\b(principal|staff)\b/i, level: 'principal' },
  { re: /\b(senior|sr\.?|lead)\b/i, level: 'senior' },
  { re: /\b(junior|jr\.?|entry[- ]level|graduate|associate)\b/i, level: 'junior' },
  { re: /\bintern(ship)?\b/i, level: 'internship' },
];

export function inferSeniority(title: string): string | null {
  for (const { re, level } of SENIORITY_PATTERNS) {
    if (re.test(title)) return level;
  }
  return null;
}

const REMOTE_PATTERNS = [
  { re: /\b(remote|work from home|wfh|anywhere)\b/i, value: 'remote' as const },
  { re: /\b(hybrid)\b/i, value: 'hybrid' as const },
  { re: /\b(on[- ]?site|in[- ]?office)\b/i, value: 'onsite' as const },
];

export function inferRemoteType(
  location?: string | null,
  workplaceType?: string | null,
): 'remote' | 'hybrid' | 'onsite' | 'unknown' {
  const hay = `${workplaceType ?? ''} ${location ?? ''}`;
  for (const { re, value } of REMOTE_PATTERNS) {
    if (re.test(hay)) return value;
  }
  return 'unknown';
}

/**
 * Decode HTML entities and strip tags. Handles double-escaped content
 * (e.g. Greenhouse boards): decode twice, strip tags, decode once more.
 */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  return (
    decode(decode(html))
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

export function parseSalaryRange(text?: string | null): {
  min: number | null;
  max: number | null;
} {
  if (!text) return { min: null, max: null };
  // Matches "$120,000 - $180,000", "120k–150k", "$70/hr — $90/hr" (per-hour scaled ×2080 is NOT applied; kept raw)
  const nums = [...text.matchAll(/(?:\$|€|£)?(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?)(k)?/gi)].map((m) => {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]) n *= 1_000;
    return Math.round(n);
  });
  const plausible = nums.filter((n) => n >= 10_000 && n <= 2_000_000);
  if (plausible.length === 0) return { min: null, max: null };
  const min = Math.min(...plausible);
  const max = Math.max(...plausible);
  return { min: min === max ? null : min, max: max === min ? null : max };
}

/** Map a raw listing from any adapter into the canonical NormalizedJob shape. */
export function normalizeListing(
  raw: RawJobDetail,
  overrides?: Partial<Pick<RawJobDetail, 'remoteType' | 'salaryMin' | 'salaryMax'>>,
): NormalizedJob {
  const remoteType =
    overrides?.remoteType && overrides.remoteType !== 'unknown'
      ? overrides.remoteType
      : raw.remoteType !== 'unknown'
        ? raw.remoteType
        : inferRemoteType(raw.location);
  const salary = overrides?.salaryMin || overrides?.salaryMax
    ? { min: overrides.salaryMin ?? null, max: overrides.salaryMax ?? null }
    : parseSalaryRange(raw.description?.slice(0, 2000));

  return {
    canonicalHash: computeCanonicalHash({
      title: raw.title,
      company: raw.company,
      location: raw.location,
    }),
    title: raw.title.trim(),
    company: raw.company.trim(),
    location: raw.location?.trim() ?? null,
    remoteType,
    salaryMin: salary.min,
    salaryMax: salary.max,
    currency: raw.currency ?? null,
    description: raw.description ?? null,
    requirements: raw.requirements ?? null,
    seniority: raw.seniority ?? inferSeniority(raw.title),
    employmentType: raw.employmentType ?? null,
    postedAt: raw.postedAt ?? null,
    source: {
      sourceType: raw.sourceType,
      sourceUrl: raw.sourceUrl,
      externalJobId: raw.externalId,
      rawData: raw.rawData,
    },
  };
}
