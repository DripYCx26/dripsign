import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { DomainError } from "../errors.ts";
import type { PreparationInput, PreparedPdf } from "./prepare.ts";

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "upload-worker.mjs");
const PARSE_TIMEOUT_MS = 30_000;
const MAX_QUEUED_UPLOADS = 8;

interface QueuedUpload {
  input: PreparationInput;
  signal: AbortSignal | undefined;
  resolve: (result: PreparedPdf) => void;
  reject: (error: unknown) => void;
  abort: () => void;
}

const uploadQueue: QueuedUpload[] = [];
let uploadActive = false;

export function isolateUpload(input: PreparationInput, signal?: AbortSignal): Promise<PreparedPdf> {
  signal?.throwIfAborted();
  if (uploadQueue.length >= MAX_QUEUED_UPLOADS)
    return Promise.reject(new DomainError("unavailable", "The PDF parser is busy."));
  return new Promise((resolve, reject) => {
    const entry: QueuedUpload = {
      input,
      signal,
      resolve,
      reject,
      abort: () => {
        const index = uploadQueue.indexOf(entry);
        if (index === -1) return;
        uploadQueue.splice(index, 1);
        signal?.removeEventListener("abort", entry.abort);
        const reason: unknown = signal?.reason;
        reject(reason instanceof Error ? reason : new Error("PDF preparation cancelled"));
      },
    };
    uploadQueue.push(entry);
    signal?.addEventListener("abort", entry.abort, { once: true });
    if (signal?.aborted) entry.abort();
    startNextUpload();
  });
}

function startNextUpload(): void {
  if (uploadActive) return;
  const entry = uploadQueue.shift();
  if (!entry) return;
  uploadActive = true;
  entry.signal?.removeEventListener("abort", entry.abort);
  void (async () => {
    try {
      entry.resolve(await runUpload(entry.input, entry.signal));
    } catch (error) {
      entry.reject(error);
    } finally {
      uploadActive = false;
      startNextUpload();
    }
  })();
}

function runUpload(input: PreparationInput, signal?: AbortSignal): Promise<PreparedPdf> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: input,
      // Do not inherit the CLI's loader or test runner arguments into an independent parser.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (result?: PreparedPdf, error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate().then(
        () => {
          if (result) resolve(result);
          else reject(error instanceof Error ? error : new Error("PDF preparation cancelled"));
        },
        () => {
          reject(new DomainError("unavailable", "The PDF parser could not stop."));
        },
      );
    };
    const abort = (): void => {
      finish(undefined, signal?.reason);
    };
    const timer = setTimeout(() => {
      finish(undefined, new DomainError("invalid", "The PDF took too long to prepare."));
    }, PARSE_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (message: { result?: PreparedPdf; code?: string }) => {
      if (message.result) finish(message.result);
      else
        finish(
          undefined,
          new DomainError(
            message.code === "invalid" ? "invalid" : "unavailable",
            "The PDF could not be prepared.",
          ),
        );
    });
    worker.once("error", (error: unknown) => {
      const limited =
        error instanceof Error && "code" in error && error.code === "ERR_WORKER_OUT_OF_MEMORY";
      finish(
        undefined,
        new DomainError(limited ? "invalid" : "unavailable", "The PDF parser failed."),
      );
    });
    worker.once("exit", () => {
      finish(undefined, new DomainError("invalid", "The PDF parser stopped."));
    });
    if (signal?.aborted) abort();
  });
}
