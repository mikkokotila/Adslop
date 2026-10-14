/** Local Workers access-control checks. These tests perform no Stripe network requests. */
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const root = "https://adslop.test/v1/stripe";
afterEach(() => vi.unstubAllGlobals());

it("keeps operator routes private and rejects unsigned webhooks", async () => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  for (const path of ["/live/status", "/sandbox/status", "/sandbox/effects?product_id=eightchord"]) {
    const res = await worker.fetch(new Request(root + path), env as Env);
    expect(res.status).toBe(401);
  }
  const res = await worker.fetch(new Request(root + "/sandbox/webhook", { method: "POST", body: "{}" }), env as Env);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "stripe_not_configured", request_id: null });
  expect(network).not.toHaveBeenCalled();
});
it("reports absent configuration without leaking credential data", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const res = await worker.fetch(new Request(root + "/sandbox/status", {
    headers: { Authorization: "Bearer test-only-economic-ledger" },
  }), { ...env, STRIPE_SANDBOX_CONNECTION: "invalid configuration" } as Env);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "stripe_invalid_configuration", request_id: null });
  expect(fetch).not.toHaveBeenCalled();
});
it("returns stored evidence without requiring an active external credential", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const response = await worker.fetch(new Request(root + "/sandbox/effects?product_id=eightchord", {
    headers: { Authorization: "Bearer test-only-economic-ledger" },
  }), env as Env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ mode: "sandbox", effects: [], coverage: "not_verified" });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects unsupported route methods before any source call", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const response = await worker.fetch(new Request(root + "/live/import", {
    headers: { Authorization: "Bearer test-only-economic-ledger" },
  }), env as Env);
  expect(response.status).toBe(405);
  expect(fetch).not.toHaveBeenCalled();
});
