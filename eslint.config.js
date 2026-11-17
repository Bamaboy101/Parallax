import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist', '**/coverage', '**/.wrangler', '**/node_modules'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // Convention: feeds/ never uses `any`.
    files: ['apps/web/src/feeds/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
    },
  },
  {
    // Convention: a widget never opens a socket or calls a provider; it reads the store.
    files: ['apps/web/src/widgets/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'WebSocket', message: 'Widgets read from the store only.' },
        { name: 'EventSource', message: 'Widgets read from the store only.' },
        { name: 'fetch', message: 'Widgets read from the store only.' },
        { name: 'XMLHttpRequest', message: 'Widgets read from the store only.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/feeds/adapters/**', '**/feeds/hub.worker*', '**/feeds/router*'],
              message: 'Widgets read from the store only.',
            },
          ],
        },
      ],
    },
  },
  {
    // Hard rule (F4): live trading must be impossible in the code. Alpaca's live trading host
    // can never appear in source; paper-api.alpaca.markets and the data hosts do not match.
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/(^|[^-a-z])api\\.alpaca\\.markets/]',
          message: 'Live trading is not allowed: use the paper client (store/paper/client.ts).',
        },
        {
          selector: 'TemplateElement[value.raw=/(^|[^-a-z])api\\.alpaca\\.markets/]',
          message: 'Live trading is not allowed: use the paper client (store/paper/client.ts).',
        },
      ],
    },
  },
  prettier,
);
