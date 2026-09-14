# REPL runtime

In-browser REPLs for beginners: type one line of code, press Enter, see the result.
One route per language:

| Route  | Language   | Engine                                              |
|--------|------------|-----------------------------------------------------|
| `/py`  | Python 3   | [Pyodide](https://pyodide.org) (CPython in WebAssembly) |
| `/lua` | Lua 5.4    | [wasmoon](https://github.com/ceifa/wasmoon) (reference Lua in WebAssembly) |
| `/js`  | JavaScript | the browser itself                                  |

**Live demo:** https://kevin-cazal.github.io/repl_runtime/

Built as a side runtime for coding workshops: a place to try a tool on a small example before
using it in a project. It runs entirely in the browser, with no server and no internet access once
loaded (Pyodide is bundled, not fetched from a CDN).

## What it does

- **Real REPL behaviour.** The value of an expression is shown (`2 + 3` prints `5`); variables,
  functions and classes stay defined from one entry to the next.
- **Multi-line entries.** Enter runs the entry when it is complete, and adds a line when it is not
  (`for i in range(3):`, `if x > 0 then`, `function f() {`). Shift+Enter always adds a line.
  Indentation follows blocks, and `end`, `else` or `}` move back one level.
- **Nothing freezes.** Each language runs in a Web Worker. An infinite loop shows a Stop button
  (or Ctrl+C), which restarts the interpreter.
- **History** with the up and down arrows, kept per language in `localStorage`. Ctrl+L clears the
  screen.
- **French interface** by default, `?lang=en` for English.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/py/
npm run build      # dist/
```

`npm run build` copies Pyodide into `public/pyodide/` first, then builds with Vite.

## Embedding

The dist uses **relative URLs**, so it works under any path: GitHub Pages, a platform prefix such
as `/runtime/repl/<version>/`, or a plain folder. Set `VITE_BASE` at build time if a host needs
absolute URLs instead.

- **Prefill the entry:** `/py/?code=print("bonjour")`
- **From a host page** on the same origin (an iframe parent, for instance):

  ```js
  frame.contentWindow.postMessage({ type: "repl:code", code: "print(1 + 1)", run: true }, location.origin);
  ```

  `run: false` (or omitted) only puts the code in the entry.

**Serve `.mjs` as JavaScript.** Pyodide is loaded as an ES module, and browsers refuse a module
served as `application/octet-stream`. GitHub Pages does this already; the stock nginx image does
not, so add `types { text/javascript mjs; }`.

## Limits

- No keyboard input from programs (`input()`, `io.read()`, `prompt()`).
- Python: the standard library only. Extra packages are not bundled.
- Lua is 5.4. Code written for Lua 5.3 (TIC-80, for example) runs the same for everything a
  beginner writes; the differences are in corners such as integer-for-loop overflow and `<const>`.
- Stop and Restart clear all variables: the worker is replaced, not paused.

## License

MIT
