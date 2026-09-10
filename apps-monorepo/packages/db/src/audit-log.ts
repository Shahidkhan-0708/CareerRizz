import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEntry {
  actor: string; // 'system' | agent_type | user_id
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append to audit_log (architecture doc §13: accountability for every
 * autonomous action). Fire-and-forget safe: never throws to the caller.
 */
export async function writeAudit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      actor: entry.actor,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    // Audit must not break the pipeline; log-and-continue.
    console.error('[audit_log] failed to write entry:', err instanceof Error ? err.message : err);
  }
}
