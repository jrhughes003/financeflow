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
        'src/main.jsx',
        '**/*.{test,spec}.*',
        '**/*.config.*',
        'electron/ai/mockServer.cjs', // a dev-only stand-in for the real API
      ],
      // Two gates, because the global one is a poor guard on its own.
      //
      // Statements sit far below branches and functions because 37 of 39
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
        statements: 45,
        branches: 78,
        functions: 78,
        lines: 45,
        'src/utils/**': { statements: 90, branches: 82, functions: 95, lines: 90 },
        // main.cjs and preload.cjs are the only untested files here and always
        // will be — they need a running Electron, so nothing in vitest can
        // execute them. ipc-contract.test.js reads them as text instead. The
        // modules that *can* run under Node are gated properly.
        'electron/ai/**': { statements: 85, branches: 70, functions: 90, lines: 85 },
        'electron/db/**': { statements: 85, branches: 75, functions: 85, lines: 85 },
      },
    },
  },
});
