module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-explicit-any": "error"
  },
  overrides: [
    {
      files: ["src/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "better-sqlite3",
                message:
                  "Native addon; Obsidian bundle is WASM-only. Use scripts/ or the wa-SQLite path (ADR-001)."
              },
              {
                name: "sqlite-vec",
                message:
                  "Node optional native package is for scripts/ only. Do not import from src/ (ADR-001)."
              }
            ]
          }
        ]
      }
    }
  ]
};
