import { defineConfig } from "vite";
import { resolve } from "node:path";

// Relative base by default: the same dist works on GitHub Pages, under a platform prefix such as
// /runtime/repl/<version>/, or opened from any folder. VITE_BASE overrides it when a host wants
// absolute URLs.
export default defineConfig({
  base: process.env.VITE_BASE || "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        py: resolve(import.meta.dirname, "py/index.html"),
        lua: resolve(import.meta.dirname, "lua/index.html"),
        js: resolve(import.meta.dirname, "js/index.html"),
      },
    },
  },
  // Classic workers: the JavaScript REPL needs importScripts() so that top-level `let` and
  // `const` survive from one entry to the next, like in a real console.
  worker: { format: "iife" },
});
