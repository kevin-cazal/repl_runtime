// JavaScript REPL. Each entry runs as a classic script through importScripts(), so top-level
// `let`, `const`, `function` and `class` declarations stay available to the next entry.
import { parse, parseExpressionAt } from "acorn";

const post = (msg) => self.postMessage(msg);

function show(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
  if (typeof value === "function") return `[Function ${value.name || "(anonyme)"}]`;
  if (typeof value === "bigint") return `${value}n`;
  if (value === null || typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth > 3) return Array.isArray(value) ? "[Array]" : "[Object]";
  seen.add(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) return `[ ${value.map((v) => show(v, depth + 1, seen)).join(", ")} ]`;
  if (value instanceof Map) return `Map(${value.size}) { ${[...value].map(([k, v]) => `${show(k, depth + 1, seen)} => ${show(v, depth + 1, seen)}`).join(", ")} }`;
  if (value instanceof Set) return `Set(${value.size}) { ${[...value].map((v) => show(v, depth + 1, seen)).join(", ")} }`;
  const entries = Object.entries(value).map(([k, v]) => `${k}: ${show(v, depth + 1, seen)}`);
  const name = value.constructor && value.constructor !== Object ? value.constructor.name + " " : "";
  return entries.length ? `${name}{ ${entries.join(", ")} }` : `${name}{}`;
}
const result = (value) => (typeof value === "string" ? JSON.stringify(value) : show(value, 1));

const log = (stream) => (...args) => post({ type: "out", stream, text: args.map((a) => show(a)).join(" ") + "\n" });
console.log = console.info = console.debug = log("stdout");
console.warn = console.error = log("error");

// Parse with acorn, like Node's own REPL: an error at the very end of the entry means it is not
// finished yet, and the syntax tree tells a declaration from an expression whose value we show.
const PARSE = { ecmaVersion: "latest", sourceType: "script" };

function check(code) {
  try {
    parse(code, PARSE);
    return "complete";
  } catch (err) {
    return err.pos >= code.trimEnd().length || /Unterminated template/.test(err.message) ? "incomplete" : "complete";
  }
}

// Split an entry into [statements, lastExpression]: the value of the last expression is shown.
function split(code) {
  let program;
  try { program = parse(code, PARSE); } catch { return [code, null]; }
  const body = program.body;
  const last = body[body.length - 1];
  if (body.length === 1 && last.type === "BlockStatement") {
    try { parseExpressionAt(`(${code})`, 0, PARSE); return ["", code]; } catch { return [code, null]; }   // {a: 1}
  }
  if (!last || last.type !== "ExpressionStatement") return [code, null];
  const expr = code.slice(last.expression.start, last.expression.end);
  return [code.slice(0, last.start), expr];
}

function runScript(source) {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try { importScripts(url); } finally { URL.revokeObjectURL(url); }
}

self.onmessage = ({ data }) => {
  if (data.type === "init") {
    post({ type: "ready", banner: "JavaScript" });
  } else if (data.type === "check") {
    post({ type: "checked", id: data.id, status: check(data.code) });
  } else if (data.type === "run") {
    try {
      const [statements, expr] = split(data.code);
      if (statements.trim()) runScript(statements);
      if (expr !== null) {
        runScript(`self.__replResult = (${expr}\n);`);
        const value = self.__replResult;
        delete self.__replResult;
        if (value !== undefined) post({ type: "out", stream: "result", text: result(value) + "\n" });
      }
    } catch (err) {
      const text = err instanceof Error ? `${err.name}: ${err.message}` : `Uncaught ${show(err)}`;
      post({ type: "out", stream: "error", text: text + "\n" });
    }
    post({ type: "done", id: data.id });
  }
};
