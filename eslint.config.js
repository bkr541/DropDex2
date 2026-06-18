// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import hooksPlugin from 'eslint-plugin-react-hooks';
import refreshPlugin from 'eslint-plugin-react-refresh';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Ignore compiled output, dependency dirs, and generated files
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'backend/**',
      'importer/**',
      'e2e/**',
    ],
  },

  // TypeScript source
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': hooksPlugin,
      'react-refresh': refreshPlugin,
    },
    rules: {
      // TypeScript — recommended rules minus ones superseded by TS
      ...tsPlugin.configs['eslint-recommended'].overrides?.[0].rules,
      ...tsPlugin.configs.recommended.rules,

      // Relax a few rules that cause noise in this codebase
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // React Hooks — catches stale-closure and missing-dep bugs
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React Refresh — prevents accidental non-component exports that break HMR
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // Prefer const — catches a common class of stale-ref bugs
      'prefer-const': 'error',

      // No unused expressions (catches accidental `foo` statements)
      'no-unused-expressions': 'error',
    },
  },

  // Non-tsx JS config/scripts at the root (vite.config.ts, playwright.config.ts, etc.)
  {
    files: ['*.{js,cjs,mjs}', '*.config.{ts,js}', 'playwright.config.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
    },
  },
];
