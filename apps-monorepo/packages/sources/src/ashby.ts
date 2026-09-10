import type { RawJobDetail, SearchQuery } from '@jobsearch/shared-types';
import { SourceError, type JobSource } from './source.interface.js';
import { inferRemoteType, parseSalaryRange, stripHtml } from './normalizer.js';

const BASE = 'https://api.ashbyhq.com/posting-api/job-board';

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  location?: string | null;
  workplaceType?: string | null;
  publishedAt?: string | null;
  descriptionPlain?: string | null;
  descriptionHtml?: string | null;
  employmentType?: string | null;
  isListed?: boolean;
  department?: string | null;
}

interface AshbyBoard {
  jobs: AshbyJob[];
}

export interface AshbyBoardConfig {
  /** Ashby board handle, e.g. "ashby" for api.ashbyhq.com/posting-api/job-board/ashby */
  boardHandle: string;
  /** Canonical company name to stamp on normalized listings. */
  company: string;
}

/**
 * Ashby Job Board API adapter (official public API, no auth).
 * One adapter instance per company board handle.
 */
export function createAshbySource(config: AshbyBoardConfig): JobSource {
  return {
    sourceType: 'ashby',

    async discover(query: SearchQuery & { boardToken?: string }) {
      const handle = query.boardToken ?? config.boardHandle;
      const url = `${BASE}/${encodeURIComponent(handle)}?includeCompensation=true`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) {
        throw new SourceError('ashby', `Board handle not found: ${handle}`, 404);
      }
      if (!res.ok) {
        throw new SourceError('ashby', `HTTP ${res.status}`, res.status);
      }
      const board = (await res.json()) as AshbyBoard;
      return (board.jobs ?? []).filter((j) => j.isListed !== false).map((j) => this.normalize(j));
    },

    async fetchJob(): Promise<RawJobDetail | null> {
      return null; // discovery payload is already complete
    },

    normalize(raw: unknown): RawJobDetail {
      const j = raw as AshbyJob;

      // Ashby compensation bands (when includeCompensation=true)
      let salaryMin: number | null = null;
      let salaryMax: number | null = null;
      let currency: string | null = null;
      const comp = (j as unknown as {
        compensation?: Array<{
          amount?: { value?: number } | null;
          currency?: string | null;
          unit?: string | null;
        }>;
      }).compensation;
      if (Array.isArray(comp)) {
        const salaryComponents = comp.filter((c) => c.unit === 'YEAR' || c.unit === 'year');
        const amounts = salaryComponents.map((c) => c.amount?.value).filter((v): v is number => typeof v === 'number');
        if (amounts.length > 0) {
          salaryMin = Math.min(...amounts);
          salaryMax = Math.max(...amounts);
          currency = salaryComponents[0]?.currency ?? null;
        }
      }

      const description = j.descriptionPlain ?? stripHtml(j.descriptionHtml);

      const fallback = parseSalaryRange(description);
      if (salaryMin === null && fallback.min !== null) {
        salaryMin = fallback.min;
        salaryMax = fallback.max;
      }

      return {
        externalId: j.id,
        sourceType: 'ashby',
        sourceUrl: j.jobUrl,
        title: j.title,
        company: config.company,
        location: j.location ?? null,
        remoteType: inferRemoteType(j.location, j.workplaceType),
        salaryMin,
        salaryMax,
        currency,
        description,
        requirements: null,
        seniority: null,
        employmentType: j.employmentType ?? null,
        postedAt: j.publishedAt ?? null,
        rawData: { ashby_id: j.id, department: j.department ?? null },
      };
    },
  };
}
