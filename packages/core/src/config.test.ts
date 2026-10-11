import { expect, it } from "vitest";
import { parseConfig } from "./config.ts";

const dev = {
  DRIPSIGN_DATABASE_URL: "postgres://dripsign:dripsign@127.0.0.1:5433/dripsign",
  DRIPSIGN_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  DRIPSIGN_AUTH_SECRET: "a".repeat(32),
  DRIPSIGN_STORAGE_DIR: "/var/tmp/dripsign-storage",
  DRIPSIGN_ANTHROPIC_API_KEY: "",
  DRIPSIGN_HOST: "",
};

const production = {
  NODE_ENV: "production",
  DRIPSIGN_DATABASE_URL: "postgres://dripsign@db.internal/dripsign",
  DRIPSIGN_PUBLIC_ORIGIN: "https://sign.example.test",
  DRIPSIGN_AUTH_SECRET: "b".repeat(32),
  DRIPSIGN_STORAGE: "s3",
  DRIPSIGN_S3_BUCKET: "dripsign-documents",
  AWS_REGION: "us-east-2",
  DRIPSIGN_EMAIL_TRANSPORT: "ses",
  DRIPSIGN_EMAIL_FROM: "DripSign <no-reply@example.test>",
};

it("parses a minimal dev env and refuses unsafe combinations", () => {
  const config = parseConfig(dev);
  expect(config.ai).toBeNull();
  expect(config.host).toBeNull();
  expect(config.devLogin).toBe(false);
  expect(config.storage).toEqual({ kind: "file", dir: "/var/tmp/dripsign-storage" });
  expect(parseConfig({ ...dev, DRIPSIGN_DEV_LOGIN: "1" }).devLogin).toBe(true);
  expect(parseConfig(production).production).toBe(true);

  // A loopback https origin isolates the production rule from the loopback rule.
  const loopbackProduction = { ...production, DRIPSIGN_PUBLIC_ORIGIN: "https://localhost" };
  expect(() => parseConfig({ ...loopbackProduction, DRIPSIGN_DEV_LOGIN: "1" })).toThrow(
    /^Invalid DripSign configuration:\n- DRIPSIGN_DEV_LOGIN: [^\n]+$/u,
  );
  expect(() =>
    parseConfig({
      ...dev,
      DRIPSIGN_DEV_LOGIN: "1",
      DRIPSIGN_PUBLIC_ORIGIN: "http://10.0.0.5:3000",
    }),
  ).toThrow(/DRIPSIGN_DEV_LOGIN/u);
  expect(() => parseConfig({ ...dev, DRIPSIGN_STORAGE: "s3", AWS_REGION: "us-east-2" })).toThrow(
    /^Invalid DripSign configuration:\n- DRIPSIGN_S3_BUCKET: [^\n]+$/u,
  );
});
