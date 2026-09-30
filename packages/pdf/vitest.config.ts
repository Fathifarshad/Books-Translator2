import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'pdf',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
