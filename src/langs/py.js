// Written literally: Vite only bundles a worker created as `new Worker(new URL(...))`.
export default {
  id: "py", name: "Python", prompt: ">>>", more: "...", indent: "    ",
  opensBlock: (line) => /:\s*(#.*)?$/.test(line),
  worker: () => new Worker(new URL("../workers/python.worker.js", import.meta.url), { type: "module" }),
};
