import type { RawJobDetail, SearchQuery } from '@jobsearch/shared-types';
import { SourceError, type JobSource } from './source.interface.js';
import { inferRemoteType, parseSalaryRange, stripHtml } from './normalizer.js';

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

interface GHJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  content?: string;
  location?: { name?: string | null };
  offices?: Array<{ name?: string | null }>;
}

interface GHBoard {
  jobs: GHJob[];
}

export interface GreenhouseBoardConfig {
  /** Greenhouse board token, e.g. "stripe" for boards-api.greenhouse.io/v1/boards/stripe/jobs */
  boardToken: string;
  /** Canonical company name to stamp on normalized listings. */
  company: string;
}

/**
 * Greenhouse Job Board API adapter (official public API, no auth).
 * One adapter instance per company board.
 */
export function createGreenhouseSource(config: GreenhouseBoardConfig): JobSource {
  return {
    sourceType: 'greenhouse',

    async discover(query: SearchQuery & { boardToken?: string }) {
      const token = query.boardToken ?? config.boardToken;
      if (!token) {
        throw new SourceError('greenhouse', 'boardToken (company board token) is required');
      }
      const url = `${BASE}/${encodeURIComponent(token)}/jobs?content=true`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) {
        throw new SourceError('greenhouse', `Board token not found: ${token}`, 404);
      }
      if (!res.ok) {
        throw new SourceError('greenhouse', `HTTP ${res.status}`, res.status);
      }
      const board = (await res.json()) as GHBoard;
      return (board.jobs ?? []).map((j) => this.normalize(j));
    },

    async fetchJob(): Promise<RawJobDetail | null> {
      // Discovery already fetches full content (content=true), so there is no
      // separate detail endpoint we need. Return null and let callers use the
      // discovery payload.
      return null;
    },

    normalize(raw: unknown): RawJobDetail {
      const j = raw as GHJob;
      const location =
        j.location?.name ??
        j.offices?.map((o) => o.name).filter(Boolean).join('; ') ??
        null;

      // Greenhouse content is HTML (often double-escaped) — decode + strip.
      const description = stripHtml(j.content);

      const salary = parseSalaryRange(description);

      return {
        externalId: String(j.id),
        sourceType: 'greenhouse',
        sourceUrl: j.absolute_url,
        title: j.title,
        company: config.company,
        location,
        remoteType: inferRemoteType(location),
        salaryMin: salary.min,
        salaryMax: salary.max,
        currency: null,
        description,
        requirements: null,
        seniority: null,
        employmentType: null,
        postedAt: j.first_published ?? j.updated_at ?? null,
        rawData: { greenhouse_id: j.id },
      };
    },
  };
}
