import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';

/**
 * Load env for monorepo apps. `dotenv/config` resolves .env relative to the
 * CWD, which for `pnpm --filter ... start` is the app directory (apps/api,
 * apps/workers) — not the monorepo root where the real .env lives.
 *
 * This walks up from the CWD to the filesystem root and loads every .env
 * found (deepest first). With `override: false`, values already in
 * process.env win, and the first file that sets a key wins after that —
 * so app-local .env can still override the monorepo root.
 *
 * Also walks up from this package's own location as a fallback, so the
 * monorepo root .env is found even if the CWD is unusual.
 *
 * Shared by api + workers via @jobsearch/db. Errors are swallowed:
 * env loading is best-effort and real config problems surface at use-time.
 */
export function loadMonorepoEnv(startDir: string = process.cwd()): void {
  const candidates: string[] = [];

  // From the CWD up to the filesystem root
  let dir = path.resolve(startDir);
  const fsRoot = path.parse(dir).root;
  while (true) {
    candidates.push(dir);
    if (dir === fsRoot) break;
    dir = path.dirname(dir);
  }

  // From this package's location up (guarantees the monorepo root is covered)
  const here = path.dirname(fileURLToPath(import.meta.url)); // packages/db/src
  let pkgDir = here;
  const pkgRoot = path.parse(pkgDir).root;
  while (true) {
    candidates.push(pkgDir);
    if (pkgDir === pkgRoot) break;
    pkgDir = path.dirname(pkgDir);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const envPath = path.join(candidate, '.env');
    if (existsSync(envPath)) {
      loadEnvFile({ path: envPath, override: false });
    }
  }
}
