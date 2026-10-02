import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/out/**", "**/coverage/**", "spikes/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scripts de Node sin bundler (doctor, scripts del entorno local)
    files: ["**/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  prettier,
);
