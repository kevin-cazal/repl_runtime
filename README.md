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
- **No typing before it works.** The entry is locked until the interpreter has loaded, with a thin
  progress bar instead of status messages.
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

### In any web page

```html
<script src="https://kevin-cazal.github.io/repl_runtime/embed.js"></script>

<repl-runtime lang="lua" code="print(1 + 1)" style="height: 300px"></repl-runtime>
```

Attributes: `lang` (`py`, `lua`, `js`), `code` (prefills the entry), `ui-lang` (`fr`, `en`),
`header="false"` (hides the title bar and its buttons).

From JavaScript:

```js
const repl = ReplRuntime.embed(container, { lang: "py", height: "300px" });

repl.run("print('bonjour')");          // runs code; queued until Python has loaded
repl.setCode("x = 1");                 // puts code in the entry without running it
repl.addEventListener("repl-result", (e) => {
  console.log(e.detail.code, e.detail.output, e.detail.error);
});
```

| Method | Effect |
|---|---|
| `run(code?)` | run `code`, or what is in the entry |
| `setCode(code, { run })` | put `code` in the entry, optionally run it |
| `clear()` | clear the screen |
| `stop()` | stop the running entry (restarts the interpreter) |
| `reset()` | clear the screen and restart the interpreter |
| `focus()` | put the keyboard in the entry |

| Event | `detail` |
|---|---|
| `repl-loading` | `{ lang }`: the interpreter is (re)starting, the entry is locked |
| `repl-ready` | `{ lang, banner }`: the entry is unlocked |
| `repl-result` | `{ lang, code, output, error }`: after each entry, typed or sent |

The REPL lives in an iframe served from the same place as `embed.js`, so its interpreters and
styles never touch the host page. Calls made before the interpreter is ready are queued and run in
order.

### Without the script

The same API is plain `postMessage`, for a host that manages its own iframe (a workshop platform,
for instance). Point the iframe at `/lua/` (or `/py/`, `/js/`) and send:

```js
frame.contentWindow.postMessage({ type: "repl:run", code: "print(1)" }, replOrigin);
```

Messages to the REPL: `repl:run {code?}`, `repl:code {code, run?}`, `repl:clear`, `repl:stop`,
`repl:reset`, `repl:focus`. Messages from the REPL, to its parent: `repl:loading`, `repl:ready`,
`repl:result`. Only the direct parent is listened to. Before `repl:ready`, `repl:run` and
`repl:code` are queued by the REPL itself.

URL parameters: `?code=...` prefills the entry, `?lang=en` switches the interface to English,
`?header=0` hides the title bar.

### Hosting the dist

The dist uses **relative URLs**, so it works under any path: GitHub Pages, a platform prefix such
as `/runtime/repl/<version>/`, or a plain folder. Set `VITE_BASE` at build time if a host needs
absolute URLs instead.

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
