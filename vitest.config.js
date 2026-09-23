import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
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
      // Set just under the current numbers so they ratchet up rather than
      // block work. Raise them when a phase of testing lands, not before.
      //
      // Statements sit far below branches and functions because 37 of 39
      // components have no test while the pure logic they render is covered
      // thoroughly. That gap is the honest reading of this number.
      thresholds: { statements: 48, branches: 78, functions: 78, lines: 48 },
    },
  },
});
