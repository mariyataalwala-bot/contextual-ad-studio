// Lint scope: the Open Web module and the tests (the existing studio files are left as they are).
import js from "@eslint/js";
import globals from "globals";

export default [
  { files: ["openweb/**/*.mjs", "test/**/*.mjs"], ...js.configs.recommended },
  {
    files: ["openweb/**/*.mjs", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }], "no-control-regex": "off" },
  },
  // placeInPage / tidyPage (and the test's page checks) run inside the browser page
  { files: ["openweb/lib/mock.mjs", "test/openweb/mock.test.mjs"], languageOptions: { globals: { ...globals.browser } } },
];
