// Parse with acorn, like Node's own REPL: an error at the very end of the entry means it is not
// finished yet, and the syntax tree tells a declaration from an expression whose value we show.
// Shared by the page (is the entry finished?) and the worker (what to show).
import { parse, parseExpressionAt } from "acorn";

const OPTIONS = { ecmaVersion: "latest", sourceType: "script" };

export function isComplete(code) {
  try {
    parse(code, OPTIONS);
    return true;
  } catch (err) {
    return !(err.pos >= code.trimEnd().length || /Unterminated template/.test(err.message));
  }
}

// Split an entry into [statements, lastExpression]: the value of the last expression is shown.
export function split(code) {
  let program;
  try { program = parse(code, OPTIONS); } catch { return [code, null]; }
  const body = program.body;
  const last = body[body.length - 1];
  if (body.length === 1 && last.type === "BlockStatement") {
    try { parseExpressionAt(`(${code})`, 0, OPTIONS); return ["", code]; } catch { return [code, null]; }   // {a: 1}
  }
  if (!last || last.type !== "ExpressionStatement") return [code, null];
  return [code.slice(0, last.start), code.slice(last.expression.start, last.expression.end)];
}
