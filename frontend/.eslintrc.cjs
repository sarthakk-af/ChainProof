/**
 * ESLint configuration for the frontend.
 *
 * Deliberately small: the rules that catch real mistakes (unused imports and
 * variables, broken hook usage, JSX referencing something undefined) rather
 * than a style guide. Formatting is left to the editor.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: "detect" } },
  plugins: ["react", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
  ],
  rules: {
    // Props are documented in JSDoc where it matters; PropTypes would be noise.
    "react/prop-types": "off",
    "react/no-unescaped-entities": "off",
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    // A leading underscore marks an intentionally unused argument. `React` is
    // imported by convention in every component even though the JSX runtime no
    // longer needs it, so it is not reported as unused.
    "no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^(_|React$)", caughtErrors: "none" },
    ],
  },
  overrides: [
    {
      // A context or navigation module exports hooks and helpers beside its
      // component, which is the conventional shape and costs nothing but fast-refresh granularity.
      files: ["src/context/*.jsx", "src/utils/*.jsx", "src/components/shared/Tabs.jsx"],
      rules: { "react-refresh/only-export-components": "off" },
    },
  ],
  ignorePatterns: ["dist/", "src/contracts/"],
};
