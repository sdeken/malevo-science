import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['scripts/**/*.mjs'],
    // page.evaluate() callbacks in the smoke test run in the renderer, where window exists.
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', Buffer: 'readonly', window: 'readonly', document: 'readonly' }
    }
  },
  {
    // The stability contract (docs/PLAN.md §3.2): the model and every
    // generator draw randomness only from keyed, seeded streams.
    files: ['packages/core/**', 'packages/model/**', 'packages/gen/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use a keyed stream from @malevo/core rng; world data must be reproducible.' },
        { property: 'localeCompare', message: 'Locale-dependent order. Use compareStrings from @malevo/core.' }
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'No wall-clock time in world data.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'No wall-clock time in world data.' }
      ]
    }
  }
)
