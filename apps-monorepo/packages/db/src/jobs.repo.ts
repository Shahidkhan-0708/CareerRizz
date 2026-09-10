import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedJob } from '@jobsearch/shared-types';

export interface SaveListingResult {
  listingId: string;
  isNew: boolean;
}

/**
 * Insert-or-update a normalized listing:
 * - jobs row keyed by canonical_hash (unique) — updates last_seen_at on re-discovery
 * - job_sources row keyed by (source_type, external_job_id) — updates last_seen_at
 *
 * Returns whether the listing was newly created (drives downstream processing).
 */
export async function saveNormalizedListing(
  supabase: SupabaseClient,
  job: NormalizedJob,
): Promise<SaveListingResult> {
  const now = new Date().toISOString();

  // 1) upsert jobs by canonical_hash
  const { data: listing, error: listingErr } = await supabase
    .from('job_listings')
    .upsert(
      {
        canonical_hash: job.canonicalHash,
        title: job.title,
        company: job.company,
        location: job.location,
        remote_type: job.remoteType,
        salary_min: job.salaryMin,
        salary_max: job.salaryMax,
        currency: job.currency,
        description: job.description,
        requirements: job.requirements,
        seniority: job.seniority,
        employment_type: job.employmentType,
        posted_at: job.postedAt,
        last_seen_at: now,
        status: 'discovered',
      },
      { onConflict: 'canonical_hash' },
    )
    .select('id')
    .single();

  if (listingErr) throw listingErr;

  // 2) upsert job_sources by (source_type, external_job_id)
  const { error: sourceErr } = await supabase.from('job_sources').upsert(
    {
      job_id: listing.id,
      source_type: job.source.sourceType,
      source_url: job.source.sourceUrl,
      external_job_id: job.source.externalJobId,
      raw_data: job.source.rawData ?? {},
      last_seen_at: now,
    },
    { onConflict: 'source_type,external_job_id' },
  );

  if (sourceErr) throw sourceErr;

  // Detect whether this was a new insert: compare created_at to the now we set.
  const { data: created, error: createdErr } = await supabase
    .from('job_listings')
    .select('created_at')
    .eq('id', listing.id)
    .single();
  if (createdErr) throw createdErr;

  const isNew = Math.abs(new Date(created.created_at).getTime() - Date.now()) < 5_000;
  return { listingId: listing.id, isNew };
}
