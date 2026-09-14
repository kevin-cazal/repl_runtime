// Written literally: Vite only bundles a worker created as `new Worker(new URL(...))`.
export default {
  id: "py", name: "Python", prompt: ">>> ", indent: "    ",
  opensBlock: (line) => /:\s*(#.*)?$/.test(line),
  worker: () => new Worker(new URL("../workers/python.worker.js", import.meta.url), { type: "module" }),
  checker: async () => isComplete,
};

// Is a Python entry finished? Pyodide lives in the worker and the terminal needs the answer
// synchronously, so this follows the rules of the interactive interpreter directly:
// - an open bracket, an open triple-quoted string or a trailing backslash continues the entry;
// - a line ending with `:` (or a decorator) opens a block, which ends with an empty line;
// - anything else is complete, including syntax errors, which the interpreter then reports.
export function isComplete(code) {
  const lines = code.split("\n");
  let depth = 0, quote = null, block = false;
  for (const [n, line] of lines.entries()) {
    let last = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === "\\") { i++; continue; }
        if (quote.length === 3 ? line.startsWith(quote, i) : c === quote) {
          i += quote.length - 1;
          quote = null;
        }
        continue;
      }
      if (c === "#") break;
      if (c === '"' || c === "'") {
        quote = line.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
        i += quote.length - 1;
        last = c;
      } else if ("([{".includes(c)) {
        depth++;
      } else if (")]}".includes(c)) {
        depth = Math.max(0, depth - 1);
      }
      if (c.trim()) last = c;
    }
    if (quote && quote.length === 1) quote = null;   // unterminated string: an error to report
    if (!quote && depth === 0 && (last === ":" || (n === 0 && line.trimStart().startsWith("@")))) block = true;
  }
  if (quote || depth > 0 || /\\\s*$/.test(code)) return false;
  if (block) return lines.length > 1 && lines[lines.length - 1].trim() === "";
  return true;
}
