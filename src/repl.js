import "./style.css";
import { strings } from "./i18n.js";

const HISTORY_MAX = 200;

// `lang` is one of src/langs/*.js: each page imports only its own, so a build that contains
// one language carries one worker.
export function mount(lang, root) {
  const langId = lang.id;
  const t = strings();
  const params = new URLSearchParams(location.search);
  const embedded = window.parent !== window;
  const historyKey = `repl-history-${langId}`;

  root.className = "repl loading";
  root.classList.toggle("no-header", params.get("header") === "0");
  root.innerHTML = `
    <header>
      <span class="title">${lang.name}</span>
      <span class="banner"></span>
      <span class="spacer"></span>
      <button class="stop" hidden>${t.stop}</button>
      <button class="restart">${t.restart}</button>
      <button class="clear">${t.clear}</button>
    </header>
    <div class="progress" aria-hidden="true"></div>
    <div class="scroll">
      <section class="output" aria-live="polite"></section>
      <form class="entry">
        <pre class="gutter" aria-hidden="true"></pre>
        <textarea spellcheck="false" autocapitalize="off" autocomplete="off" rows="1" disabled
                  title="${t.hint}" aria-label="${lang.name}"></textarea>
      </form>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const scroller = $(".scroll"), output = $(".output"), input = $("textarea"), gutter = $(".gutter");
  const stopBtn = $(".stop"), banner = $(".banner");

  let worker = null, ready = false, running = false, checking = false, nextId = 1;
  let captured = null;          // output of the entry being run, reported to the host page
  const pending = new Map();
  const queue = [];             // host requests waiting for the interpreter to be free
  let history = [];
  try { history = JSON.parse(localStorage.getItem(historyKey)) || []; } catch { /* storage off */ }
  let cursor = history.length, draft = "";

  // ---- output ---------------------------------------------------------------------------------
  function write(text, cls) {
    if (captured) captured.push({ stream: cls, text });
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    const last = output.lastElementChild;
    if (last && last.dataset.cls === cls) {
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

  // ---- worker ---------------------------------------------------------------------------------
  // The entry stays disabled until the interpreter answers `ready`: nothing typed before that
  // could run anyway, and Python takes a few seconds to load.
  function start() {
    worker?.terminate();
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
    captured = null;
    setReady(false);
    setRunning(false);
    worker = lang.worker();
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        banner.textContent = data.banner;
        setReady(true);
        notify("repl:ready", { banner: data.banner });
        if (!embedded) input.focus();
        drain();
      } else if (data.type === "out") {
        write(data.text, data.stream);
      } else if (data.type === "checked" || data.type === "done") {
        pending.get(data.id)?.(data);
        pending.delete(data.id);
      } else if (data.type === "fatal") {
        root.classList.remove("loading");
        write(`${t.fatal} ${data.text}\n`, "error");
      }
    };
    worker.onerror = (e) => {
      root.classList.remove("loading");
      write(`${t.fatal} ${e.message}\n`, "error");
    };
    worker.postMessage({ type: "init", root: rootUrl().href, strings: { noInput: t.noInput } });
  }
  function request(type, code) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ type, id, code });
    });
  }
  function setReady(on) {
    ready = on;
    input.disabled = !on;
    root.classList.toggle("loading", !on);
  }
  function setRunning(on) {
    running = on;
    stopBtn.hidden = !on;
    root.classList.toggle("running", on);
  }
  function stop() {
    start();
    notify("repl:loading");
  }

  async function submit({ force = false } = {}) {
    // A last line holding only the automatic indentation counts as an empty line: in Python,
    // that is what ends a block.
    const code = input.value.replace(/\n[ \t]+$/, "\n");
    // `checking` closes the gap while the worker says whether the entry is finished: without it,
    // a second Enter pressed in that gap would start a second run.
    if (!ready || running || checking) return;
    if (!code.trim()) { echo(""); return; }
    if (!force) {
      checking = true;
      let res;
      try { res = await request("check", code); } finally { checking = false; queueMicrotask(drain); }
      if (!res || !ready || running) return;
      if (res.status === "incomplete") { newline(); return; }
    }
    const entry = code.replace(/\s+$/, "");
    remember(entry);
    input.value = "";
    resize();
    echo(entry);
    setRunning(true);
    const out = [];
    captured = out;
    const done = await request("run", langId === "py" ? code : entry);
    if (captured === out) captured = null;
    setRunning(false);
    scroller.scrollTop = scroller.scrollHeight;
    if (done) {
      notify("repl:result", {
        code: entry,
        output: out.map((o) => o.text).join(""),
        error: out.some((o) => o.stream === "error"),
      });
    }
    drain();
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
  function setCode(code) {
    input.value = String(code ?? "");
    resize();
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
    }
  });
  // Ctrl+C stops a running entry. Listened on the page: while code runs, the entry may not have
  // the focus.
  addEventListener("keydown", (e) => {
    if (e.key === "c" && e.ctrlKey && running) { e.preventDefault(); stop(); }
  });
  $(".entry").addEventListener("submit", (e) => e.preventDefault());
  $(".clear").addEventListener("click", () => { output.replaceChildren(); if (ready) input.focus(); });
  $(".restart").addEventListener("click", () => { output.replaceChildren(); stop(); });
  stopBtn.addEventListener("click", stop);
  scroller.addEventListener("click", () => { if (ready && !getSelection().toString()) input.focus(); });

  // ---- embedding ------------------------------------------------------------------------------
  // Any page may embed the REPL in an iframe and drive it with postMessage. Only the direct parent
  // is listened to. The code it sends runs in the same worker as code typed by hand, so it can do
  // nothing the person at the keyboard could not.
  function notify(type, payload = {}) {
    if (embedded) window.parent.postMessage({ type, lang: langId, ...payload }, "*");
  }
  function drain() {
    while (ready && !running && !checking && queue.length) queue.shift()();
  }
  const HOST = {
    "repl:code": (d) => { setCode(d.code); if (d.run) submit({ force: true }); },
    "repl:run": (d) => { if (d.code !== undefined) setCode(d.code); submit({ force: true }); },
    "repl:clear": () => output.replaceChildren(),
    "repl:reset": () => { output.replaceChildren(); stop(); },
    "repl:stop": () => { if (running) stop(); },
    "repl:focus": () => input.focus(),
  };
  const IMMEDIATE = new Set(["repl:clear", "repl:reset", "repl:stop", "repl:focus"]);
  addEventListener("message", (e) => {
    if (e.source !== window.parent || e.source === window) return;
    const handler = HOST[e.data?.type];
    if (!handler) return;
    if (IMMEDIATE.has(e.data.type) || (ready && !running && !checking)) handler(e.data);
    else queue.push(() => handler(e.data));
  });

  if (params.has("code")) setCode(params.get("code"));
  resize();
  start();
  notify("repl:loading");
}

// The folder that holds py/, lua/, js/ and pyodide/, wherever the app is served from.
function rootUrl() {
  return new URL("..", location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, ""));
}
