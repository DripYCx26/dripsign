import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createEmailSender, RetryableDeliveryError } from "./email.ts";
import { BLOB_SERVICE_VERSION, createStorage, storeBytes } from "./storage.ts";

const identity = {
  clientId: "00000000-0000-4000-8000-000000000001",
  endpoint: "http://localhost:42356/msi/token",
  header: "synthetic-identity-header",
};
const DOCUMENT = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF\n");
const MAIL = { to: "signer@dripsign.test", subject: "Code", text: "123456", html: "<p>123456</p>" };

interface Sent {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
}

/** A fetch double: identity tokens always succeed; service calls take the queued answers. */
function stubFetch(answers: (() => Response)[]): Sent[] {
  const sent: Sent[] = [];
  let tokens = 0;
  vi.stubGlobal("fetch", (input: URL, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/msi/token") {
      tokens += 1;
      const expiresOn = Math.floor(Date.now() / 1000) + 3600;
      return Promise.resolve(
        Response.json({ access_token: `token-${String(tokens)}`, expires_on: String(expiresOn) }),
      );
    }
    sent.push({ method: init.method ?? "GET", url, headers: new Headers(init.headers) });
    const answer = answers.shift();
    if (answer === undefined) throw new Error("Unexpected request");
    return Promise.resolve(answer());
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("writes a blob once, trusts an existing one only after reading the same bytes, and never resends accepted mail", async () => {
  const tenantId = randomUUID();
  const storage = createStorage({
    kind: "azure",
    endpoint: "https://dripsign.blob.core.windows.net",
    container: "documents",
    identity,
  });
  const exists = () => new Response(null, { status: 409 });
  const other = () => new Response(new TextEncoder().encode("%PDF-1.7\nother\n%%EOF\n"));
  const same = () => new Response(DOCUMENT);
  let sent = stubFetch([exists, other, exists, same]);
  await expect(storeBytes(tenantId, DOCUMENT, storage)).rejects.toThrow(/integrity/u);
  const stored = await storeBytes(tenantId, DOCUMENT, storage);
  const [put] = sent;
  expect(put?.method).toBe("PUT");
  expect(put?.url.pathname).toBe(`/documents/${stored.key}`);
  expect(put?.headers.get("if-none-match")).toBe("*");
  expect(put?.headers.get("x-ms-version")).toBe(BLOB_SERVICE_VERSION);
  expect(put?.headers.get("authorization")).toBe("Bearer token-1");
  expect(sent.map((request) => request.method)).toEqual(["PUT", "GET", "PUT", "GET"]);

  const send = createEmailSender({
    transport: "azure",
    from: "no-reply@dripsign.test",
    endpoint: "https://dripsign.communication.azure.com",
    identity,
  });
  const refused = () => new Response(null, { status: 401 });
  const throttled = () => new Response(null, { status: 429, headers: { "retry-after": "0" } });
  const accepted = () => new Response(null, { status: 202 });
  sent = stubFetch([refused, throttled, accepted]);
  await send(MAIL);
  // Proven-untaken answers resend the same operation; the accepted one ends it.
  expect(new Set(sent.map((request) => request.headers.get("operation-id"))).size).toBe(1);
  expect(sent.map((request) => request.headers.get("authorization"))).toEqual([
    "Bearer token-1",
    "Bearer token-2",
    "Bearer token-2",
  ]);

  sent = stubFetch([() => new Response(null, { status: 503 })]);
  await expect(send(MAIL)).rejects.toBeInstanceOf(RetryableDeliveryError);
  expect(sent).toHaveLength(1);
});
