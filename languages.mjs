// Which REPLs a build contains. REPL_LANGS=lua builds the Lua REPL only (no Pyodide, ~1 MB
// instead of ~15 MB), for a host that only needs one language.
export const ALL_LANGS = ["py", "lua", "js"];

export function buildLangs() {
  const raw = process.env.REPL_LANGS;
  if (!raw) return ALL_LANGS;
  const langs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = langs.filter((l) => !ALL_LANGS.includes(l));
  if (unknown.length || !langs.length) {
    throw new Error(`REPL_LANGS: expected a comma-separated subset of ${ALL_LANGS.join(",")}, got "${raw}"`);
  }
  return langs;
}
