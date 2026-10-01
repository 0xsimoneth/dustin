import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/", "node_modules/", "test-results/", "playwright-report/"]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The page runs in a browser: no Node global; and no HTML parsed from data, since what Horizon
    // answers (asset codes, data entry names) is untrusted text and is rendered as text.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Buffer", message: "The page runs in a browser, which has no Buffer." },
        { name: "process", message: "The page runs in a browser, which has no process." },
      ],
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Build nodes with h(); never parse HTML from data." },
        { property: "outerHTML", message: "Build nodes with h(); never parse HTML from data." },
        {
          property: "insertAdjacentHTML",
          message: "Build nodes with h(); never parse HTML from data.",
        },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
]);
