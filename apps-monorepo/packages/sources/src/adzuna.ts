import type { RawJobDetail, SearchQuery } from '@jobsearch/shared-types';
import { SourceError, type JobSource } from './source.interface.js';
import { inferRemoteType, parseSalaryRange, stripHtml } from './normalizer.js';

const BASE = 'https://api.adzuna.com/v1/api/jobs';

interface AdzunaJob {
  id: string;
  title: string;
  redirect_url: string;
  latitude?: number | null;
  longitude?: number | null;
  created?: string | null;
  description?: string | null;
  contract_time?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  company?: { display_name?: string | null } | null;
  location?: { display_name?: string | null } | null;
}

interface AdzunaResponse {
  count?: number;
  results?: AdzunaJob[];
}

export interface AdzunaConfig {
  appId: string;
  appKey: string;
  /** Country code, default 'us' */
  country?: string;
}

/**
 * Adzuna adapter (official aggregator API; requires APP_ID + APP_KEY, generous free tier).
 */
export function createAdzunaSource(config: AdzunaConfig): JobSource {
  return {
    sourceType: 'adzuna',

    async discover(query: SearchQuery & { boardToken?: string }) {
      const country = config.country ?? 'us';
      const page = 1;
      const limit = query.limit ?? 50;
      const params = new URLSearchParams({
        'app_id': config.appId,
        'app_key': config.appKey,
        results_per_page: String(limit),
        content: 'true',
        'what': query.keywords ?? '',
      });
      if (query.location) params.set('where', query.location);
      if (query.postedWithinDays) params.set('max_days_old', String(query.postedWithinDays));

      const url = `${BASE}/${country}/search/${page}?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new SourceError('adzuna', 'Invalid or missing Adzuna credentials', res.status);
      }
      if (!res.ok) {
        throw new SourceError('adzuna', `HTTP ${res.status}`, res.status);
      }
      const body = (await res.json()) as AdzunaResponse;
      return (body.results ?? []).map((r) => this.normalize(r));
    },

    async fetchJob(): Promise<RawJobDetail | null> {
      return null; // discovery payload is already complete
    },

    normalize(raw: unknown): RawJobDetail {
      const r = raw as AdzunaJob;
      const location = r.location?.display_name ?? null;
      return {
        externalId: r.id,
        sourceType: 'adzuna',
        sourceUrl: r.redirect_url,
        title: stripHtml(r.title) ?? r.title.trim(),
        company: r.company?.display_name ?? 'Unknown',
        location,
        remoteType: inferRemoteType(location),
        salaryMin: r.salary_min ?? null,
        salaryMax: r.salary_max ?? null,
        currency: null,
        description: r.description ?? null,
        requirements: null,
        seniority: null,
        employmentType: r.contract_time ?? null,
        postedAt: r.created ?? null,
        rawData: { adzuna_id: r.id },
      };
    },
  };
}
