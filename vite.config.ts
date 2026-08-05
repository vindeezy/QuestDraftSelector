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
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
