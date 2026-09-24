// The page side of keyboard input for programs: see src/workers/input.js for the worker side.
// `channel` is sent to the worker; `answer(id, line)` hands it the line typed (null: end of input).
// Resolves to null when neither way is available: programs then get an error when they read.
const SIZE = 1 << 16;          // bytes of a line, with shared memory; longer lines are cut
const WAIT = 3000;             // ms to wait for the service worker to take control of the page

export async function inputChannel(root) {
  if (self.crossOriginIsolated) return shared();
  try {
    return await serviceWorker(root);
  } catch {
    return null;               // service workers blocked: private browsing, third-party iframe...
  }
}

function shared() {
  const buffer = new SharedArrayBuffer(8 + SIZE);
  const header = new Int32Array(buffer, 0, 2);
  const data = new Uint8Array(buffer, 8);
  const encoder = new TextEncoder();
  return {
    channel: { buffer },
    answer(id, line) {
      // encodeInto refuses shared memory: encode, then copy (cut at SIZE bytes).
      const bytes = line === null ? null : encoder.encode(line).subarray(0, SIZE);
      if (bytes) data.set(bytes);
      header[1] = bytes ? bytes.length : -1;
      Atomics.store(header, 0, 1);
      Atomics.notify(header, 0);
    },
  };
}

async function serviceWorker(root) {
  const sw = navigator.serviceWorker;
  if (!sw) return null;
  await sw.register(new URL("input-sw.js", root));
  const registration = await withTimeout(sw.ready);
  if (!sw.controller && registration?.active) {
    const controlled = new Promise((resolve) => sw.addEventListener("controllerchange", resolve, { once: true }));
    registration.active.postMessage({ type: "claim" });
    await withTimeout(controlled);
  }
  if (!sw.controller) return null;
  return {
    channel: { url: new URL("__repl_input__/", root).href },
    answer: (id, line) => sw.controller?.postMessage({ type: "input", id, line }),
  };
}

const withTimeout = (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, WAIT))]);
