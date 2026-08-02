import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // ── Declared debt (2026-08-02) ──────────────────────────────────────
    // Held at 'warn' so CI gates on real defects rather than a wall of
    // pre-existing findings. Each is tracked, not dismissed:
    //
    // set-state-in-effect (16): every dashboard page hydrates from the API or
    //   from the DOM inside `useEffect` and then calls setState. React 19's
    //   new rule is right that this cascades a render, but the fix is to move
    //   each page onto a proper data-fetching pattern — a behavioural refactor
    //   of 14 routes that does not belong in a security change.
    //
    // static-components (2): components declared inside `dashboard/layout.tsx`
    //   remount on every parent render. Real, but same reasoning as above.
    //
    // no-explicit-any (20): API response shapes are read as `any`. The backend
    //   config already disables this rule; the durable fix is shared response
    //   types generated from the API, not a local suppression.
    //
    // Do not add new occurrences on the strength of this exemption.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
