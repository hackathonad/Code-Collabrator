import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "client/vite.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["server/src/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-explicit-any": "off", "no-control-regex": "off" }
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // These compiler-oriented checks are valuable during a dedicated React
      // compiler migration, but they flag existing, intentional effects and
      // memoization patterns outside this launch-hardening scope.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
);
