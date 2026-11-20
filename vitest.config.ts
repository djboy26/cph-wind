import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    // 20 s, not Vitest's 5 s: on DJ's laptop under load (2026-11-20) jsdom took 459 s of
    // start-up across the workers and five tests that read the real data timed out at
    // 5 s. All 199 passed with a longer limit. A hung test still fails, just later.
    testTimeout: 20_000,
  },
});
