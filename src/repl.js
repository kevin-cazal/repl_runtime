import "./style.css";
import { strings } from "./i18n.js";

// Workers are listed literally: Vite only bundles `new Worker(new URL(...))` written this way.
const LANGUAGES = {
  py: {
    name: "Python", prompt: ">>>", more: "...", indent: "    ",
    opensBlock: (line) => /:\s*(#.*)?$/.test(line),
    worker: () => new Worker(new URL("./workers/python.worker.js", import.meta.url), { type: "module" }),
  },
  lua: {
    name: "Lua", prompt: ">", more: ">>", indent: "  ",
    opensBlock: (line) => /\b(do|then|else|function\b.*\)|repeat)\s*(--.*)?$/.test(line) || /\{\s*$/.test(line),
    worker: () => new Worker(new URL("./workers/lua.worker.js", import.meta.url)),
  },
  js: {
    name: "JavaScript", prompt: ">", more: "...", indent: "  ",
    opensBlock: (line) => /[{([]\s*(\/\/.*)?$/.test(line),
    worker: () => new Worker(new URL("./workers/js.worker.js", import.meta.url)),
  },
};

const HISTORY_MAX = 200;

export function mount(langId, root) {
  const lang = LANGUAGES[langId];
  const t = strings();
  const params = new URLSearchParams(location.search);
  const historyKey = `repl-history-${langId}`;

  root.className = "repl";
  root.innerHTML = `
    <header>
      <span class="title">${lang.name}</span>
      <span class="banner"></span>
      <span class="spacer"></span>
      <button class="stop" hidden>${t.stop}</button>
      <button class="restart">${t.restart}</button>
      <button class="clear">${t.clear}</button>
    </header>
    <div class="scroll">
      <section class="output" aria-live="polite"></section>
      <form class="entry">
        <pre class="gutter" aria-hidden="true"></pre>
        <textarea spellcheck="false" autocapitalize="off" autocomplete="off" rows="1"
                  placeholder="${t.placeholder}" aria-label="${t.placeholder}"></textarea>
      </form>
    </div>
    <footer>${t.hint}</footer>`;

  const $ = (sel) => root.querySelector(sel);
  const scroller = $(".scroll"), output = $(".output"), input = $("textarea"), gutter = $(".gutter");
  const stopBtn = $(".stop"), banner = $(".banner");

  let worker = null, ready = false, running = false, nextId = 1;
  const pending = new Map();
  let history = [];
  try { history = JSON.parse(localStorage.getItem(historyKey)) || []; } catch { /* storage off */ }
  let cursor = history.length, draft = "";

  // ---- output ---------------------------------------------------------------------------------
  function write(text, cls) {
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    const last = output.lastElementChild;
    if (last && last.dataset.cls === cls && !last.dataset.closed) {
      last.textContent += text;
    } else {
      const el = document.createElement("div");
      el.className = `line ${cls}`;
      el.dataset.cls = cls;
      el.textContent = text;
      output.append(el);
    }
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  }
  function echo(code) {
    const el = document.createElement("div");
    el.className = "line echo";
    el.dataset.closed = "1";
    code.split("\n").forEach((line, i) => {
      const row = document.createElement("div");
      const p = document.createElement("span");
      p.className = "prompt";
      p.textContent = (i === 0 ? lang.prompt : lang.more) + " ";
      row.append(p, document.createTextNode(line));
      el.append(row);
    });
    output.append(el);
    scroller.scrollTop = scroller.scrollHeight;
  }
  const info = (text) => { write(text + "\n", "info"); output.lastElementChild.dataset.closed = "1"; };

  // ---- worker ---------------------------------------------------------------------------------
  function start(message) {
    worker?.terminate();
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
    ready = false;
    setRunning(false);
    if (message) info(message);
    info(t.loading(lang.name));
    worker = lang.worker();
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        ready = true;
        banner.textContent = data.banner;
        output.lastElementChild?.remove();   // the "loading" line
        input.focus();
      } else if (data.type === "out") {
        write(data.text, data.stream);
      } else if (data.type === "checked" || data.type === "done") {
        pending.get(data.id)?.(data);
        pending.delete(data.id);
      } else if (data.type === "fatal") {
        write(`${t.fatal} ${data.text}\n`, "error");
      }
    };
    worker.onerror = (e) => write(`${t.fatal} ${e.message}\n`, "error");
    worker.postMessage({ type: "init", root: new URL(".", rootUrl()).href, strings: { noInput: t.noInput } });
  }
  function request(type, code) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ type, id, code });
    });
  }
  function setRunning(on) {
    running = on;
    stopBtn.hidden = !on;
    root.classList.toggle("running", on);
  }

  async function submit({ force = false } = {}) {
    // A last line holding only the automatic indentation counts as an empty line: in Python,
    // that is what ends a block.
    const code = input.value.replace(/\n[ \t]+$/, "\n");
    if (!ready || running) return;
    if (!code.trim()) { echo(""); return; }
    if (!force) {
      const res = await request("check", code);
      if (res && res.status === "incomplete") { newline(); return; }
    }
    const entry = code.replace(/\s+$/, "");
    remember(entry);
    input.value = "";
    resize();
    echo(entry);
    setRunning(true);
    await request("run", langId === "py" ? code : entry);
    setRunning(false);
    scroller.scrollTop = scroller.scrollHeight;
  }

  // ---- input ----------------------------------------------------------------------------------
  function newline() {
    const { selectionStart: s, value } = input;
    const line = value.slice(value.lastIndexOf("\n", s - 1) + 1, s);
    let indent = line.match(/^\s*/)[0];
    if (lang.opensBlock(line)) indent += lang.indent;
    input.setRangeText("\n" + indent, s, input.selectionEnd, "end");
    resize();
  }
  function resize() {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    const lines = input.value.split("\n").length;
    gutter.textContent = [lang.prompt, ...Array(lines - 1).fill(lang.more)].join("\n");
  }
  function remember(code) {
    if (history[history.length - 1] !== code) history.push(code);
    history = history.slice(-HISTORY_MAX);
    cursor = history.length;
    try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch { /* storage off */ }
  }
  function recall(step) {
    if (!history.length) return false;
    if (cursor === history.length) draft = input.value;
    cursor = Math.max(0, Math.min(history.length, cursor + step));
    input.value = cursor === history.length ? draft : history[cursor];
    resize();
    return true;
  }

  // Typing `end`, `else` or `}` on an indented line moves it back one level.
  input.addEventListener("input", () => {
    const { selectionStart: s, value } = input;
    const start = value.lastIndexOf("\n", s - 1) + 1;
    const line = value.slice(start, s);
    const m = line.match(/^([ \t]+)(end|else|elseif|until|\}|\]|\))$/);
    if (m && m[1].length >= lang.indent.length && value.slice(s, value.indexOf("\n", s) >>> 0).trim() === "") {
      input.setRangeText(line.slice(lang.indent.length), start, s, "end");
    }
    resize();
  });
  input.addEventListener("keydown", (e) => {
    const { selectionStart: s, value } = input;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit({ force: e.ctrlKey || e.metaKey });
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      newline();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      input.setRangeText(lang.indent, s, input.selectionEnd, "end");
      resize();
    } else if (e.key === "ArrowUp" && !value.slice(0, s).includes("\n")) {
      if (recall(-1)) { e.preventDefault(); input.setSelectionRange(input.value.length, input.value.length); }
    } else if (e.key === "ArrowDown" && !value.slice(s).includes("\n")) {
      if (recall(+1)) e.preventDefault();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      output.replaceChildren();
    } else if (e.key === "c" && e.ctrlKey && running) {
      e.preventDefault();
      start(t.stopped);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "c" && e.ctrlKey && running) { e.preventDefault(); start(t.stopped); }
  });
  $(".entry").addEventListener("submit", (e) => e.preventDefault());
  $(".clear").addEventListener("click", () => { output.replaceChildren(); input.focus(); });
  $(".restart").addEventListener("click", () => { output.replaceChildren(); start(t.restarted); });
  stopBtn.addEventListener("click", () => start(t.stopped));
  scroller.addEventListener("click", () => { if (!getSelection().toString()) input.focus(); });

  // A host page (same origin) can put code in the entry, and optionally run it.
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.data?.type !== "repl:code") return;
    input.value = String(e.data.code ?? "");
    resize();
    input.focus();
    if (e.data.run) submit({ force: true });
  });

  if (params.has("code")) input.value = params.get("code");
  resize();
  start();
}

// The folder that holds py/, lua/, js/ and pyodide/, wherever the app is served from.
function rootUrl() {
  return new URL("..", location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, ""));
}
