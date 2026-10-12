import { loadConfig, type Config } from "../config.ts";
import { closePool } from "../db.ts";
import { startRunner } from "./runner.ts";
import { startSweep } from "./sweep.ts";

async function main(config: Config): Promise<void> {
  const runner = await startRunner({ concurrency: config.jobsConcurrency });
  const sweep = startSweep();
  console.info(
    `dripsign: jobs started concurrency=${String(config.jobsConcurrency)} storage=${config.storage.kind} email=${config.email.transport}`,
  );
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    // The bound includes database shutdown and sweeps, not just active handler promises.
    const deadline = setTimeout(() => {
      process.exit(0);
    }, 25_000);
    deadline.unref();
    sweep.stop();
    void runner
      .stop()
      .then(async () => {
        await closePool();
        clearTimeout(deadline);
      })
      .catch(() => {
        console.error("dripsign: jobs shutdown failed");
        process.exit(1);
      });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

let config: Config;
try {
  config = loadConfig();
} catch (error: unknown) {
  // The message names the invalid keys, never their values.
  console.error(error instanceof Error ? error.message : "dripsign: invalid configuration");
  process.exit(1);
}

await main(config).catch(() => {
  console.error("dripsign: jobs startup failed");
  process.exit(1);
});
