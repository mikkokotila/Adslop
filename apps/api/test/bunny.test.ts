import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import type { BunnyLog } from "../src/bunny";

const endpoint = "https://adslop.test";
const authorization = "Bearer test-only-economic-ledger";
const signatureKey = "test-only-trusted-commerce-secret";

async function signedLog(
  requestId: string, eventId: string, amountMinor: string, statusCode = 204
): Promise<BunnyLog> {
  const params = new URLSearchParams();
  params.set("schema", "1");
  params.set("product_id", "bunny-test");
  params.set("source", "commerce");
  params.set("event_id", eventId);
  params.set("kind", "subscription_receipt");
  params.set("amount_minor", amountMinor);
  params.set("currency", "EUR");
  params.set("occurred_at", new Date(Date.now() - 180_000).toISOString());
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(params.toString()));
  params.set("sig", [...new Uint8Array(sig)].map((v) => v.toString(16).padStart(2, "0")).join(""));
  const path = "/collect?" + params.toString();
  return {
    pullZoneId: 12345, requestId,
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    statusCode, path, url: "https://events.example.test" + path,
  };
}

function setLogPages(logs: BunnyLog[][]): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (request: URL | RequestInfo) => {
    const url = new URL(String(request));
    expect(url.hostname).toBe("logging.bunnycdn.com");
    expect(url.searchParams.get("order")).toBe("asc");
    expect(url.searchParams.get("urlContains")).toBe("/collect");
    expect(url.searchParams.has("from")).toBe(true);
    expect(url.searchParams.has("to")).toBe(true);
    const index = Number(url.searchParams.get("offset")) / 1000;
    const records = logs[index];
    if (!records) return new Response("not found", { status: 404 });
    return Response.json({
      data: records,
      pagination: {
        offset: index * 1000, limit: 1000,
        returned: records.length, hasMore: index < logs.length - 1,
      },
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function poll(): Promise<Response> {
  return worker.fetch(new Request(endpoint + "/v1/bunny/poll", {
    method: "POST", headers: { Authorization: authorization },
  }), env as Env);
}

async function money(): Promise<Record<string, unknown>> {
  const response = await worker.fetch(
    new Request(endpoint + "/v1/economics?product_id=bunny-test&currency=EUR", {
      headers: { Authorization: authorization },
    }), env as Env
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(async () => {
  await reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("polls signed subscription events into the money ledger once", async () => {
  const log = await signedLog("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "cash-1", "1450");
  const fakeFetch = setLogPages([[log]]);
  const first = await poll();
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ scanned: 1, admitted: 1, rejected: 0 });
  expect(await money()).toMatchObject({
    subscription_revenue_minor: 1450, advertising_spend_minor: 0, difference_minor: 1450,
    attribution: "none",
  });
  const repeat = await poll();
  expect(await repeat.json()).toMatchObject({ scanned: 1, seen: 1, admitted: 0 });
  expect(fakeFetch).toHaveBeenCalledTimes(2);
  const coverage = await worker.fetch(new Request(
    endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
    { headers: { Authorization: authorization } }
  ), env as Env);
  expect(await coverage.json()).toMatchObject({
    pull_zone_id: 12345, completeness: "not_verified",
    through: expect.any(String), known_gaps: [],
  });
  const evidence = await worker.fetch(new Request(
    endpoint + "/v1/bunny/records/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?pull_zone_id=12345",
    { headers: { Authorization: authorization } }
  ), env as Env);
  expect(await evidence.json()).toMatchObject({
    request_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    disposition: "admitted", product_id: "bunny-test",
  });
});

it("records an unsigned public request as rejected without minting revenue", async () => {
  const log = await signedLog("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "fake-cash", "99999");
  const url = new URL(log.url);
  url.searchParams.delete("sig");
  const rejected = { ...log, url: url.toString(), path: url.pathname + url.search };
  setLogPages([[rejected]]);
  const result = await poll();
  expect(await result.json()).toMatchObject({ rejected: 1, admitted: 0 });
  const evidence = await worker.fetch(new Request(
    endpoint + "/v1/bunny/records/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?pull_zone_id=12345",
    { headers: { Authorization: authorization } }
  ), env as Env);
  expect(await evidence.json()).toMatchObject({
    disposition: "rejected", reason: "missing_or_repeated_query_field",
  });
  expect(await money()).toMatchObject({ difference_minor: 0 });
});

it("handles duplicate business events across separate Bunny request IDs", async () => {
  const a = await signedLog("cccccccccccccccccccccccccccccccc", "same-event", "800");
  const b = { ...a, requestId: "dddddddddddddddddddddddddddddddd" };
  setLogPages([[a, b]]);
  expect(await (await poll()).json()).toMatchObject({ admitted: 1, duplicate: 1 });
  expect(await money()).toMatchObject({ subscription_revenue_minor: 800 });
});

it("does not complete a source window when pagination fails", async () => {
  const a = await signedLog("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "paged-1", "200");
  const failing = setLogPages([[a], []]);
  failing.mockImplementationOnce(async (request: URL | RequestInfo) => {
    const url = new URL(String(request));
    expect(url.searchParams.get("offset")).toBe("0");
    return Response.json({
      data: [a],
      pagination: { offset: 0, limit: 1000, returned: 1, hasMore: true },
    });
  });
  failing.mockImplementationOnce(async () => new Response("down", { status: 503 }));
  const failed = await poll();
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "bunny_fetch_failed_503" });
  expect(await money()).toMatchObject({ subscription_revenue_minor: 200 });
  const retry = await poll();
  expect(await retry.json()).toMatchObject({ admitted: 0, seen: 1 });
});
