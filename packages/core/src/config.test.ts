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

it("parses azure providers and refuses half an identity or file storage in production", () => {
  const azure = {
    ...production,
    DRIPSIGN_STORAGE: "azure",
    DRIPSIGN_AZURE_BLOB_ENDPOINT: "https://dripsign.blob.core.windows.net",
    DRIPSIGN_AZURE_BLOB_CONTAINER: "documents",
    DRIPSIGN_EMAIL_TRANSPORT: "azure",
    DRIPSIGN_AZURE_EMAIL_ENDPOINT: "https://dripsign.communication.azure.com",
    AZURE_CLIENT_ID: "00000000-0000-4000-8000-000000000001",
    IDENTITY_ENDPOINT: "http://localhost:42356/msi/token",
    IDENTITY_HEADER: "synthetic-identity-header",
  };
  const config = parseConfig(azure);
  expect(config.storage).toMatchObject({ kind: "azure", container: "documents" });
  expect(config.email).toMatchObject({ transport: "azure", from: "no-reply@example.test" });
  expect(() => parseConfig({ ...azure, IDENTITY_HEADER: "" })).toThrow(
    /^Invalid DripSign configuration:\n- IDENTITY_HEADER: [^\n]+$/u,
  );
  expect(() => parseConfig({ ...production, DRIPSIGN_STORAGE: "file" })).toThrow(
    /DRIPSIGN_STORAGE: Production requires s3 or azure/u,
  );
});
