import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Style and safety rules.
 *
 * `no-floating-promises` reflects an architectural intent rather than a taste: it
 * prevents silent side effects, which are especially dangerous in the sync engine.
 */
export default tseslint.config(
  {
    // `.vercel/` and `dist/` hold build output, not source code.
    ignores: [
      "dist/**",
      ".vercel/**",
      "node_modules/**",
      "src-tauri/**",
      "migrations/**",
      "client/public/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
    },
  },

  {
    // Rules of hooks for the React client (including the React Compiler checks).
    files: ["client/src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      // Performance advice rather than a bug: the existing "reset a field when the
      // dialog opens / the value changes from outside" effects are flagged. Kept visible
      // as warnings until they are rewritten.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  {
    // Scripts are command-line tools: their console output is their interface, not a
    // forgotten debug trace.
    files: ["scripts/**/*.ts", "server/seed.ts", "server/shared/logging/logger.ts"],
    rules: { "no-console": "off" },
  },

  {
    files: ["**/*.test.ts", "**/__tests__/**/*.ts", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "no-console": "off" },
  },

  {
    files: ["client/public/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  }
);
