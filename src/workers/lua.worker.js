// Lua REPL on wasmoon (the reference Lua interpreter, compiled to WebAssembly).
import { LuaFactory } from "wasmoon";
import glueUrl from "wasmoon/dist/glue.wasm?url";

let lua = null;
const post = (msg) => self.postMessage(msg);

// Same rules as the standalone `lua` interpreter: try the entry as an expression first, then as
// a statement; an error ending in <eof> means the entry is not finished yet.
const REPL = String.raw`
local __out = __out
local function join(...)
  local t = table.pack(...)
  for i = 1, t.n do t[i] = tostring(t[i]) end
  return table.concat(t, "\t")
end
print = function(...) __out(join(...) .. "\n", "stdout") end
io.write = function(...)
  local t = table.pack(...)
  for i = 1, t.n do t[i] = tostring(t[i]) end
  __out(table.concat(t), "stdout")
end

function __check(src)
  if load("return " .. src, "=stdin") or load(src, "=stdin") then return "complete" end
  local _, err = load(src, "=stdin")
  if err and err:sub(-5) == "<eof>" then return "incomplete" end
  return "complete"
end

function __run(src)
  local f = load("return " .. src, "=stdin")
  if not f then
    local err
    f, err = load(src, "=stdin")
    if not f then __out(err .. "\n", "error") return end
  end
  local r = table.pack(pcall(f))
  if not r[1] then __out(tostring(r[2]) .. "\n", "error") return end
  if r.n > 1 then __out(join(table.unpack(r, 2, r.n)) .. "\n", "result") end
end
`;

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      lua = await new LuaFactory(glueUrl).createEngine();
      lua.global.set("__out", (text, stream) => post({ type: "out", stream, text }));
      await lua.doString(REPL);
      post({ type: "ready", banner: `${lua.global.get("_VERSION")} (wasmoon)` });
    } catch (err) {
      post({ type: "fatal", text: String(err) });
    }
  } else if (data.type === "check") {
    post({ type: "checked", id: data.id, status: lua.global.get("__check")(data.code) });
  } else if (data.type === "run") {
    try {
      lua.global.get("__run")(data.code);
    } catch (err) {
      post({ type: "out", stream: "error", text: String(err) + "\n" });
    }
    post({ type: "done", id: data.id });
  }
};
