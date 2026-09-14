// Python REPL on Pyodide, in a module worker (Pyodide refuses classic workers).
// The REPL logic itself is written in Python, below.
let py = null;

const REPL = String.raw`
import ast, codeop, sys, traceback

_globals = {"__name__": "__main__"}

def _check(src):
    try:
        return "incomplete" if codeop.compile_command(src, "<stdin>", "single") is None else "complete"
    except (SyntaxError, OverflowError, ValueError):
        return "complete"          # let _run report the error

def _print_exc():
    kind, value, tb = sys.exc_info()
    while tb is not None and tb.tb_frame.f_code.co_filename != "<stdin>":
        tb = tb.tb_next            # hide the REPL's own frames
    sys.stderr.write("".join(traceback.format_exception(kind, value, tb)))

def _run(src, result):
    try:
        tree = ast.parse(src, "<stdin>", "exec")
    except SyntaxError:
        _print_exc()
        return
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    try:
        exec(compile(tree, "<stdin>", "exec"), _globals)
        if last is not None:
            value = eval(compile(last, "<stdin>", "eval"), _globals)
            if value is not None:
                _globals["_"] = value
                result(repr(value))
    except SystemExit:
        pass
    except BaseException:
        _print_exc()
`;

const post = (msg) => self.postMessage(msg);
const decoder = new TextDecoder();
const stream = (name) => ({
  write: (bytes) => { post({ type: "out", stream: name, text: decoder.decode(bytes) }); return bytes.length; },
});

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const { loadPyodide } = await import(/* @vite-ignore */ new URL("pyodide/pyodide.mjs", data.root).href);
      py = await loadPyodide({ indexURL: new URL("pyodide/", data.root).href });
      py.setStdout(stream("stdout"));
      py.setStderr(stream("error"));
      py.setStdin({ stdin: () => { throw new Error(data.strings.noInput); } });
      py.runPython(REPL);
      const version = py.runPython("import sys; sys.version.split()[0]");
      post({ type: "ready", banner: `Python ${version} (Pyodide ${py.version})` });
    } catch (err) {
      post({ type: "fatal", text: String(err) });
    }
  } else if (data.type === "check") {
    post({ type: "checked", id: data.id, status: py.globals.get("_check")(data.code) });
  } else if (data.type === "run") {
    const result = (text) => post({ type: "out", stream: "result", text: text + "\n" });
    try {
      py.globals.get("_run")(data.code, result);
    } catch (err) {
      post({ type: "out", stream: "error", text: String(err) + "\n" });
    }
    post({ type: "done", id: data.id });
  }
};
