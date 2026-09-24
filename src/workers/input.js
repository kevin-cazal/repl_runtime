// Keyboard input for programs: input() in Python, io.read() in Lua, prompt() in JavaScript.
//
// The interpreter runs synchronously in the worker, so it cannot wait for a message from the page:
// the worker has to block until the page answers. Two ways, set up by the page (src/input.js):
// - shared memory and Atomics.wait, when the page is cross-origin isolated;
// - otherwise, a synchronous request that the service worker public/input-sw.js holds open until
//   the page hands it the line.
const decoder = new TextDecoder();

// A function that waits for one line typed in the terminal and returns it without its newline,
// or null at the end of input (Ctrl+D). With no channel, it throws `unavailable`.
export function lineReader(channel, unavailable) {
  return () => {
    if (!channel) throw new Error(unavailable);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    if (channel.buffer) {
      const header = new Int32Array(channel.buffer, 0, 2);
      Atomics.store(header, 0, 0);
      self.postMessage({ type: "input", id });
      Atomics.wait(header, 0, 0);
      const length = header[1];
      return length < 0 ? null : decoder.decode(new Uint8Array(channel.buffer, 8, length).slice());
    }
    self.postMessage({ type: "input", id });
    const url = channel.url + id;
    for (;;) {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      xhr.send();
      // Anything else than the service worker's answer means it is not there after all.
      if (!xhr.getResponseHeader("x-repl-input")) throw new Error(unavailable);
      if (xhr.status === 200) return JSON.parse(xhr.responseText).line;
      // 204: the service worker gave up waiting, so as not to be stopped by the browser. Ask again.
    }
  };
}
