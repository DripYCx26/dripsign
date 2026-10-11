import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

// The production worker runs TypeScript directly, just like the CLI, without a build artifact.
register();
const { preparePdfInProcess } = await import("./prepare.ts");
try {
  const result = await preparePdfInProcess(workerData);
  parentPort.postMessage({ result }, [result.bytes.buffer]);
} catch (error) {
  parentPort.postMessage({ code: error?.code === "invalid" ? "invalid" : "unavailable" });
}
