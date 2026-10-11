import { expect, it } from "vitest";
import { requestEvidence } from "./request.ts";

it("records only a trusted-proxy client address and a bounded user agent", () => {
  const chain = "198.51.100.1, 203.0.113.9";
  const longAgent = "a".repeat(600);
  const cases = [
    { hops: 0, headers: { "x-forwarded-for": chain }, ip: null, agent: null },
    { hops: 1, headers: { "x-forwarded-for": chain }, ip: "203.0.113.9", agent: null },
    { hops: 2, headers: { "x-forwarded-for": chain }, ip: "198.51.100.1", agent: null },
    { hops: 3, headers: { "x-forwarded-for": chain }, ip: null, agent: null },
    { hops: 1, headers: { "x-forwarded-for": "not-an-ip" }, ip: null, agent: null },
    { hops: 1, headers: { "x-forwarded-for": `fe80::1%${"z".repeat(80)}` }, ip: null, agent: null },
    { hops: 1, headers: { "user-agent": longAgent }, ip: null, agent: longAgent.slice(0, 500) },
    { hops: 1, headers: {}, ip: null, agent: null },
  ];
  for (const { hops, headers, ip, agent } of cases) {
    const evidence = requestEvidence(new Headers(headers), hops);
    expect(evidence, JSON.stringify({ hops, headers })).toEqual({
      ipAddress: ip,
      userAgent: agent,
    });
  }
});
