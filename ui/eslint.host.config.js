// ESLint for the ComfyUI extension code in ../web/js (browser ES modules loaded by
// app.registerExtension). Separate from eslint.config.js, which covers the React
// iframe sources in ui/. Run from the repo root (files outside the working
// directory are ignored by ESLint), as .githooks/pre-push does:
//   node ui/node_modules/eslint/bin/eslint.js -c ui/eslint.host.config.js web/js
import js from '@eslint/js'
import globals from 'globals'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  {
    files: ['web/js/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
    },
  },
])
