import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Readline } from "xterm-readline";
import { strings } from "./i18n.js";

const HISTORY_MAX = 200;
const COLORS = {
  result: "\x1b[38;2;78;201;176m",
  error: "\x1b[38;2;244;135;113m",
  prompt: "\x1b[38;2;86;156;214m",
  reset: "\x1b[0m",
};

// The terminal is xterm.js, and line editing (cursor keys, history, multi-line entries, paste) is
// the xterm-readline addon. This file only connects them to the interpreter in the worker.
//
// `lang` is one of src/langs/*.js: each page imports only its own, so a build that contains one
// language carries one worker.
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
    <div class="terminal" title="${t.hint}"></div>`;

  const $ = (sel) => root.querySelector(sel);
  const stopBtn = $(".stop"), banner = $(".banner");

  // ---- terminal -------------------------------------------------------------------------------
  const style = getComputedStyle(root);
  const css = (name) => style.getPropertyValue(name).trim();
  const term = new Terminal({
    fontFamily: css("--mono"),
    fontSize: 15,
    lineHeight: 1.25,
    cursorBlink: true,
    disableStdin: true,
    convertEol: true,
    scrollback: 5000,
    theme: {
      background: css("--bg"),
      foreground: css("--text"),
      cursor: css("--text"),
      selectionBackground: "#264f78",
    },
  });
  const fit = new FitAddon();
  const rl = new Readline();
  term.loadAddon(fit);
  term.loadAddon(rl);
  term.open($(".terminal"));
  fit.fit();
  new ResizeObserver(() => fit.fit()).observe($(".terminal"));

  let isComplete = () => true;
  let forceSubmit = false;
  rl.setCheckHandler((code) => {
    if (forceSubmit) { forceSubmit = false; return true; }
    const complete = isComplete(code);
    if (!complete) {
      // Readline adds the new line after this returns; indent it like the one above.
      const line = code.slice(code.lastIndexOf("\n") + 1);
      const indent = line.match(/^[ \t]*/)[0] + (lang.opensBlock(line) ? lang.indent : "");
      if (indent) setTimeout(() => term.input(indent));
    }
    return complete;
  });
  rl.setCtrlCHandler(() => { if (running) stop(); });

  // Readline's own key handler only turns Shift+Enter into a new line. Setting ours replaces it,
  // so keep that, and make Tab indent with the language's spaces instead of a tab character.
  term.attachCustomKeyEventHandler((e) => {
    const shiftEnter = e.key === "Enter" && e.shiftKey;
    const tab = e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey;
    if (!shiftEnter && !tab) return true;
    e.preventDefault();          // Tab would otherwise move the focus out of the terminal
    if (e.type === "keydown") term.input(shiftEnter ? "\x1b\r" : lang.indent);
    return false;
  });

  // ---- output ---------------------------------------------------------------------------------
  let atLineStart = true;
  let captured = null;          // output of the entry being run, reported to the host page
  function write(text, stream) {
    if (!text) return;
    if (captured) captured.push({ stream, text });
    const color = COLORS[stream];
    term.write(color ? color + text + COLORS.reset : text);
    atLineStart = text.endsWith("\n");
  }

  // ---- worker ---------------------------------------------------------------------------------
  let worker = null, ready = false, running = false, reading = false, nextId = 1;
  let firstReady;
  const loaded = new Promise((resolve) => { firstReady = resolve; });
  const pending = new Map();
  const queue = [];             // host requests waiting for the terminal to be free
  let typeahead = [];           // keys typed while an entry runs, replayed at the next prompt

  // Readline only listens during a read and drops keys typed meanwhile. A terminal keeps them:
  // collect them here (Ctrl+C excepted, it stops the run) and hand them back to the next read.
  term.onData((data) => {
    if (ready && !reading && !data.includes("\x03")) typeahead.push(data);
  });
  function replayTypeahead() {
    while (typeahead.length && reading) {
      const data = typeahead.shift();
      term.input(data);
      if (data.includes("\r")) break;   // Enter ends this read; the rest waits for the next one
    }
  }

  // Nothing can be typed until the interpreter answers `ready`: stdin stays disabled.
  function start() {
    worker?.terminate();
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
    captured = null;
    typeahead = [];
    setReady(false);
    setRunning(false);
    worker = lang.worker();
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        banner.textContent = data.banner;
        setReady(true);
        notify("repl:ready", { banner: data.banner });
        firstReady();
        drain();
      } else if (data.type === "out") {
        write(data.text, data.stream);
      } else if (data.type === "done") {
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
    term.options.disableStdin = !on;
    root.classList.toggle("loading", !on);
    if (on && !embedded) term.focus();
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

  // ---- read, run, repeat ----------------------------------------------------------------------
  async function loop() {
    for (;;) {
      if (!atLineStart) write("\n");
      const line = rl.read(COLORS.prompt + lang.prompt + COLORS.reset);
      await new Promise((resolve) => term.write("", resolve));   // the read is now active
      reading = true;
      replayTypeahead();
      drain();
      const code = await line;
      reading = false;
      atLineStart = true;
      await run(code);
    }
  }

  async function run(code) {
    if (!code.trim()) return;
    remember(code);
    setRunning(true);
    const out = [];
    captured = out;
    const done = await request("run", code);
    if (captured === out) captured = null;
    setRunning(false);
    if (done) {
      notify("repl:result", {
        code: code.replace(/\s+$/, ""),
        output: out.map((o) => o.text).join(""),
        error: out.some((o) => o.stream === "error"),
      });
    }
  }

  // Put code on the current line, as if typed. With `submit`, press Enter for it.
  function enter(code, submit) {
    rl.updateLine(String(code ?? ""));
    if (submit) {
      forceSubmit = true;
      term.input("\r");
      reading = false;   // this read is over: the next queued request waits for the next prompt
    }
  }

  function clear() {
    term.clear();
    if (reading) rl.updateLine(rl.getLine());
  }

  // ---- history --------------------------------------------------------------------------------
  let history = [];
  try { history = JSON.parse(localStorage.getItem(historyKey)) || []; } catch { /* storage off */ }
  for (const entry of history) rl.appendHistory(entry);
  function remember(code) {
    const entry = code.replace(/\s+$/, "");
    if (history[history.length - 1] !== entry) history.push(entry);
    history = history.slice(-HISTORY_MAX);
    try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch { /* storage off */ }
  }

  // ---- buttons --------------------------------------------------------------------------------
  $(".clear").addEventListener("click", () => { clear(); if (ready) term.focus(); });
  $(".restart").addEventListener("click", () => { clear(); stop(); });
  stopBtn.addEventListener("click", stop);

  // ---- embedding ------------------------------------------------------------------------------
  // Any page may embed the REPL in an iframe and drive it with postMessage. Only the direct parent
  // is listened to. The code it sends runs in the same worker as code typed by hand, so it can do
  // nothing the person at the keyboard could not.
  function notify(type, payload = {}) {
    if (embedded) window.parent.postMessage({ type, lang: langId, ...payload }, "*");
  }
  const free = () => ready && reading && !running;
  function drain() {
    while (free() && queue.length) queue.shift()();
  }
  const HOST = {
    "repl:code": (d) => enter(d.code, d.run),
    "repl:run": (d) => enter(d.code !== undefined ? d.code : rl.getLine(), true),
    "repl:clear": () => clear(),
    "repl:reset": () => { clear(); stop(); },
    "repl:stop": () => { if (running) stop(); },
    "repl:focus": () => term.focus(),
  };
  const IMMEDIATE = new Set(["repl:clear", "repl:reset", "repl:stop", "repl:focus"]);
  addEventListener("message", (e) => {
    if (e.source !== window.parent || e.source === window) return;
    const handler = HOST[e.data?.type];
    if (!handler) return;
    if (IMMEDIATE.has(e.data.type) || free()) handler(e.data);
    else queue.push(() => handler(e.data));
  });

  // ---- go -------------------------------------------------------------------------------------
  if (params.has("code")) queue.push(() => enter(params.get("code"), false));
  notify("repl:loading");
  start();
  // The first prompt appears once both the interpreter and the checker are loaded.
  const checker = lang.checker()
    .then((check) => { isComplete = check; })
    .catch((err) => write(`${t.fatal} ${err}\n`, "error"));
  Promise.all([checker, loaded]).then(loop);
}

// The folder that holds py/, lua/, js/ and pyodide/, wherever the app is served from.
function rootUrl() {
  return new URL("..", location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, ""));
}
