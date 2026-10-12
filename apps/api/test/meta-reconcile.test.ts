import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const base = "https://adslop.test";
const account = "1234567890";
const product = "meta-native-fixture";
const period = { since: "2026-10-08", until: "2026-10-08" };
const path = "/v1/meta/accounts/" + account;
const mapping = {
  product_id: product, ...period, campaign_ids: ["101"],
};

async function api(endpoint: string, body?: object, authorized = true): Promise<Response> {
  return worker.fetch(new Request(base + endpoint, {
    method: body ? "POST" : "GET",
    headers: authorized ? { Authorization: "Bearer test-only-economic-ledger" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), { ...env, META_ACCESS_TOKEN: "meta-fixture-token" } as Env);
}

const report = (body: object = mapping) => api(path + "/reconcile", body);
const history = () => api(path + "/revisions");
const economics = (item = product) =>
  api("/v1/economics?product_id=" + item + "&currency=EUR");

type NativeFixture = {
  one?: string;
  two?: string | null;
  baseline?: string;
  oneDate?: string;
  accountDate?: string;
  range?: { since: string; until: string };
  additionalDay?: string | null;
};

function native(options: NativeFixture = {}) {
  const one = options.one ?? "5.01";
  const two = options.two === undefined ? "4.00" : options.two;
  const date = options.oneDate ?? "2026-10-08";
  const accountDate = options.accountDate ?? date;
  const extra = options.additionalDay;
  const total = options.baseline ?? (
    BigInt(one.replace(".", "")) +
    (two === null ? 0n : BigInt(two.replace(".", ""))) +
    (extra ? BigInt(extra.replace(".", "")) : 0n)
  ).toString();
  const amount = options.baseline ?? (BigInt(total) / 100n).toString() +
    "." + (BigInt(total) % 100n).toString().padStart(2, "0");
  const seen: string[] = [];

  vi.stubGlobal("fetch", vi.fn(async (target: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(target));
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer meta-fixture-token");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(url.pathname.startsWith("/v25.0/")).toBe(true);
    if (url.pathname === "/v25.0/act_" + account) {
      return Response.json({
        id: "act_" + account, name: "Protocol-only fixture account",
        currency: "EUR", timezone_name: "Europe/Helsinki", account_status: 1,
      });
    }
    if (url.pathname !== "/v25.0/act_" + account + "/insights") {
      throw Error("Unexpected Meta fixture endpoint");
    }
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(url.searchParams.get("time_range") ?? "null")).toEqual(options.range ?? period);
    const level = url.searchParams.get("level");
    seen.push(level ?? "");
    if (level === "account") return Response.json({ data: [
      { account_id: account, date_start: accountDate, date_stop: accountDate,
        spend: amount, impressions: "10", clicks: "2" },
    ] });
    if (level === "campaign") {
      const rows = [
        { account_id: account, campaign_id: "101",
          campaign_name: "Protocol campaign one", date_start: date, date_stop: date,
          spend: one, impressions: "7", clicks: "1" },
        ...(two === null ? [] : [{
          account_id: account, campaign_id: "202",
          campaign_name: "Protocol campaign two", date_start: date, date_stop: date,
          spend: two, impressions: "3", clicks: "1" },
        ]),
        ...(extra === null || extra === undefined ? [] : [{
          account_id: account, campaign_id: "101",
          campaign_name: "Protocol campaign one", date_start: "2026-10-09",
          date_stop: "2026-10-09",
          spend: extra, impressions: "8", clicks: "1",
        }]),
      ];
      return Response.json({ data: rows });
    }
    throw Error("Unexpected Meta fixture reporting level");
  }));
  return seen;
}

beforeEach(async () => { await reset(); });
afterEach(() => { vi.unstubAllGlobals(); });

it("reconciles Meta campaign-day costs and keeps corrected spend idempotent", async () => {
  const called = native();
  expect((await api("/v1/observations", {
    product_id: product, source: "commerce-fixture", event_id: "paid",
    kind: "subscription_receipt", amount_minor: 1200,
    currency: "EUR", channel: null, occurred_at: "2026-10-08T12:00:00Z",
  })).status).toBe(201);

  const created = await report();
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({
    created: 1, corrected: 0, duplicate: 0,
    source_account_spend_minor: "901",
    selected_campaign_spend_minor: "501",
    currency: "EUR", timezone_name: "Europe/Helsinki",
    campaign_ids: ["101"],
  });
  expect(called).toEqual(["account", "campaign"]);
  const again = await report();
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ created: 0, corrected: 0, duplicate: 1 });
  expect((await (await economics()).json())).toMatchObject({
    subscription_revenue_minor: 1200, advertising_spend_minor: 501,
    difference_minor: 699,
    advertising_spend_micros: "5010000", difference_micros: "6990000",
    advertising_spend_by_channel_minor: { meta: 501, google: 0 },
    evidence: "admitted_observations_and_meta_ads_daily_revisions",
  });

  vi.unstubAllGlobals();
  native({ one: "5.31" });
  const corrected = await report();
  expect(corrected.status).toBe(200);
  expect(await corrected.json()).toMatchObject({
    created: 0, corrected: 1, duplicate: 0, selected_campaign_spend_minor: "531",
  });
  expect((await (await economics()).json())).toMatchObject({
    advertising_spend_minor: 531, difference_minor: 669,
    advertising_spend_by_channel_minor: { meta: 531 },
  });
  expect((await (await history()).json())).toMatchObject({
    revisions: [
      { campaign_id: "101", local_date: period.since, revision: 1, spend_minor: "501" },
      { campaign_id: "101", local_date: period.since, revision: 2, spend_minor: "531" },
    ],
  });
});

it("rejects report-total breaks without changing ledger money", async () => {
  native({ baseline: "10.00" });
  const broken = await report();
  expect(broken.status).toBe(409);
  expect(await broken.json()).toEqual({ error: "meta_account_campaign_spend_break" });
  expect((await (await history()).json())).toEqual({ account_id: account, revisions: [] });
  expect((await (await economics()).json())).toMatchObject({
    advertising_spend_minor: 0, difference_minor: 0,
  });
});

it("prevents conflicting product mappings and mixed manual Meta spend", async () => {
  native();
  expect((await report()).status).toBe(201);
  const collision = await report({ ...mapping, product_id: "another-product" });
  expect(collision.status).toBe(409);
  expect(await collision.json()).toEqual({ error: "meta_source_identity_conflict" });

  const manual = await api("/v1/observations", {
    product_id: product, source: "manual-fixture", event_id: "possible-overlap",
    kind: "ad_spend", amount_minor: 20, currency: "EUR",
    channel: "meta", occurred_at: "2026-10-08T09:00:00Z",
  });
  expect(manual.status).toBe(409);
  expect(await manual.json()).toEqual({ error: "meta_manual_spend_overlap" });
  expect((await (await economics()).json())).toMatchObject({
    advertising_spend_minor: 501,
  });

  const manualFirst = await api("/v1/observations", {
    product_id: "manual-other", source: "manual-fixture", event_id: "already-spent",
    kind: "ad_spend", amount_minor: 40, currency: "EUR",
    channel: "meta", occurred_at: "2026-10-08T09:00:00Z",
  });
  expect(manualFirst.status).toBe(201);
  const importAfterManual = await report({
    ...mapping, product_id: "manual-other", campaign_ids: ["202"],
  });
  expect(importAfterManual.status).toBe(409);
  expect(await importAfterManual.json()).toEqual({ error: "meta_manual_spend_overlap" });
  expect((await (await economics("manual-other")).json())).toMatchObject({
    advertising_spend_minor: 40,
  });
});

it("preserves revisions and rejects omitted previously imported source days", async () => {
  const range = { since: "2026-10-08", until: "2026-10-09" };
  native({ two: null, additionalDay: "2.00", range });
  const original = await report({ ...mapping, ...range });
  expect(original.status).toBe(201);
  expect(await original.json()).toMatchObject({
    created: 2, selected_campaign_spend_minor: "701",
  });
  vi.unstubAllGlobals();
  native({ two: null, additionalDay: null, range });
  const omission = await report({ ...mapping, ...range });
  expect(omission.status).toBe(409);
  expect(await omission.json()).toEqual({ error: "meta_missing_prior_source_day" });
  expect((await (await history()).json())).toMatchObject({
    revisions: [
      { local_date: "2026-10-08", revision: 1, spend_minor: "501" },
      { local_date: "2026-10-09", revision: 1, spend_minor: "200" },
    ],
  });
  expect((await (await economics()).json())).toMatchObject({
    advertising_spend_minor: 701,
  });
});
