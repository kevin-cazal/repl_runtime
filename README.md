# REPL runtime

In-browser REPLs for beginners: type one line of code, press Enter, see the result.
One route per language:

| Route  | Language   | Engine                                              |
|--------|------------|-----------------------------------------------------|
| `/py`  | Python 3   | [Pyodide](https://pyodide.org) (CPython in WebAssembly) |
| `/lua` | Lua 5.3.6  | the reference Lua, compiled to WebAssembly, configured like [TIC-80](https://tic80.com) |
| `/js`  | JavaScript | the browser itself                                  |

**Live demo:** https://kevin-cazal.github.io/repl_runtime/

Built as a side runtime for coding workshops: a place to try a tool on a small example before
using it in a project. It runs entirely in the browser, with no server and no internet access once
loaded (Pyodide is bundled, not fetched from a CDN).

## What it does

- **A real terminal.** [xterm.js](https://xtermjs.org), with line editing from
  [xterm-readline](https://github.com/strtok/xterm-readline): cursor keys, Home/End, Ctrl+U/K,
  paste, and history with the up and down arrows (kept per language in `localStorage`).
- **Real REPL behaviour.** The value of an expression is shown (`2 + 3` prints `5`); variables,
  functions and classes stay defined from one entry to the next.
- **Multi-line entries.** Enter runs the entry when it is complete, and adds a line when it is not
  (`for i in range(3):`, `if x > 0 then`, `function f() {`). Shift+Enter always adds a line, the
  new line is indented like the block, and Tab indents with spaces. Deciding "complete or not" is
  done in the page, synchronously: Lua compiles the entry with the same Lua as the interpreter
  (compiling runs nothing), JavaScript parses it with acorn, Python follows the interactive
  interpreter's rules (open brackets and strings continue, a `:` opens a block that an empty line
  ends).
- **Nothing freezes.** Each language runs in a Web Worker. An infinite loop shows a Stop button
  (or Ctrl+C), which restarts the interpreter. Keys typed while code runs are kept for the next
  prompt, like in a terminal.
- **No typing before it works.** The terminal ignores the keyboard until the interpreter has
  loaded, with a thin progress bar instead of status messages.
- **French interface** by default, `?lang=en` for English.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/py/
npm run build      # dist/
```

`npm run build` copies Pyodide into `public/pyodide/` first, then builds with Vite.

**One language only:** `REPL_LANGS=lua npm run build` builds the Lua REPL alone (about 1 MB,
no Pyodide). `REPL_LANGS` takes a comma-separated subset of `py,lua,js`.

## Releases

Each `v*` tag publishes two archives on the
[releases page](https://github.com/kevin-cazal/repl_runtime/releases), with a `SHA256SUMS` file:

| Archive | Content |
|---|---|
| `repl_runtime-<tag>.tar.gz` | every REPL, about 14 MB |
| `repl_runtime-lua-<tag>.tar.gz` | the Lua REPL only |

The dist is at the archive root: extract it into the folder you serve, for instance
`public/repl/` of another Vite app. That is how
[tic80-web-editor](https://github.com/kevin-cazal/tic80-web-editor) vendors its REPL panel.

## Lua 5.3, like TIC-80

The Lua REPL is not a Lua reimplementation: it is the reference Lua source that TIC-80 embeds
(`lua/lua` at `75ea9cc`, release 5.3.6), compiled with the same `LUA_COMPAT_5_2` flag and opening
the same standard libraries. What runs in the REPL runs in a TIC-80 cart.

`lua53/repl.c` holds the REPL rules (expression first, `<eof>` means "not finished", the
`print` that writes to the page). `lua53/build.sh` compiles it with Emscripten in Docker into
`vendor/lua53/lua53.js`, which is committed: building the app never needs Emscripten.

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
- Lua has the libraries TIC-80 opens, and no others: no `io`, `os` or `utf8`.
- Stop and Restart clear all variables: the worker is replaced, not paused.

## License

MIT
