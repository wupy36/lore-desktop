// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const SDK_PATTERNS = ["@lore-vcs/sdk", "@lore-vcs/sdk/*"];

export default tseslint.config(
  { ignores: ["out/**", "dist/**", "node_modules/**", "spike/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Lore SDK types must not leak outside the SDK adapter.
      "no-restricted-imports": ["error", { patterns: [{ group: SDK_PATTERNS, message: "Only src/main/lore/SdkBackend.ts and mappers.ts may import the Lore SDK." }] }],
    },
  },
  {
    files: ["src/main/lore/SdkBackend.ts", "src/main/lore/mappers.ts", "tests/main/mappers.test.ts", "tests/integration/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["tests/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["scripts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
