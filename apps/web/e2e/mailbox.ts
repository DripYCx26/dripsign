import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Only the isolated local fixture spool is read; messages never enter test output. */
export async function mailboxValue(
  directory: string,
  email: string,
  since: number,
  extract: (body: string) => string | undefined,
): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const files = (await readdir(directory))
      .filter((name) => name.endsWith(".eml"))
      .sort()
      .reverse();
    if (files.length > 500)
      throw new Error(
        "Reset the local fixture mail spool before the browser journey.",
      );
    for (const name of files) {
      const path = join(directory, name);
      if ((await stat(path)).mtimeMs < since - 1_000) continue;
      const body = await readFile(path, "utf8");
      if (!body.includes(`\r\nTo: ${email}\r\n`)) continue;
      const value = extract(body);
      if (value) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local fixture mail did not arrive.");
}
