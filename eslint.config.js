import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Style and safety rules.
 *
 * `no-floating-promises` reflects an architectural intent rather than a taste: it
 * prevents silent side effects, which are especially dangerous in the sync engine.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src-tauri/**", "migrations/**", "client/public/**"] },

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
