/**
 * ESLint configuration.
 *
 * `package.json` has carried `"lint": "eslint . --ext ts,tsx --max-warnings 0"`
 * and the full plugin set in devDependencies since the project was created, but
 * no config file was ever committed — so the command has always exited with
 * "couldn't find a configuration file" rather than linting anything. A gate
 * that cannot fail is not a gate, and a redesign that touches ~50 files is
 * exactly when you want it to be real.
 *
 * The rule set is deliberately close to the Vite React-TS template the project
 * was scaffolded from, with a small number of deviations noted inline. It is
 * type-unaware (no `project` in parserOptions) so a lint run stays fast enough
 * to be part of the normal loop; `tsc --noEmit` already carries type checking.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-refresh'],
  ignorePatterns: [
    'dist', 'node_modules', 'coverage',
    '.eslintrc.cjs', 'postcss.config.js', 'tailwind.config.js',
    // Local visual-review harnesses, not shipped code.
    'shots.mjs', 'probe.mjs',
  ],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

    // The codebase leans on `any` at exactly the boundaries where it is honest:
    // Daily/Tavus app-message payloads whose shape varies by vendor event, and
    // Recharts render props. Flagging those as errors would produce a wave of
    // casts that document nothing. Warned, not silenced.
    '@typescript-eslint/no-explicit-any': 'warn',

    // Unused vars are an error, because they are usually the residue of a
    // half-finished edit. The underscore prefix is the escape hatch for
    // deliberately-ignored positional args and destructured rest siblings.
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
    }],
    'no-unused-vars': 'off',

    // Empty catch blocks are a real pattern here and every one of them carries a
    // comment saying why the failure is survivable (best-effort transcripts,
    // localStorage in private mode). Allow the block, keep the rule for the rest.
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
}
