import { defineConfig } from "vite";
import { resolve } from "node:path";
import { ALL_LANGS, buildLangs } from "./languages.mjs";

const LANGS = buildLangs();

// Relative base by default: the same dist works on GitHub Pages, under a platform prefix such as
// /runtime/repl/<version>/, or copied into another app's public folder. VITE_BASE overrides it
// when a host wants absolute URLs.
export default defineConfig({
  base: process.env.VITE_BASE || "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: Object.fromEntries([
        ["index", resolve(import.meta.dirname, "index.html")],
        ...LANGS.map((l) => [l, resolve(import.meta.dirname, `${l}/index.html`)]),
      ]),
    },
  },
  // Classic workers: the JavaScript REPL needs importScripts() so that top-level `let` and
  // `const` survive from one entry to the next, like in a real console.
  worker: { format: "iife" },
  plugins: [
    {
      name: "repl-langs",
      // The home page only links to the REPLs this build contains.
      transformIndexHtml(html, ctx) {
        if (!ctx.filename.endsWith(`${resolve(import.meta.dirname, "index.html")}`)) return html;
        return ALL_LANGS.filter((l) => !LANGS.includes(l))
          .reduce((h, l) => h.replace(new RegExp(`\\s*<a data-lang="${l}"[^]*?</a>`), ""), html);
      },
    },
  ],
});
