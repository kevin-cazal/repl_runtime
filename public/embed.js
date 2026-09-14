/*
 * Embed the REPL in any web page.
 *
 *   <script src="https://kevin-cazal.github.io/repl_runtime/embed.js"></script>
 *   <repl-runtime lang="lua" code="print(1 + 1)" style="height: 300px"></repl-runtime>
 *
 * or from JavaScript:
 *
 *   const repl = ReplRuntime.embed(container, { lang: "py", height: "300px" });
 *   repl.addEventListener("repl-result", (e) => console.log(e.detail.output));
 *   repl.run("print('bonjour')");
 *
 * The REPL runs in an iframe served from the same place as this script, so its interpreters,
 * workers and styles never touch the host page. Calls made before the interpreter has loaded
 * are queued, then run in order.
 */
(() => {
  if (customElements.get("repl-runtime")) return;

  const BASE = new URL(".", document.currentScript ? document.currentScript.src : location.href);
  const LANGS = ["py", "lua", "js"];

  class ReplRuntimeElement extends HTMLElement {
    static observedAttributes = ["lang", "ui-lang", "header"];

    constructor() {
      super();
      this.ready = false;
      this._queue = [];
      this._onMessage = this._onMessage.bind(this);
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host { display: block; height: 320px; border-radius: 6px; overflow: hidden; background: #1e1e1e; }
          iframe { display: block; width: 100%; height: 100%; border: 0; }
        </style>`;
      this._frame = document.createElement("iframe");
      this._frame.setAttribute("allow", "clipboard-read; clipboard-write");
      root.append(this._frame);
    }

    connectedCallback() {
      addEventListener("message", this._onMessage);
      this._load();
    }

    disconnectedCallback() {
      removeEventListener("message", this._onMessage);
    }

    attributeChangedCallback() {
      if (this.isConnected) this._load();
    }

    /** Put code in the entry. With { run: true }, run it as well. */
    setCode(code, { run = false } = {}) { this._send({ type: "repl:code", code, run }); }
    /** Run code (or, without argument, what is in the entry). */
    run(code) { this._send(code === undefined ? { type: "repl:run" } : { type: "repl:run", code }); }
    clear() { this._send({ type: "repl:clear" }); }
    /** Clear the screen and restart the interpreter: every variable is lost. */
    reset() { this.ready = false; this._send({ type: "repl:reset" }, true); }
    /** Stop the entry that is running. Restarts the interpreter. */
    stop() { this._send({ type: "repl:stop" }, true); }
    focus() { this._send({ type: "repl:focus" }); }

    _load() {
      const lang = LANGS.includes(this.getAttribute("lang")) ? this.getAttribute("lang") : "py";
      const url = new URL(`${lang}/`, BASE);
      if (this.hasAttribute("code")) url.searchParams.set("code", this.getAttribute("code"));
      if (this.hasAttribute("ui-lang")) url.searchParams.set("lang", this.getAttribute("ui-lang"));
      if (this.getAttribute("header") === "false") url.searchParams.set("header", "0");
      if (this._frame.src === url.href) return;
      this.ready = false;
      this._frame.title = `REPL ${lang}`;
      this._frame.src = url.href;
    }

    // Until the REPL says it is ready, its page may not even be listening: keep messages here.
    _send(message, immediate = false) {
      if (this.ready || immediate) this._frame.contentWindow?.postMessage(message, BASE.origin);
      else this._queue.push(message);
    }

    _onMessage(e) {
      if (e.source !== this._frame.contentWindow || e.origin !== BASE.origin) return;
      const { type, ...detail } = e.data || {};
      if (typeof type !== "string" || !type.startsWith("repl:")) return;
      if (type === "repl:ready") {
        this.ready = true;
        for (const message of this._queue.splice(0)) this._send(message);
      } else if (type === "repl:loading") {
        this.ready = false;
      }
      this.dispatchEvent(new CustomEvent(type.replace(":", "-"), { detail }));
    }
  }

  customElements.define("repl-runtime", ReplRuntimeElement);

  window.ReplRuntime = {
    /** Create a <repl-runtime> inside `container`. Options: lang, code, height, uiLang, header. */
    embed(container, { lang = "py", code, height, uiLang, header } = {}) {
      const el = document.createElement("repl-runtime");
      el.setAttribute("lang", lang);
      if (code !== undefined) el.setAttribute("code", code);
      if (uiLang) el.setAttribute("ui-lang", uiLang);
      if (header === false) el.setAttribute("header", "false");
      if (height) el.style.height = height;
      container.append(el);
      return el;
    },
  };
})();
