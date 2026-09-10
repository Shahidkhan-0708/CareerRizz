import type { RawJobDetail, SearchQuery } from '@jobsearch/shared-types';

/**
 * Every job source implements this interface. Adding a source never touches
 * the rest of the pipeline (architecture doc §9).
 */
export interface JobSource {
  /** Must match SourceType in shared-types ('greenhouse' | 'lever' | ...) */
  readonly sourceType: string;

  /**
   * Discover listings for a query. For board-style sources (Greenhouse/Lever/Ashby)
   * `query.boardToken` selects the company board; for aggregators (Adzuna)
   * keywords/location/limit apply directly.
   */
  discover(query: SearchQuery & { boardToken?: string }): Promise<RawJobDetail[]>;

  /** Fetch full detail for one listing (may just return the discovery payload). */
  fetchJob(externalId: string): Promise<RawJobDetail | null>;

  /** Map raw source payload to the normalizer input shape. Must be pure. */
  normalize(raw: unknown): RawJobDetail;
}

export class SourceError extends Error {
  constructor(
    public readonly sourceType: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`[${sourceType}] ${message}`);
    this.name = 'SourceError';
  }
}
