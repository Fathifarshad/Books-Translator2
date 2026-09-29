// Worker entry when running from TypeScript sources (dev server, tests): register tsx in this thread,
// then load the real worker. Production bundles start `worker.js` directly.
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
