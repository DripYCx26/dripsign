// One lint configuration for the workspace. Product TypeScript gets the strict and stylistic
// type-aware sets through each package's tsconfig; plain JavaScript (tools, this file) and the
// root configs get the untyped set. React hooks rules cover apps/web. Prettier owns formatting,
// so its config comes last.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const TYPED = ["packages/core/**/*.ts", "apps/web/**/*.{ts,tsx}"];
const WEB = ["apps/web/**/*.{ts,tsx}"];
const PRODUCT = ["packages/core/src/**/*.ts", "apps/web/src/**/*.{ts,tsx}"];
const TESTS = ["**/*.test.{ts,tsx}", "e2e/**"];

export default defineConfig(
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.base,
  {
    files: TYPED,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.mjs", "vitest.config.ts", "playwright.config.ts", "e2e/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  { files: WEB, extends: [reactHooks.configs.flat.recommended] },
  {
    files: PRODUCT,
    ignores: TESTS,
    rules: {
      "max-lines": ["error", 400],
      "max-lines-per-function": ["error", 80],
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
    },
  },
  prettier,
);
