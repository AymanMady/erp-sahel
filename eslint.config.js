import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Règles de style et de sûreté.
 *
 * `no-floating-promises` porte une intention d'architecture plutôt qu'un goût : il évite
 * les effets de bord silencieux, particulièrement dangereux dans le moteur de
 * synchronisation.
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
    // Les scripts sont des outils en ligne de commande : leur sortie console est
    // leur interface, pas une trace de débogage oubliée.
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
