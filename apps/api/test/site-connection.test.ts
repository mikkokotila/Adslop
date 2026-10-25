/** Site connection protocol fixtures; no live transactions or advertising claims. */
import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

const operator = { Authorization: "Bearer test-only-economic-ledger", "Content-Type": "application/json" };
const config = { origins: ["https://store.example.test", "https://app.example.test"], attribution_window_days: 30,
  max_visits_per_minute: 20, campaigns: { search: { provider: "google", account_id: "1234567890", campaign_id: "123" } } };
const root = "https://adslop.test/v1/sites/store/sandbox";
beforeEach(async () => { await reset(); });
async function api(path = "", method = "GET", body?: unknown, headers: Record<string, string> = operator, base = root) {
  return worker.fetch(new Request(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env as Env);
}
it("registers any product and serves one consent-controlled tag without secrets", async () => {
  expect((await api("", "PUT", config, {})).status).toBe(401);
  const put = await api("", "PUT", config);
  expect(put.status).toBe(200);
  const first = await put.json();
  expect(first).toMatchObject({ product_id: "store", mode: "sandbox", collected_visits: 0 });
  expect(await (await api("", "PUT", config)).json()).toEqual(first);
  const tag = await api("/tag.js", "GET", undefined, {});
  expect(tag.status).toBe(200);
  const script = await tag.text();
  expect(script).toContain("window.adslop = Object.freeze");
  expect(script).not.toContain("test-only-economic-ledger");
  expect(script).not.toContain("eightchord");
});
it("collects scoped browser context and resumes it across configured origins", async () => {
  await api("", "PUT", config);
  const headers = { Origin: config.origins[0], "Content-Type": "application/json" };
  const created = await api("/visits", "POST", { campaign: "search" }, headers);
  expect(created.status).toBe(201);
  expect(created.headers.get("Access-Control-Allow-Origin")).toBe(config.origins[0]);
  const visit = await created.json() as { reference: string };
  const resumed = await api("/visits", "POST", visit, { ...headers, Origin: config.origins[1] });
  expect(await resumed.json()).toMatchObject({ reference: visit.reference, reused: true, confidence: "browser_context" });
  expect((await api("/visits", "POST", { amount_minor: 1000 }, headers)).status).toBe(400);
  expect((await api("/visits", "POST", {}, { ...headers, Origin: "https://other.example.test" })).status).toBe(403);
  const report = await api("/report?currency=USD&from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z");
  expect(await report.json()).toMatchObject({ cash_status: "no_observations", groups: [], observed_net_receipts_minor: null });
});
it("requires explicit origins, bounded limits and unambiguous campaign identities", async () => {
  for (const body of [{ ...config, origins: ["https://store.example.test/path"] }, { ...config, origins: ["http://example.test"] },
    { ...config, attribution_window_days: 0 }, { ...config, max_visits_per_minute: 10001 },
    { ...config, campaigns: { search: { ...config.campaigns.search, account_id: "123" } } }, { ...config, secret: "forbidden" },
    { ...config, campaigns: JSON.parse('{"__proto__":{"provider":"google","account_id":"1234567890","campaign_id":"123"}}') }]) {
    expect((await api("", "PUT", body)).status).toBe(400);
  }
  expect((await api("", "PUT", { ...config, origins: ["http://127.0.0.1:4000"] })).status).toBe(200);
});
it("keeps configuration revisions and refuses unknown, foreign and expired references", async () => {
  await api("", "PUT", config);
  const headers = { Origin: config.origins[0], "Content-Type": "application/json" };
  const visit = await (await api("/visits", "POST", {}, headers)).json() as { reference: string };
  for (const target of [root.replace("store", "another"), root.replace("sandbox", "live")]) {
    await api("", "PUT", config, operator, target);
    expect((await api("/visits", "POST", visit, headers, target)).status).toBe(404);
  }
  expect((await api("/visits", "POST", { campaign: "missing" }, headers)).status).toBe(400);
  expect((await api("/visits", "POST", { ...visit, campaign: "search" }, headers)).status).toBe(400);
  const runtime = env as Env;
  await runInDurableObject(runtime.MONEY.get(runtime.MONEY.idFromName("private-operator")), async (_instance, state) => {
    state.storage.sql.exec("UPDATE site_visits SET expires_at=? WHERE reference=?", "2000-01-01T00:00:00.000Z", visit.reference);
  });
  expect((await api("/visits", "POST", visit, headers)).status).toBe(410);
  const changed = await (await api("", "PUT", { ...config, attribution_window_days: 7 })).json() as { revision: number };
  expect(changed.revision).toBeGreaterThan(1);
});
it("applies the product collection budget and exact CORS preflight", async () => {
  await api("", "PUT", { ...config, max_visits_per_minute: 1 });
  const headers = { Origin: config.origins[0], "Content-Type": "application/json" };
  const preflight = await api("/visits", "OPTIONS", undefined, headers);
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(headers.Origin);
  expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  expect((await api("/visits", "POST", {}, headers)).status).toBe(201);
  expect((await api("/visits", "POST", {}, headers)).status).toBe(429);
  expect((await api("/visits", "POST", {}, operator)).status).toBe(403);
});
it("rejects malformed bodies, unsupported methods and ambiguous report windows", async () => {
  await api("", "PUT", config);
  const report = "/report?currency=USD&from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z";
  for (const path of [report + "&currency=EUR", report.replace("currency=USD", "currency=usd"), report.replace("2026-10-01", "2026-02-30"),
    report.replace("2026-10-01", "2020-10-01"), report.replace("2026-11-01", "2026-09-01")]) expect((await api(path)).status).toBe(400);
  expect((await api("/report", "POST", {})).status).toBe(405);
  expect((await api("/visits", "GET", undefined, {})).status).toBe(405);
  expect((await api(report, "GET", undefined, {})).status).toBe(401);
  const malformed = await worker.fetch(new Request(root + "/visits", { method: "POST", headers: {
    "Content-Type": "application/json", Origin: config.origins[0] }, body: "{" }), env as Env);
  expect(malformed.status).toBe(400);
});
