import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Локальні worktree-ізоляції та SDD-скретч (не є частиною коду проєкту):
    ".claude/**",
    ".superpowers/**",
  ]),
  {
    rules: {
      // Явний any у продукційному коді заборонено: типізація замість касти.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Тести: моки свідомо не типізовані як прод — явний any дозволено.
  {
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
