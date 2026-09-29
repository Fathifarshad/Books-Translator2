import { startFakeProvider } from '../testing/fake-provider';

/** Starts the fake OpenAI-compatible provider for e2e tests (`pnpm --filter @dozabaneh/api fake-provider`). */
const port = Number(process.env.FAKE_PROVIDER_PORT ?? 8798);
const fake = await startFakeProvider(port);
process.stdout.write(`fake provider on ${fake.url}\n`);
