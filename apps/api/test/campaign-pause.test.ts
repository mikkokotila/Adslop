/** Exercise pause-only protocols and persisted evidence in the real Workers actor. */
import { env } from "cloudflare:workers";
import { evictAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import type { CampaignPauseProvider } from "../src/campaign-pause";

const account = "1234567890", campaign = "610";
const resource = "customers/" + account + "/campaigns/" + campaign;
const credentials = { GOOGLE_ADS_CLIENT_ID: "fixture-client", GOOGLE_ADS_CLIENT_SECRET: "fixture-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "fixture-refresh", META_ACCESS_TOKEN: "fixture-meta" };
const path = (provider: CampaignPauseProvider) =>
  "https://adslop.test/v1/" + provider + "/accounts/" + account + "/campaigns/" + campaign + "/pause";
async function call(provider: CampaignPauseProvider, method = "POST", body = "{}", auth = true, suffix = "") {
  return worker.fetch(new Request(path(provider) + suffix, { method,
    headers: auth ? { Authorization: "Bearer test-only-economic-ledger" } : {},
    ...(method === "GET" ? {} : { body }),
  }), { ...env, ...credentials } as Env);
}
type Options = { paused?: boolean; foreign?: boolean; accountMismatch?: boolean; child?: "ad" | "adset";
  failure?: "network" | "invalid_json" | "server" | "denied" | "readback" | "mismatch" };
function nativeMock(provider: CampaignPauseProvider, options: Options = {}) {
  let status = options.paused ? "PAUSED" : provider === "google-ads" ? "ENABLED" : "ACTIVE";
  let writes = 0;
  const fake = vi.fn(async (uri: RequestInfo | URL, init?: RequestInit) => {
    const url = String(uri);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture-access" });
    if (url.endsWith("/customers:listAccessibleCustomers")) {
      return Response.json({ resourceNames: ["customers/" + account] });
    }
    const google = provider === "google-ads";
    const body = google ? JSON.parse(String(init?.body)) as Record<string, unknown> : null;
    if (google && typeof body?.query === "string" && body.query.includes("FROM customer")) {
      return Response.json({ results: [{ customer: { id: options.accountMismatch ? "9876543210" : account,
        descriptiveName: "Fixture", currencyCode: "USD", timeZone: "Europe/Helsinki", manager: false } }] });
    }
    const write = google ? url.endsWith("googleAds:mutate") : init?.method === "POST";
    if (write) {
      writes++;
      if (google) expect(body).toEqual({ partialFailure: false, mutateOperations: [{ campaignOperation: {
        update: { resourceName: resource, status: "PAUSED" }, updateMask: "status",
      } }] });
      else {
        expect(url).toBe("https://graph.facebook.com/v25.0/" + campaign);
        expect(new URLSearchParams(String(init?.body)).toString()).toBe("status=PAUSED");
      }
      if (options.failure === "denied") return Response.json({ error: { code: 200, fbtrace_id: "trace-denied" } }, { status: 403 });
      status = options.failure === "mismatch" ? status : "PAUSED";
      if (options.failure === "network") throw new TypeError("lost response after native commit");
      if (options.failure === "invalid_json") return new Response("{");
      if (options.failure === "server") return Response.json({ error: "INTERNAL" }, { status: 500 });
      return Response.json(google ? { mutateOperationResponses: [{ campaignResult: { resourceName: resource } }] }
        : { success: true }, { headers: { "request-id": "native-write" } });
    }
    if (writes && options.failure === "readback") return Response.json({ error: "UNAVAILABLE" }, { status: 503 });
    if (google) {
      expect(body?.query).toContain("FROM campaign WHERE campaign.id = " + campaign);
      return Response.json({ results: [{ campaign: { id: campaign, status,
        resourceName: options.foreign ? resource.replace(account, "9876543210") : resource } }] },
      { headers: { "request-id": "native-observation" } });
    }
    expect(url).toContain("https://graph.facebook.com/v25.0/" + campaign + "?");
    expect(new URL(url).searchParams.get("fields")).toBe("id,account_id,status,objective,buying_type");
    return Response.json({ id: campaign, account_id: options.foreign ? "9876543210" : account, status,
      ...(options.child ? { campaign_id: "999", ...(options.child === "ad" ? { adset_id: "888" } : {}) }
        : { objective: "OUTCOME_TRAFFIC", buying_type: "AUCTION" }) });
  });
  vi.stubGlobal("fetch", fake);
  return { writes: () => writes, fake };
}
beforeEach(async () => {
  const namespace = (env as Env).MONEY;
  await runInDurableObject(namespace.get(namespace.idFromName("private-operator")), (_instance, state) => {
    state.storage.sql.exec("DELETE FROM campaign_pause_attempts").toArray();
  });
});
afterEach(() => vi.unstubAllGlobals());

it("pauses and verifies Google and Meta campaigns", async () => {
  const namespace = (env as Env).MONEY;
  const moneyCounts = () => runInDurableObject(namespace.get(namespace.idFromName("private-operator")), (_instance, state) =>
    ["observations", "google_cost_revisions", "meta_cost_revisions", "stripe_effects"].map(table =>
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM " + table).one().n));
  const before = await moneyCounts();
  for (const provider of ["google-ads", "meta"] as const) {
    const native = nativeMock(provider);
    const reply = await call(provider);
    expect(reply.status).toBe(200);
    expect(reply.headers.get("Cache-Control")).toBe("no-store");
    const result = await reply.json() as { operation_id: string; checkpoints: Array<{ phase: string }> };
    expect(result).toMatchObject({ status: "verified_paused", account_id: account, campaign_id: campaign,
      native: { status: "PAUSED" }, native_write_requested: true, paid_delivery_authorized: false });
    expect(result.checkpoints.map(c => c.phase)).toEqual(["requested", "native_observed_before", "write_requested",
      "native_acknowledged", "native_observed_after", "complete"]);
    expect(native.writes()).toBe(1);
    await evictAllDurableObjects();
    const history = await call(provider, "GET");
    expect(await history.json()).toMatchObject({ native_state_refreshed: false,
      attempts: [{ operation_id: result.operation_id, status: "verified_paused" }] });
    const again = await call(provider);
    expect(await again.json()).toMatchObject({ status: "verified_paused", native_write_requested: false });
    expect(native.writes()).toBe(1);
    expect(JSON.stringify(result)).not.toContain("fixture-");
  }
  expect(await moneyCounts()).toEqual(before);
});

it("retains uncertain pause attempts without resending", async () => {
  for (const provider of ["google-ads", "meta"] as const) {
    for (const failure of ["network", "invalid_json", "server", "readback", "mismatch"] as const) {
      const native = nativeMock(provider, { failure });
      const reply = await call(provider);
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(await reply.json()).toMatchObject({ status: "write_unverified", paid_delivery_authorized: false });
      expect(native.writes()).toBe(1);
      const count = native.fake.mock.calls.length;
      await evictAllDurableObjects();
      const history = await call(provider, "GET");
      expect(await history.json()).toMatchObject({ attempts: expect.arrayContaining([
        expect.objectContaining({ status: "write_unverified" }),
      ]) });
      expect(native.fake.mock.calls.length).toBe(count);
    }
    const denied = nativeMock(provider, { failure: "denied" });
    expect(await (await call(provider)).json()).toMatchObject({ status: "write_rejected" });
    expect(denied.writes()).toBe(1);
  }
  const namespace = (env as Env).MONEY;
  await runInDurableObject(namespace.get(namespace.idFromName("private-operator")), (_instance, state) => {
    state.storage.sql.exec("INSERT INTO campaign_pause_attempts (provider, account_id, campaign_id, operation_id, requested_at, body) VALUES (?, ?, ?, ?, ?, ?)",
      "meta", account, campaign, "interrupted-fixture", "2026-10-17T00:00:00.000Z", JSON.stringify({
        operation_id: "interrupted-fixture", status: "write_unverified", checkpoints: [{ phase: "write_requested" }],
      }));
  });
  await evictAllDurableObjects();
  const untouched = vi.fn(); vi.stubGlobal("fetch", untouched);
  expect(await (await call("meta", "GET")).json()).toMatchObject({
    attempts: expect.arrayContaining([expect.objectContaining({ operation_id: "interrupted-fixture", status: "write_unverified" })]),
  });
  expect(untouched).not.toHaveBeenCalled();
  await runInDurableObject(namespace.get(namespace.idFromName("private-operator")), (_instance, state) => {
    for (let i = 0; i < 101; i++) state.storage.sql.exec(
      "INSERT INTO campaign_pause_attempts (provider, account_id, campaign_id, operation_id, requested_at, body) VALUES (?, ?, ?, ?, ?, ?)",
      "meta", account, campaign, "bounded-" + i, "2026-10-17T00:00:00.000Z",
      JSON.stringify({ operation_id: "bounded-" + i, status: "incomplete" }));
  });
  const bounded = await (await call("meta", "GET")).json() as { attempts: object[]; truncated: boolean; limit: number };
  expect(bounded).toMatchObject({ truncated: true, limit: 100 });
  expect(bounded.attempts).toHaveLength(100);
  expect(untouched).not.toHaveBeenCalled();
});

it("rejects activation and foreign account requests", async () => {
  for (const provider of ["google-ads", "meta"] as const) {
    const native = nativeMock(provider, { foreign: true });
    expect((await call(provider, "POST", '{"status":"ENABLED"}')).status).toBe(400);
    expect((await call(provider, "PUT")).status).toBe(405);
    expect((await call(provider, "POST", "{}", false)).status).toBe(401);
    expect((await call(provider, "GET", "{}", true, "?retry=true")).status).toBe(400);
    expect(native.fake).not.toHaveBeenCalled();
    expect((await call(provider)).status).toBe(409);
    expect(native.writes()).toBe(0);
    expect(await (await call(provider, "GET")).json()).toMatchObject({
      attempts: [expect.objectContaining({ status: "failed_before_write", checkpoints: expect.arrayContaining([
        expect.objectContaining({ error: "campaign_pause_account_mismatch" }),
      ]) })],
    });
  }
  const wrongAccount = nativeMock("google-ads", { accountMismatch: true });
  expect((await call("google-ads")).status).toBe(409);
  expect(wrongAccount.writes()).toBe(0);
  for (const child of ["ad", "adset"] as const) {
    const native = nativeMock("meta", { paused: true, child });
    const reply = await call("meta");
    expect(reply.status).toBe(409);
    expect(await reply.json()).toMatchObject({ status: "failed_before_write", error: "campaign_pause_campaign_identity_unverified" });
    expect(native.writes()).toBe(0);
    expect(await (await call("meta", "GET")).json()).toMatchObject({ attempts: expect.arrayContaining([
      expect.objectContaining({ status: "failed_before_write", checkpoints: expect.arrayContaining([
        expect.objectContaining({ error: "campaign_pause_campaign_identity_unverified" }),
      ]) }),
    ]) });
  }
});
