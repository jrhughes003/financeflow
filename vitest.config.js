import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Kept wide enough to survive the TypeScript migration: a test renamed to
    // .ts that no longer matches would simply stop running, and CI would stay
    // green while the coverage quietly disappeared.
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}', 'electron/**/*.{test,spec}.{js,cjs,ts,cts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**', 'electron/**'],
      exclude: [
        'src/test/**',
        'src/main.tsx',
        '**/*.{test,spec}.*',
        '**/*.config.*',
        'electron/ai/mockServer.cjs', // a dev-only stand-in for the real API
      ],
      // Two gates, because the global one is a poor guard on its own.
      //
      // Statements sit far below branches and functions because 34 of 40
      // components have no test while the pure logic they render is covered
      // thoroughly. That gap is the honest reading of the global number.
      //
      // It also moves for reasons that are not quality. Converting src/utils
      // to TypeScript dropped the global figure from 50.6% to 46.5% without a
      // single test changing: type annotations are not executable, so ~900
      // *covered* statements left the pool and the untested components became
      // a larger share of what remained. Expect it to drift back up as the
      // components convert, for the same non-reason.
      //
      // So the floor tracks reality, and the directory that carries the money
      // logic is held to a bar that means something.
      thresholds: {
        statements: 50,
        branches: 81,
        functions: 80,
        lines: 50,
        'src/utils/**': { statements: 90, branches: 82, functions: 95, lines: 90 },
        // The runtime-backend switch the README leads with. It is 72 lines and
        // every one of them runs, so there is no excuse for it to slip.
        'src/storage/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
        // main.cjs and preload.cjs are the only untested files here and always
        // will be — they need a running Electron, so nothing in vitest can
        // execute them. ipc-contract.test.js reads them as text instead. The
        // modules that *can* run under Node are gated properly.
        'electron/ai/**': { statements: 85, branches: 70, functions: 90, lines: 85 },
        // index.cjs holds this down: it opens the database at Electron's
        // userData path, so it cannot run under vitest for the same reason
        // main.cjs cannot. Everything else in here is at 100%.
        'electron/db/**': { statements: 88, branches: 80, functions: 85, lines: 88 },
      },
    },
  },
});
