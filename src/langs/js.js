import { isComplete } from "./js-syntax.js";

// Written literally: Vite only bundles a worker created as `new Worker(new URL(...))`.
export default {
  id: "js", name: "JavaScript", prompt: "> ", indent: "  ",
  opensBlock: (line) => /[{([]\s*(\/\/.*)?$/.test(line),
  worker: () => new Worker(new URL("../workers/js.worker.js", import.meta.url)),
  checker: async () => isComplete,
};
