import createLua53 from "../../vendor/lua53/lua53.js";

// Written literally: Vite only bundles a worker created as `new Worker(new URL(...))`.
export default {
  id: "lua", name: "Lua", prompt: "> ", indent: "  ",
  opensBlock: (line) => /\b(do|then|else|function\b.*\)|repeat)\s*(--.*)?$/.test(line) || /\{\s*$/.test(line),
  worker: () => new Worker(new URL("../workers/lua.worker.js", import.meta.url)),
  // The same Lua as the worker, in the page, used only to compile: `load` runs nothing. It answers
  // "is this entry finished?" exactly as the interpreter would, and synchronously, which is what
  // the terminal needs when Enter is pressed.
  checker: async () => {
    const lua = await createLua53({ onWrite: () => {} });
    if (!lua.cwrap("repl_init", "number", [])()) throw new Error("luaL_newstate failed");
    const check = lua.cwrap("repl_check", "number", ["string"]);
    return (code) => check(code) === 1;
  },
};
