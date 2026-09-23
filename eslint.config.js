// Flat config. The blocks exist because this repo runs four different
// environments out of one tree — browser renderer, CommonJS Electron main,
// ESM Node scripts, and a web worker — and each has a different set of globals
// and a different set of mistakes worth catching.

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'docs/**', 'coverage/**'] },

  // --- Renderer: browser globals, React rules.
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['src/workers/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Without these, every component referenced only as <Foo /> reads as an
      // unused import, because core no-unused-vars does not parse JSX.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Core no-undef does not look at JSX element names, so a component used
      // but never imported renders fine to the linter and throws at runtime.
      // The Recurring page shipped in exactly that state.
      'react/jsx-no-undef': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // JSX counts as a use; without this every component import reads as dead.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        // `const { scenarios, ...rest } = plan` drops a field on purpose.
        ignoreRestSiblings: true,
      }],
    },
  },

  // --- Context and hook modules export a provider alongside its hook, which is
  //     the standard React pattern; the rule only guards HMR granularity.
  {
    files: ['src/context/**/*.{jsx,tsx}', 'src/components/lifeplan/LifePlanPage.{jsx,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // --- The worker has no DOM and no window.
  {
    files: ['src/workers/**/*.{js,ts}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.worker },
    rules: js.configs.recommended.rules,
  },

  // --- Electron main process: CommonJS, Node globals, and no DOM. The last
  //     part is the point — `window` here is always a mistake, and the main
  //     process is where a mistake reaches the filesystem and the API key.
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
    },
  },

  // --- Node-side ESM: the eval harness and build scripts.
  {
    files: ['eval/**/*.mjs', 'scripts/**/*.cjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: js.configs.recommended.rules,
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },

  // --- Tests: vitest globals, and room to build deliberately wrong inputs.
  {
    files: ['**/*.{test,spec}.{js,jsx,ts,tsx,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // --- TypeScript, for the migration ahead. Not type-aware yet: that needs a
  //     project service and turns a 3-second lint into a 40-second one, and it
  //     fires no-unsafe-* on every remaining .js boundary.
  ...tseslint.configs.recommended.map(c => ({ ...c, files: ['src/**/*.{ts,tsx}'] })),

  // The TS rule replaces the core one, so it needs the same allowances: the
  // codebase drops fields with rest destructuring, and JSX counts as a use.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
]
