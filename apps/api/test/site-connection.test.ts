/** Site connection protocol fixtures; no live transactions or advertising claims. */
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
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
