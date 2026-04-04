import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'main.js', 'coverage/**', 'docs/**', '.git/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/plugin/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['src/sidecar/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'obsidian',
              message: 'Core must not depend on Obsidian (FND-1 / FND-2).',
            },
            {
              name: 'better-sqlite3',
              message: 'Core must not depend on better-sqlite3 (FND-1 / FND-2).',
            },
          ],
          patterns: [
            {
              group: ['obsidian/*'],
              message: 'Core must not depend on Obsidian (FND-1 / FND-2).',
            },
            {
              group: ['better-sqlite3/*'],
              message: 'Core must not depend on better-sqlite3 (FND-1 / FND-2).',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
