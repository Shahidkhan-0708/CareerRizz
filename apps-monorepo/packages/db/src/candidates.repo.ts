import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateProfileInsert } from '@jobsearch/shared-types';

/**
 * Candidate profile repo — create-or-update keyed on full_name (the only
 * natural key in the schema; candidate_profiles has no unique constraint on
 * anything else in the Phase 1 migration). Find-then-update/insert, never
 * upsert-on-conflict — same lesson as the outreach platform's profiles table
 * (decisions.md 2026-08-15).
 */
export async function upsertCandidateProfile(
  supabase: SupabaseClient,
  profile: CandidateProfileInsert,
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabase
    .from('candidate_profiles')
    .select('id')
    .eq('full_name', profile.full_name)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('candidate_profiles')
      .update({ ...profile, updated_at: new Date().toISOString() })
    .eq('id', existing.id);
    if (error) throw new Error(`Failed to update candidate profile: ${error.message}`);
    return { id: existing.id, created: false };
  }

  const { data: inserted, error } = await supabase
    .from('candidate_profiles')
    .insert(profile)
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create candidate profile: ${error.message}`);
  return { id: inserted!.id, created: true };
}
