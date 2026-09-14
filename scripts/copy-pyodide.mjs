// Copy the Pyodide runtime next to the app, so Python works with no internet access.
// public/ is served as-is by Vite (dev) and copied into dist/ (build). Skipped, and any previous
// copy removed, when the build does not include Python (REPL_LANGS).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { buildLangs } from "../languages.mjs";

const FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
const src = new URL("../node_modules/pyodide/", import.meta.url);
const dest = new URL("../public/pyodide/", import.meta.url);

rmSync(dest, { recursive: true, force: true });
if (!buildLangs().includes("py")) {
  console.log("pyodide: skipped (REPL_LANGS has no py)");
} else {
  mkdirSync(dest, { recursive: true });
  for (const f of FILES) cpSync(new URL(f, src), new URL(f, dest));
  console.log(`pyodide: ${FILES.length} files -> public/pyodide/`);
}
