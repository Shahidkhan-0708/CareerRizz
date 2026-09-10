import { createGreenhouseSource } from './greenhouse.js';
import { createLeverSource } from './lever.js';
import { createAshbySource } from './ashby.js';
import { createAdzunaSource } from './adzuna.js';
import type { JobSource } from './source.interface.js';

export interface SourceRegistryEntry {
  source: JobSource;
  /** Enabled flag from source_configs table (or env bootstrap). */
  enabled: boolean;
}

/**
 * Registry of configured sources. Board configs come from env:
 *   JOB_SOURCES_GREENHOUSE="stripe:Stripe,vercel:Vercel"
 *   JOB_SOURCES_LEVER="netflix:Netflix"
 *   JOB_SOURCES_ASHBY="ramp:Ramp"
 * Format: "token:Company,token2:Company2" (comma-separated).
 */
export function parseBoardSpec(spec: string | undefined): Array<{ token: string; company: string }> {
  if (!spec) return [];
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [token, company] = pair.split(':');
      return { token: token.trim(), company: (company ?? token).trim() };
    });
}

export function buildSourcesFromEnv(env: NodeJS.ProcessEnv = process.env): JobSource[] {
  const sources: JobSource[] = [];

  for (const { token, company } of parseBoardSpec(env.JOB_SOURCES_GREENHOUSE)) {
    sources.push(createGreenhouseSource({ boardToken: token, company }));
  }
  for (const viaSpec of parseBoardSpec(env.JOB_SOURCES_LEVER)) {
    sources.push(createLeverSource({ companySlug: viaSpec.token, company: viaSpec.company }));
  }
  for (const { token, company } of parseBoardSpec(env.JOB_SOURCES_ASHBY)) {
    sources.push(createAshbySource({ boardHandle: token, company }));
  }
  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) {
    sources.push(
      createAdzunaSource({ appId: env.ADZUNA_APP_ID, appKey: env.ADZUNA_APP_KEY, country: env.ADZUNA_COUNTRY ?? 'us' }),
    );
  }
  return sources;
}
