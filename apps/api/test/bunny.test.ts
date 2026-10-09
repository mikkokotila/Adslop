import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import type { BunnyLog } from "../src/bunny";

const endpoint = "https://adslop.test";
const authorization = "Bearer test-only-economic-ledger";
const signatureKey = "test-only-trusted-commerce-secret";

async function signedLog(
  requestId: string, eventId: string, amountMinor: string, statusCode = 204,
  source = "commerce"
): Promise<BunnyLog> {
  const params = new URLSearchParams();
  params.set("schema", "1");
  params.set("product_id", "bunny-test");
  params.set("source", source);
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
  const notComplete = await worker.fetch(new Request(
    endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
    { headers: { Authorization: authorization } }
  ), env as Env);
  expect(await notComplete.json()).toMatchObject({ through: null });
  const retry = await poll();
  expect(await retry.json()).toMatchObject({ admitted: 0, seen: 1, complete: true });
  const completed = await worker.fetch(new Request(
    endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
    { headers: { Authorization: authorization } }
  ), env as Env);
  expect(await completed.json()).toMatchObject({ through: expect.any(String) });
});

it("resumes after twenty pages without skipping unprocessed source records", async () => {
  const first = await signedLog("ffffffffffffffffffffffffffffffff", "sample", "5");
  const offsets: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (request: URL | RequestInfo) => {
    const url = new URL(String(request));
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    return Response.json({
      data: [{
        ...first,
        requestId: offset.toString(16).padStart(32, "0"),
        url: first.url,
        path: first.path,
      }],
      pagination: {
        offset, limit: 1000, returned: 1, hasMore: offset < 20000,
      },
    });
  }));
  const firstPoll = await poll();
  expect(firstPoll.status).toBe(200);
  expect(await firstPoll.json()).toMatchObject({
    scanned: 20, admitted: 1, complete: false, next_offset: 20000,
  });
  const incomplete = await worker.fetch(new Request(
    endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
    { headers: { Authorization: authorization } }
  ), env as Env);
  expect(await incomplete.json()).toMatchObject({ through: null });
  const secondPoll = await poll();
  expect(await secondPoll.json()).toMatchObject({ scanned: 1, complete: true });
  expect(offsets).toHaveLength(21);
  expect(offsets[20]).toBe(20000);
  expect(await money()).toMatchObject({ subscription_revenue_minor: 5 });
  const completed = await worker.fetch(new Request(
    endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
    { headers: { Authorization: authorization } }
  ), env as Env);
  expect(await completed.json()).toMatchObject({ through: expect.any(String) });
});

it("coalesces gaps when source retention advances during poll failures", async () => {
  vi.useFakeTimers();
  try {
    const start = new Date("2026-10-09T12:00:00Z");
    vi.setSystemTime(start);
    setLogPages([[]]);
    expect((await poll()).status).toBe(200);
    const later = start.getTime() + 4 * 86_400_000;
    for (const minutes of [0, 1]) {
      vi.setSystemTime(later + minutes * 60_000);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
      expect((await poll()).status).toBe(502);
    }
    const response = await worker.fetch(new Request(
      endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
      { headers: { Authorization: authorization } }
    ), env as Env);
    const report = await response.json() as { known_gaps: unknown[]; completeness: string };
    expect(report.completeness).toBe("known_gap");
    expect(report.known_gaps).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("retries the original time window after a failed first poll", async () => {
  vi.useFakeTimers();
  try {
    const start = new Date("2026-10-09T12:00:00Z");
    vi.setSystemTime(start);
    const log = await signedLog("11111111111111111111111111111111", "late-signed", "25");
    const windows: string[] = [];
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (request: URL | RequestInfo) => {
      const url = new URL(String(request));
      windows.push(String(url.searchParams.get("from")) + "|" + String(url.searchParams.get("to")));
      if (fail) {
        fail = false;
        return new Response("unavailable", { status: 503 });
      }
      return Response.json({
        data: [log],
        pagination: { offset: 0, limit: 1000, returned: 1, hasMore: false },
      });
    }));
    expect((await poll()).status).toBe(502);
    const uncommitted = await worker.fetch(new Request(
      endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
      { headers: { Authorization: authorization } }
    ), env as Env);
    expect(await uncommitted.json()).toMatchObject({ through: null });
    vi.setSystemTime(start.getTime() + 10 * 60_000);
    expect(await (await poll()).json()).toMatchObject({ admitted: 1, complete: true });
    expect(windows).toHaveLength(2);
    expect(windows[0]).toBe(windows[1]);
    expect(await money()).toMatchObject({ subscription_revenue_minor: 25 });
  } finally {
    vi.useRealTimers();
  }
});

it("retains original allowed fields when rejecting a signed invalid amount or source", async () => {
  const badAmount = await signedLog(
    "22222222222222222222222222222222", "bad-amount", "0"
  );
  const longSource = await signedLog(
    "33333333333333333333333333333333", "long-source", "200", 204,
    "a".repeat(128)
  );
  setLogPages([[badAmount, longSource]]);
  expect(await (await poll()).json()).toMatchObject({ admitted: 0, rejected: 2 });
  for (const [id, field] of [
    ["22222222222222222222222222222222", "amount_minor=0"],
    ["33333333333333333333333333333333", "source=" + "a".repeat(128)],
  ]) {
    const evidence = await worker.fetch(new Request(
      endpoint + "/v1/bunny/records/" + id + "?pull_zone_id=12345",
      { headers: { Authorization: authorization } }
    ), env as Env);
    expect(evidence.status).toBe(200);
    const body = await evidence.json() as {
      disposition: string; reason: string; raw_json: { path: string };
    };
    expect(body.disposition).toBe("rejected");
    expect(body.reason).toBe("invalid_commercial_event");
    expect(body.raw_json.path).toContain(field);
  }
  expect(await money()).toMatchObject({ subscription_revenue_minor: 0 });
});

it("preserves the page cursor when Bunny retention advances during a backlog", async () => {
  vi.useFakeTimers();
  try {
    const start = new Date("2026-10-09T12:00:00Z");
    vi.setSystemTime(start);
    setLogPages([[]]);
    expect((await poll()).status).toBe(200);

    const later = start.getTime() + 4 * 86_400_000;
    vi.setSystemTime(later);
    const event = await signedLog("44444444444444444444444444444444", "floor-event", "7");
    const offsets: number[] = [];
    const windows: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: URL | RequestInfo) => {
      const url = new URL(String(request));
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      windows.push(url.searchParams.get("from") + "|" + url.searchParams.get("to"));
      return Response.json({
        data: [{ ...event, requestId: offset.toString(16).padStart(32, "0") }],
        pagination: { offset, limit: 1000, returned: 1, hasMore: offset < 20000 },
      });
    }));
    expect(await (await poll()).json()).toMatchObject({
      complete: false, next_offset: 20000, admitted: 1,
    });
    vi.setSystemTime(later + 60_000); // the three-day floor now exceeds cursor.from_ms
    expect(await (await poll()).json()).toMatchObject({
      complete: true, scanned: 1, admitted: 0,
    });
    expect(offsets).toHaveLength(21);
    expect(offsets[20]).toBe(20000);
    expect(windows[20]).toBe(windows[0]);
    expect(await money()).toMatchObject({ subscription_revenue_minor: 7 });

    const coverage = await worker.fetch(new Request(
      endpoint + "/v1/bunny/coverage?pull_zone_id=12345",
      { headers: { Authorization: authorization } }
    ), env as Env);
    const report = await coverage.json() as { known_gaps: unknown[]; completeness: string };
    expect(report.completeness).toBe("known_gap");
    expect(report.known_gaps).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("serializes overlapping polls and keeps the durable page cursor monotonic", async () => {
  const first = await signedLog("55555555555555555555555555555555", "overlap-cash", "19");
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  let unblock!: () => void;
  const hold = new Promise<void>((resolve) => { unblock = resolve; });
  const offsets: number[] = [];
  let firstFetch = true;
  vi.stubGlobal("fetch", vi.fn(async (request: URL | RequestInfo) => {
    const url = new URL(String(request));
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    if (firstFetch) {
      firstFetch = false;
      notifyStarted();
      await hold;
    }
    return Response.json({
      data: [{ ...first, requestId: offset.toString(16).padStart(32, "0") }],
      pagination: { offset, limit: 1000, returned: 1, hasMore: offset < 20000 },
    });
  }));
  const a = poll();
  await started;
  const b = poll();
  await Promise.resolve();
  expect(offsets).toEqual([0]);
  unblock();
  const [firstResponse, concurrentResponse] = await Promise.all([a, b]);
  expect(firstResponse.status).toBe(200);
  expect(concurrentResponse.status).toBe(200);
  expect(await firstResponse.json()).toMatchObject({
    complete: false, next_offset: 20000, admitted: 1,
  });
  expect(await concurrentResponse.json()).toMatchObject({
    complete: false, next_offset: 20000, admitted: 1,
  });
  expect(offsets).toHaveLength(20);
  expect(await (await poll()).json()).toMatchObject({
    complete: true, scanned: 1,
  });
  expect(offsets).toHaveLength(21);
  expect(offsets[20]).toBe(20000);
  expect(await money()).toMatchObject({ subscription_revenue_minor: 19 });
});
