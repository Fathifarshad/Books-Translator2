import { rmSync } from 'node:fs';
import { buildApp } from './app';
import { loadEnvFiles, readConfig } from './config';

loadEnvFiles();
const config = readConfig();
// End-to-end runs start from an empty data folder (never set this for your real library).
if (process.env.E2E_RESET === '1') rmSync(config.dataDir, { recursive: true, force: true });
const app = await buildApp(config);

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
