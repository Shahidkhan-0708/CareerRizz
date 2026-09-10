import { buildApp } from './app.js';
import { loadMonorepoEnv } from '@jobsearch/db';

loadMonorepoEnv();

// Uses PLATFORM_PORT (not PORT) — the generic PORT var is commonly set
// system-wide for other apps (e.g. the legacy Express backend on :5000).
const PORT = Number(process.env.PLATFORM_PORT ?? 5100);

async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`jobsearch-api listening on :${PORT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
