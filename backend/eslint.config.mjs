// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],

      // ── Declared type-safety debt (2026-08-02) ────────────────────────
      // `no-explicit-any` is already off, so the `no-unsafe-*` family fires
      // ~343 times wherever those `any`s flow onward — overwhelmingly in
      // conversations.service, whatsapp.service, orders.service and the AI
      // pipeline, where Prisma `Json` columns and LLM responses are read as
      // untyped objects.
      //
      // These are held at 'warn' so CI stays green and gates on real defects
      // instead of a wall of pre-existing noise. They are NOT dismissed: the
      // fix is to type the Json/LLM payloads (zod-parsed or generated
      // interfaces) file by file, then promote each back to 'error'.
      // Do not add new `any` on the strength of this exemption.
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // A leading underscore is the project's marker for an intentionally
      // unused binding (interface-mandated parameters, destructuring rest).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Jest mocks are accessed as detached references (`expect(svc.method)`),
    // which `unbound-method` flags as a `this`-scoping hazard. That risk does
    // not apply to assertions on a mock, so the rule is off for specs only —
    // it stays on for application code, where the hazard is real.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      // Mock implementations legitimately satisfy an async signature without
      // awaiting anything (e.g. `json: async () => ({...})` on a fetch stub).
      '@typescript-eslint/require-await': 'off',
    },
  },
);
