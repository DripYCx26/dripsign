#!/usr/bin/env node
// One-command local run: .env, compose services, schema and seed, then the web app and the jobs
// worker with prefixed output. Node built-ins only.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");
const SECRET_BYTES = 36; // 48 base64url characters
const PLACEHOLDER = "DRIPSIGN_AUTH_SECRET=replace-me";

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return;
  copyFileSync(path.join(ROOT, ".env.example"), ENV_FILE);
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  writeFileSync(
    ENV_FILE,
    readFileSync(ENV_FILE, "utf8").replace(PLACEHOLDER, `DRIPSIGN_AUTH_SECRET=${secret}`),
  );
  console.log("created .env from .env.example");
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

function runStep(command, args, env) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: ROOT, env, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`dev: \`${command} ${args.join(" ")}\` failed`);
    process.exit(result.status ?? 1);
  }
}

function prefixLines(stream, target, label, color) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const parts = (pending + chunk).split("\n");
    pending = parts.pop() ?? "";
    for (const line of parts) target.write(`\u001b[${color}m[${label}]\u001b[0m ${line}\n`);
  });
  stream.on("end", () => {
    if (pending) target.write(`\u001b[${color}m[${label}]\u001b[0m ${pending}\n`);
  });
}

ensureEnvFile();
const env = { ...process.env, ...parseEnv(readFileSync(ENV_FILE, "utf8")) };

runStep("docker", ["compose", "up", "-d", "--wait"], env);
runStep("pnpm", ["--filter", "@dripsign/core", "cli", "migrate"], env);
runStep("pnpm", ["--filter", "@dripsign/core", "cli", "seed", "--if-empty"], env);

const children = [
  { label: "web", color: 36, args: ["--filter", "@dripsign/web", "dev"] },
  { label: "jobs", color: 35, args: ["--filter", "@dripsign/core", "worker"] },
].map(({ label, color, args }) => {
  const child = spawn("pnpm", args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  prefixLines(child.stdout, process.stdout, label, color);
  prefixLines(child.stderr, process.stderr, label, color);
  return { label, child };
});

let shuttingDown = false;
function shutdown(signal, code) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = code;
  for (const { child } of children) child.kill(signal);
}

for (const { label, child } of children) {
  child.on("exit", (status, signal) => {
    if (!shuttingDown) console.error(`dev: ${label} exited (${signal ?? status}); stopping`);
    shutdown("SIGTERM", process.exitCode ?? status ?? 1);
  });
}
process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));

console.log(`
  app        http://127.0.0.1:3000
  sign in    http://127.0.0.1:3000/dev/sign-in
  Mailpit    http://127.0.0.1:8025
`);
