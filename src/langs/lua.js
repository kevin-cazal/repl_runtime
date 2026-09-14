// Written literally: Vite only bundles a worker created as `new Worker(new URL(...))`.
export default {
  id: "lua", name: "Lua", prompt: ">", more: ">>", indent: "  ",
  opensBlock: (line) => /\b(do|then|else|function\b.*\)|repeat)\s*(--.*)?$/.test(line) || /\{\s*$/.test(line),
  worker: () => new Worker(new URL("../workers/lua.worker.js", import.meta.url)),
};
