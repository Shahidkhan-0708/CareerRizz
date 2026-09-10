import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentRunInsert } from '@jobsearch/shared-types';

export type AgentType = AgentRunInsert['agent_type'];

export interface AgentRunContext {
  id: string;
  startedAt: string;
}

/**
 * Wrap any agent execution so every run is recorded in agent_runs —
 * the agent code never has to remember to log (architecture doc §6).
 */
export async function wrapAgentRun<T>(
  supabase: SupabaseClient,
  run: AgentRunInsert,
  fn: (ctx: AgentRunContext) => Promise<T>,
): Promise<T> {
  const { data: inserted, error: insertErr } = await supabase
    .from('agent_runs')
    .insert({
      agent_type: run.agent_type,
      candidate_id: run.candidate_id ?? null,
      job_id: run.job_id ?? null,
      input: run.input ?? {},
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id, started_at')
    .single();

  if (insertErr) throw insertErr;

  const startedAt = Date.now();
  try {
    const result = await fn({ id: inserted.id, startedAt: inserted.started_at });
    await supabase
      .from('agent_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        output: {
          ...(run.output ?? {}),
          durationMs: Date.now() - startedAt,
        },
        tokens_used: run.tokens_used ?? null,
        cost_usd: run.cost_usd ?? null,
        jobs_processed: run.jobs_processed ?? null,
      })
      .eq('id', inserted.id);
    return result;
  } catch (err) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      })
      .eq('id', inserted.id);
    throw err;
  }
}
