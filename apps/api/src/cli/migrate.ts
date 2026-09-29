/** pnpm db:migrate — applies migrations to DATA_DIR/app.db. */
import { loadEnvFiles, readConfig } from '../config';
import { openDb } from '../db/client';

loadEnvFiles();
const config = readConfig();
const db = openDb(config.dataDir);
db.$client.close();
console.log(`migrated ${config.dataDir}/app.db`);
