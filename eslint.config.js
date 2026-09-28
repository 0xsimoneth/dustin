import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist/",
    "coverage/",
    "node_modules/",
    "scripts/spike/",
    "stellar-build/",
    ".stellar-build/",
    // Git worktrees of parallel agents hold whole copies of the repository.
    ".claude/worktrees/",
  ]),
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
    // The read-only zone: planning and inspection can never reach signing or submission
    // (docs/architecture.md section 6.3; PRD FR-07).
    files: ["src/plan/**/*.ts", "src/inspect/**/*.ts", "src/reader/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@stellar/stellar-sdk",
              importNames: [
                "Keypair",
                "TransactionBuilder",
                "Horizon",
                "Operation",
                "FeeBumpTransaction",
                "Transaction",
              ],
              message: "The read-only zone must not sign, build or submit transactions.",
            },
          ],
          patterns: [
            {
              group: ["**/sponsor/**", "**/fixture/**", "**/tx/**", "**/execute/**", "**/cli/**"],
              message: "The read-only zone must not import write-zone modules.",
            },
          ],
        },
      ],
    },
  },
  {
    // Plain JavaScript files (this config, scripts) are not part of the TypeScript project.
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
]);
