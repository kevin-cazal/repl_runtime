// Lua REPL: Lua 5.3.6 compiled to WebAssembly, the same version, compile flags and standard
// libraries as TIC-80 (see lua53/). The REPL rules live in lua53/repl.c.
import createLua53 from "../../vendor/lua53/lua53.js";

const STREAMS = ["stdout", "result", "error"];
const decoder = new TextDecoder();
const post = (msg) => self.postMessage(msg);
let lua = null;

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const module = await createLua53({
        onWrite: (bytes, stream) => post({ type: "out", stream: STREAMS[stream], text: decoder.decode(bytes) }),
      });
      lua = {
        check: module.cwrap("repl_check", "number", ["string"]),
        run: module.cwrap("repl_run", null, ["string"]),
        version: module.cwrap("repl_version", "string", []),
      };
      if (!module.cwrap("repl_init", "number", [])()) throw new Error("luaL_newstate failed");
      post({ type: "ready", banner: lua.version() });
    } catch (err) {
      post({ type: "fatal", text: String(err) });
    }
  } else if (data.type === "check") {
    post({ type: "checked", id: data.id, status: lua.check(data.code) ? "complete" : "incomplete" });
  } else if (data.type === "run") {
    try {
      lua.run(data.code);
    } catch (err) {
      post({ type: "out", stream: "error", text: String(err) + "\n" });
    }
    post({ type: "done", id: data.id });
  }
};
