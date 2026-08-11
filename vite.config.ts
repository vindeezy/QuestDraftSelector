// Imported from 'vitest/config', not 'vite' — that is what types the `test` block.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves this from /QuestDraftSelector/, not the domain root, so asset
  // URLs need that prefix. Only the CI build sets GITHUB_PAGES, so `npm run dev` and
  // local `npm run build` keep serving from / and stay unaffected.
  base: process.env.GITHUB_PAGES === 'true' ? '/QuestDraftSelector/' : '/',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tools/**/*.test.ts'],
    // Vitest defaults to 5 seconds, which suits unit tests. Many tests here run whole
    // simulations — twenty full battles is tens of thousands of physics ticks — and are
    // legitimately slower than that. Worse, how much slower depends on the machine: the
    // suite passed locally and then timed out on a CI runner. Annotating individual
    // tests turns that into whack-a-mole every time a slower machine appears, so the
    // default is raised globally instead. A genuinely hung test still fails, just later.
    testTimeout: 60000,
  },
});
