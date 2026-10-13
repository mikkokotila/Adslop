import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { paddleConnection } from "../src/paddle";

// Configuration and denial checks only: no signed payment is created by these tests.
const root = "https://adslop.test";
afterEach(() => { vi.unstubAllGlobals(); });
it("refuses absent Paddle merchant configuration", () => {
  expect(() => paddleConnection({})).toThrow("paddle_not_configured");
  expect(() => paddleConnection({ PADDLE_ENVIRONMENT: "sandbox" })).toThrow("paddle_not_configured");
  expect(() => paddleConnection({ PADDLE_ENVIRONMENT: "live" })).toThrow("paddle_not_configured");
});
it("keeps Paddle status and evidence behind operator authentication", async () => {
  const outbound = vi.fn(); vi.stubGlobal("fetch", outbound);
  for (const path of ["/v1/paddle/status", "/v1/paddle/events/evt_" + "a".repeat(26)]) {
    const reply = await worker.fetch(new Request(root + path), env as Env);
    expect(reply.status).toBe(401);
    expect(await reply.json()).toMatchObject({ error: "unauthorized" });
  }
  expect(outbound).not.toHaveBeenCalled();
});
it("leaves an unconfigured webhook unable to post or call Paddle", async () => {
  const outbound = vi.fn(); vi.stubGlobal("fetch", outbound);
  const reply = await worker.fetch(new Request(root + "/v1/paddle/webhook", { method: "POST" }), env as Env);
  expect(reply.status).toBe(503);
  expect(await reply.json()).toMatchObject({ error: "paddle_not_configured" });
  const read = await worker.fetch(new Request(root + "/v1/paddle/webhook"), env as Env);
  expect(read.status).toBe(405);
  const query = await worker.fetch(new Request(root + "/v1/paddle/webhook?account=other", { method: "POST" }), env as Env);
  expect(query.status).toBe(400);
  expect(outbound).not.toHaveBeenCalled();
});
it("reports missing setting names without exposing any credential", async () => {
  const outbound = vi.fn(); vi.stubGlobal("fetch", outbound);
  const reply = await worker.fetch(new Request(root + "/v1/paddle/status", {
    headers: { Authorization: "Bearer test-only-economic-ledger" },
  }), env as Env);
  expect(reply.status).toBe(200);
  expect(await reply.json()).toEqual({ configured: false, live_validation: "not_verified", missing: [
    "PADDLE_ENVIRONMENT", "PADDLE_ACCOUNT_ID", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_PRICE_MAP",
  ] });
  expect(outbound).not.toHaveBeenCalled();
});
