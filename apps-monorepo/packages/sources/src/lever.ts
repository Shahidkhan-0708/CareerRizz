import type { RawJobDetail, SearchQuery } from '@jobsearch/shared-types';
import { SourceError, type JobSource } from './source.interface.js';
import { inferRemoteType, parseSalaryRange, stripHtml } from './normalizer.js';

const BASE = 'https://api.lever.co/v0/postings';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt: number; // epoch ms
  categories?: {
    team?: string | null;
    location?: string | null;
    commitment?: string | null;
  };
  description?: string | null;
  descriptionPlain?: string | null;
  lists?: unknown;
  workplaceType?: string | null;
}

export interface LeverBoardConfig {
  /** Lever company slug, e.g. "netflix" for api.lever.co/v0/postings/netflix */
  companySlug: string;
  /** Canonical company name to stamp on normalized listings. */
  company: string;
}

/**
 * Lever Postings API adapter (official public API, no auth).
 * One adapter instance per company slug.
 */
export function createLeverSource(config: LeverBoardConfig): JobSource {
  return {
    sourceType: 'lever',

    async discover(query: SearchQuery & { boardToken?: string }) {
      const slug = query.boardToken ?? config.companySlug;
      const url = `${BASE}/${encodeURIComponent(slug)}?mode=json`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) {
        throw new SourceError('lever', `Company slug not found: ${slug}`, 404);
      }
      if (!res.ok) {
        throw new SourceError('lever', `HTTP ${res.status}`, res.status);
      }
      const postings = (await res.json()) as LeverPosting[];
      return postings.map((p) => this.normalize(p));
    },

    async fetchJob(): Promise<RawJobDetail | null> {
      return null; // discovery payload is already complete
    },

    normalize(raw: unknown): RawJobDetail {
      const p = raw as LeverPosting;
      const location = p.categories?.location ?? null;
      const description = p.descriptionPlain ?? stripHtml(p.description);

      const salary = parseSalaryRange(description);

      return {
        externalId: p.id,
        sourceType: 'lever',
        sourceUrl: p.hostedUrl,
        title: p.text,
        company: config.company,
        location,
        remoteType: inferRemoteType(location, p.workplaceType),
        salaryMin: salary.min,
        salaryMax: salary.max,
        currency: null,
        description,
        requirements: null,
        seniority: null,
        employmentType: p.categories?.commitment ?? null,
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        rawData: { lever_id: p.id, team: p.categories?.team ?? null },
      };
    },
  };
}
