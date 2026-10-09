import { env } from "cloudflare:workers";
import worker, { type Env } from "../src/index";
import { expect, it } from "vitest";

const base = "https://adslop.test";
const token = "Bearer test-only-economic-ledger";

async function send(path: string, body?: object, authorized = true): Promise<Response> {
  return worker.fetch(new Request(base + path, {
    method: body ? "POST" : "GET",
    headers: authorized
      ? { Authorization: token, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  }), env as Env);
}

function observation(product: string, event: string, kind: string, amount: number,
  channel: "google" | "meta" | null, source = "source-contract-test") {
  return {
    product_id: product, source, event_id: event, kind,
    amount_minor: amount, currency: "EUR", channel,
    occurred_at: "2026-10-09T08:00:00.000Z",
  };
}

it("accepts receipts and spend exactly once and returns their difference", async () => {
  const receipt = observation("cash-test", "receipt-1", "subscription_receipt", 15000, null);
  const spend = observation("cash-test", "spend-1", "ad_spend", 6000, "google");
  expect((await send("/v1/observations", receipt)).status).toBe(201);
  expect((await send("/v1/observations", spend)).status).toBe(201);
  const retry = await send("/v1/observations", receipt);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({ status: "duplicate", event_id: "receipt-1" });

  const result = await send("/v1/economics?product_id=cash-test&currency=EUR");
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    subscription_revenue_minor: 15000,
    advertising_spend_minor: 6000,
    difference_minor: 9000,
    advertising_spend_by_channel_minor: { google: 6000, meta: 0 },
    coverage: "not_verified",
    attribution: "none",
  });
  const original = await send("/v1/observations/receipt-1?product_id=cash-test&source=source-contract-test");
  expect(original.status).toBe(200);
  expect(await original.json()).toEqual(receipt);
});

it("rejects conflicting retries without altering recorded money", async () => {
  const before = observation("conflict-test", "receipt-1", "subscription_receipt", 1000, null);
  expect((await send("/v1/observations", before)).status).toBe(201);
  const conflict = await send("/v1/observations", { ...before, amount_minor: 2000 });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "conflicting_event_id" });
  const totals = await send("/v1/economics?product_id=conflict-test&currency=EUR");
  expect(await totals.json()).toMatchObject({ subscription_revenue_minor: 1000, difference_minor: 1000 });
});

it("nets refunds and credits without inventing platform-attributed subscription revenue", async () => {
  const product = "reversals-test";
  const entries = [
    observation(product, "r1", "subscription_receipt", 1000, null),
    observation(product, "r2", "subscription_refund", 250, null),
    observation(product, "s1", "ad_spend", 400, "meta"),
    observation(product, "s2", "ad_credit", 50, "meta"),
  ];
  for (const entry of entries) expect((await send("/v1/observations", entry)).status).toBe(201);
  const result = await send("/v1/economics?product_id=reversals-test&currency=EUR");
  expect(await result.json()).toMatchObject({
    subscription_revenue_minor: 750,
    advertising_spend_minor: 350,
    difference_minor: 400,
    advertising_spend_by_channel_minor: { meta: 350, google: 0 },
  });
});

it("rejects unauthenticated, ambiguous, and invalid monetary requests", async () => {
  expect((await send("/v1/economics?product_id=anything&currency=EUR", undefined, false)).status).toBe(401);
  expect((await send("/v1/observations", observation("invalid-test", "e1", "ad_spend", 0, "google"))).status).toBe(400);
  expect((await send("/v1/observations", observation("invalid-test", "e1", "ad_spend", 100, null))).status).toBe(400);
  expect((await send("/v1/observations", { ...observation("invalid-test", "e1", "ad_spend", 100, "google"), channel: ["google"] })).status).toBe(400);
  expect((await send("/v1/observations", observation("invalid-test", ".", "subscription_receipt", 100, null))).status).toBe(400);
  expect((await send("/v1/observations", observation("invalid-test", "..", "subscription_receipt", 100, null))).status).toBe(400);
  expect((await send("/v1/observations", { ...observation("invalid-test", "e1", "subscription_receipt", 100, null), email: "example@example.com" })).status).toBe(400);
  expect((await send("/v1/economics?product_id=anything&currency=INVALID")).status).toBe(400);
  const nearToken = await worker.fetch(new Request(base + "/v1/economics?product_id=anything&currency=EUR", {
    headers: { Authorization: "Bearer test-only-economic-ledgeq" },
  }), env as Env);
  expect(nearToken.status).toBe(401);
});

it("keeps product and currency data separate", async () => {
  const value = observation("isolated-test", "receipt-1", "subscription_receipt", 700, null);
  expect((await send("/v1/observations", value)).status).toBe(201);
  const otherProduct = await send("/v1/economics?product_id=other-product&currency=EUR");
  expect(await otherProduct.json()).toMatchObject({ difference_minor: 0, coverage: "not_verified" });
  const otherCurrency = await send("/v1/economics?product_id=isolated-test&currency=USD");
  expect(await otherCurrency.json()).toMatchObject({ difference_minor: 0, coverage: "not_verified" });
});

it("does not double-count simultaneous retries", async () => {
  const value = observation("concurrent-test", "receipt-1", "subscription_receipt", 1200, null);
  const responses = await Promise.all([
    send("/v1/observations", value),
    send("/v1/observations", value),
  ]);
  expect(responses.map((item) => item.status).sort()).toEqual([200, 201]);
  const result = await send("/v1/economics?product_id=concurrent-test&currency=EUR");
  expect(await result.json()).toMatchObject({
    subscription_revenue_minor: 1200,
    difference_minor: 1200,
  });
});

it("keeps exact monetary totals when gross amounts exceed safe Number precision", async () => {
  const product = "precision-test";
  const big = Number.MAX_SAFE_INTEGER;
  const entries = [
    observation(product, "google-spend", "ad_spend", big, "google"),
    observation(product, "meta-spend", "ad_spend", 2, "meta"),
    observation(product, "google-credit", "ad_credit", big, "google"),
  ];
  for (const entry of entries) expect((await send("/v1/observations", entry)).status).toBe(201);
  const response = await send("/v1/economics?product_id=precision-test&currency=EUR");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    advertising_spend_minor: 2,
    difference_minor: -2,
    advertising_spend_by_channel_minor: { google: 0, meta: 2 },
  });
});

it("nets receipts precisely even when gross receipts exceed safe Number precision", async () => {
  const product = "precision-receipts-test";
  const big = Number.MAX_SAFE_INTEGER;
  for (const entry of [
    observation(product, "r1", "subscription_receipt", big, null),
    observation(product, "r2", "subscription_receipt", 1, null),
    observation(product, "refund", "subscription_refund", big, null),
  ]) {
    expect((await send("/v1/observations", entry)).status).toBe(201);
  }
  const result = await send("/v1/economics?product_id=precision-receipts-test&currency=EUR");
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    subscription_revenue_minor: 1,
    difference_minor: 1,
    advertising_spend_minor: 0,
  });
});

it("retrieves an admitted event when its path identifier is URL-encoded", async () => {
  const value = observation("encoded-path-test", "invoice:123", "subscription_receipt", 543, null);
  expect((await send("/v1/observations", value)).status).toBe(201);
  const lookup = await send("/v1/observations/invoice%3A123?product_id=encoded-path-test&source=source-contract-test");
  expect(lookup.status).toBe(200);
  expect(await lookup.json()).toEqual(value);
  expect((await send("/v1/observations/%ZZ?product_id=encoded-path-test&source=source-contract-test")).status).toBe(400);
  expect((await send("/v1/observations/%252F?product_id=encoded-path-test&source=source-contract-test")).status).toBe(400);
});
