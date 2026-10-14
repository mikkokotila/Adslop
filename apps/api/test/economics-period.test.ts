/** Deterministic read-only report contracts in the isolated Workers test database. */
import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { parseEconomicPeriod, summarizeEconomicPeriod, type PeriodObservation, type PeriodCost } from "../src/economics-period";

const url = "https://adslop.test/v1/economics/period?product_id=period-test&currency=EUR&from=2026-10-05&to=2026-10-11&time_zone=Europe%2FHelsinki";
const period = () => parseEconomicPeriod(new URL(url));
const observation = (id: string, kind: string, amount: number, at = "2026-10-07T12:00:00.000Z"): PeriodObservation => ({
  source: "unit-source", event_id: id, kind, amount_minor: amount,
  channel: kind.startsWith("ad_") ? "google" : null, occurred_at: at,
});
const cost = (platform = "google", amount = "1000001", time_zone = "Europe/Helsinki"): PeriodCost => ({
  platform, account_id: platform === "google" ? "1234567890" : "1234567890123456", campaign_id: "123",
  local_date: "2026-10-07", revision: 2, time_zone, amount, observed_at: "2026-10-08T12:00:00.000Z",
});
async function get(target = url, auth = true) {
  return worker.fetch(new Request(target, { headers: auth ? { Authorization: "Bearer test-only-economic-ledger" } : {} }), env as Env);
}
beforeEach(async () => { await reset(); });
afterEach(() => vi.unstubAllGlobals());

it("distinguishes missing observations from verified zero", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    money_in: { status: "no_observations", observed_net_receipts_minor: "0" },
    money_out: { status: "no_observations", observed_spend_micros: null },
    observed_difference_micros: null, coverage: { complete: false, verified_zero: false },
    launch_or_budget_increase_authorized: false,
  });
  expect(network).not.toHaveBeenCalled();
});
it("requires authentication and rejects unsupported methods and ambiguous periods", async () => {
  expect((await get(url, false)).status).toBe(401);
  for (const bad of [url + "&extra=1", url + "&currency=USD", url.replace("2026-10-05", "2026-02-30"),
    url.replace("2026-10-05", "2025-01-01"), url.replace("2026-10-05", "2026-10-12"),
    url.replace("Europe%2FHelsinki", "InvalidZone"), url.replace("currency=EUR", "currency=eur")]) {
    expect((await get(bad)).status).toBe(400);
  }
  const post = await worker.fetch(new Request(url, { method: "POST", headers: {
    Authorization: "Bearer test-only-economic-ledger" }, body: "{}" }), env as Env);
  expect(post.status).toBe(405);
});
it("reports exact dated cash and native spend without double counting revisions", async () => {
  const money = (env as Env).MONEY;
  const stub = money.get(money.idFromName("private-operator"));
  await runInDurableObject(stub, async (_instance, state) => {
    const sql = state.storage.sql;
    for (const [id, amount, day] of [["before", 900, "2026-10-04"], ["included", 1000, "2026-10-07"],
      ["after", 700, "2026-10-12"]] as const) {
      sql.exec("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "period-test", "unit-source", id, "subscription_receipt", amount, "EUR", null,
        day + "T12:00:00.000Z", "{}");
    }
    for (const [rev, amount] of [[1, "1000001"], [2, "2000001"]] as const) {
      sql.exec("INSERT INTO google_cost_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "1234567890", "123", "2026-10-07", rev, "period-test", "EUR", "Europe/Helsinki", amount,
        "2026-10-08T12:00:00.000Z");
    }
    sql.exec("INSERT INTO meta_cost_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "1234567890123456", "456", "2026-10-07", 1, "period-test", "EUR", "Europe/Helsinki", "100", "2026-10-08T12:00:00.000Z");
  });
  const response = await get();
  expect(await response.json()).toMatchObject({
    money_in: { observed_receipts_minor: "1000", observed_net_receipts_minor: "1000" },
    money_out: { observed_spend_micros: "3000001", source_reports: [
      { platform: "google", rows: [{ revision: 2, spend_micros: "2000001" }] },
      { platform: "meta", observed_spend_micros: "1000000" },
    ] }, observed_difference_micros: "6999999", coverage: { complete: false },
  });
  await runInDurableObject(stub, async (_instance, state) => {
    expect(state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM observations").toArray()[0].n).toBe(3);
    expect(state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM google_cost_revisions").toArray()[0].n).toBe(2);
  });
});
it("does not combine another account timezone as the same UTC reporting period", () => {
  const result = summarizeEconomicPeriod(period(), { observations: [observation("r", "subscription_receipt", 1000)],
    costs: [cost(), cost("meta", "100", "Asia/Singapore")] });
  expect(result).toMatchObject({ money_out: { status: "incomparable_time_zones", observed_spend_micros: null,
    source_reports: [{ comparable: true }, { comparable: false, time_zone: "Asia/Singapore" }] },
    observed_difference_micros: null,
    coverage: { reasons: expect.arrayContaining(["native_daily_buckets_have_different_time_zone"]) },
  });
});
it("applies timezone rules at both boundaries of a daylight-saving change", () => {
  const p = { ...period(), from: "2026-10-25", to: "2026-10-25" };
  const result = summarizeEconomicPeriod(p, { observations: [
    observation("before", "subscription_receipt", 1, "2026-10-24T20:59:59.000Z"),
    observation("first", "subscription_receipt", 2, "2026-10-24T21:00:00.000Z"),
    observation("last", "subscription_receipt", 4, "2026-10-25T21:59:59.999Z"),
    observation("after", "subscription_receipt", 8, "2026-10-25T22:00:00.000Z"),
  ], costs: [] });
  expect(result).toMatchObject({ money_in: { observed_receipts_minor: "6",
    observations: [{ event_id: "first" }, { event_id: "last" }] }, observed_difference_micros: null });
});
it("keeps refunds and credits separate and preserves sub-minor Google precision", () => {
  const result = summarizeEconomicPeriod(period(), { observations: [
    observation("receipt", "subscription_receipt", 1000), observation("refund", "subscription_refund", 250),
    observation("spend", "ad_spend", 200), observation("credit", "ad_credit", 50),
  ], costs: [cost()] });
  expect(result).toMatchObject({ money_in: { observed_receipts_minor: "1000", observed_refunds_minor: "250",
    observed_net_receipts_minor: "750" }, money_out: { manual_spend_minor: "200", manual_credits_minor: "50",
    observed_spend_micros: "2500001" }, observed_difference_micros: "4999999" });
});
it("preserves exact totals beyond Number precision without rounding or overflow", () => {
  const result = summarizeEconomicPeriod(period(), { observations: [
    observation("a", "subscription_receipt", Number.MAX_SAFE_INTEGER), observation("b", "subscription_receipt", 1),
    observation("c", "subscription_refund", Number.MAX_SAFE_INTEGER),
  ], costs: [cost("google", "1")] });
  expect(result).toMatchObject({ money_in: { observed_receipts_minor: "9007199254740992", observed_net_receipts_minor: "1" },
    observed_difference_micros: "9999" });
});
it("scales zero-decimal currencies using their currency unit without adding an FX conversion", () => {
  expect(summarizeEconomicPeriod({ ...period(), currency: "JPY" }, {
    observations: [observation("cash", "subscription_receipt", 10)], costs: [cost("meta", "3")],
  })).toMatchObject({ currency: "JPY", money_out: { observed_spend_micros: "3000000" }, observed_difference_micros: "7000000" });
});
it("distinguishes a measured net zero from missing evidence without claiming completeness", () => {
  expect(summarizeEconomicPeriod(period(), { observations: [observation("cash", "subscription_receipt", 100)],
    costs: [cost("google", "1000000")] })).toMatchObject({
    observed_difference_micros: "0", coverage: { complete: false, verified_zero: false },
    money_in: { status: "observed_incomplete" },
  });
});
it("refuses duplicate source days and invalid stored monetary values", () => {
  expect(() => summarizeEconomicPeriod(period(), { observations: [], costs: [cost(), cost()] })).toThrow("economic_duplicate_source_day");
  expect(() => summarizeEconomicPeriod(period(), { observations: [observation("bad", "subscription_receipt", 0.1)], costs: [] })).toThrow("economic_invalid_stored_money");
});
it("leaves the all-time economic endpoint unchanged", async () => {
  const response = await get("https://adslop.test/v1/economics?product_id=period-test&currency=EUR");
  expect(await response.json()).toMatchObject({ subscription_revenue_minor: 0,
    advertising_spend_minor: 0, difference_minor: 0, coverage: "not_verified", attribution: "none" });
});
