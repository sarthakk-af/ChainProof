import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite Configuration for ChainProof Frontend
 * --------------------------------------------
 * - React plugin for JSX transform and fast HMR
 * - Alias `@` -> `src` for clean imports
 * - env vars starting with VITE_ are exposed to the client bundle
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: 5173,
    open: true, // Auto-open browser on dev start
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
