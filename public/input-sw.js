// Keyboard input for programs, when the page is not cross-origin isolated (see
// src/workers/input.js). A worker waiting for a line makes a synchronous request to
// __repl_input__/<id>; this service worker holds it until the page posts the line typed.
// Every other request goes to the network untouched.
const waiting = new Map();   // id -> answer the held request
const answers = new Map();   // id -> line posted before its request arrived
const HOLD = 30_000;         // answer "ask again" before the browser stops a long fetch

const reply = (status, body = null) =>
  new Response(body, { status, headers: { "x-repl-input": "1", "cache-control": "no-store" } });

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const match = /\/__repl_input__\/([\w-]+)$/.exec(new URL(e.request.url).pathname);
  if (!match) return;
  const id = match[1];
  e.respondWith(new Promise((resolve) => {
    const answer = (line) => resolve(reply(200, JSON.stringify({ line })));
    if (answers.has(id)) {
      answer(answers.get(id));
      answers.delete(id);
      return;
    }
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(reply(204));
    }, HOLD);
    waiting.set(id, (line) => { clearTimeout(timer); answer(line); });
  }));
});

self.addEventListener("message", (e) => {
  const { type, id, line } = e.data || {};
  if (type === "claim") {
    // A page loaded with a forced reload is not controlled: take it now rather than at the next load.
    e.waitUntil(self.clients.claim());
  } else if (type === "input") {
    const answer = waiting.get(id);
    if (answer) {
      waiting.delete(id);
      answer(line);
    } else {
      answers.set(id, line);
      setTimeout(() => answers.delete(id), 2 * HOLD);   // its worker may have been stopped
    }
  }
});
