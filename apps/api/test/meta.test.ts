import { env } from "cloudflare:workers";
import worker, { type Env } from "../src/index";
import { exactMetaMinor, handleMetaRequest } from "../src/meta";
import { afterEach, expect, it, vi } from "vitest";

const base = "https://adslop.test";
const token = "meta-protocol-test-only-token";
const id = "1234567890";

afterEach(() => vi.unstubAllGlobals());

function account() {
  return {
    id: "act_" + id, name: "Protocol fixture account", currency: "USD",
    timezone_name: "America/New_York", account_status: 1,
  };
}

function stubGraph(handler: (url: URL) => Response | Promise<Response>) {
  const spy = vi.fn(async (target: URL | RequestInfo, init?: RequestInit) => {
    // Exercise native Workers option validation before simulating Graph replies.
    new Request(target, init);
    const url = new URL(target instanceof URL ? target.href :
      typeof target === "string" ? target : target.url);
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname.startsWith("/v25.0/")).toBe(true);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer " + token);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(url.searchParams.has("access_token")).toBe(false);
    return handler(url);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

it("rejects Graph redirects without forwarding credentials", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const requests = stubGraph(() => Response.redirect("https://attacker.example/collect", status));
    const reply = await handleMetaRequest(new URL(base + "/v1/meta/accounts"), token);
    expect(reply.status).toBe(502);
    expect(await reply.json()).toEqual({ error: "meta_upstream_failed" });
    expect(requests).toHaveBeenCalledTimes(1);
  }
});

it("returns exact daily Meta spend without counting breakdowns twice", async () => {
  const seen: string[] = [];
  stubGraph((url) => {
    if (url.pathname === "/v25.0/act_" + id) return Response.json(account());
    if (url.pathname !== "/v25.0/act_" + id + "/insights") {
      throw new Error("unexpected Graph resource");
    }
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(url.searchParams.get("time_range") ?? "null")).toEqual({
      since: "2026-09-10", until: "2026-09-11",
    });
    const level = url.searchParams.get("level");
    seen.push(level ?? "");
    if (level === "account") return Response.json({ data: [
      {
        account_id: id, date_start: "2026-09-10", date_stop: "2026-09-10",
        spend: "4.05", impressions: "100", clicks: "6",
      },
      {
        account_id: id, date_start: "2026-09-11", date_stop: "2026-09-11",
        spend: "0.95", impressions: "20", clicks: "1",
      },
    ] });
    if (level === "campaign") return Response.json({ data: [{
      account_id: id, campaign_id: "777", campaign_name: "Protocol fixture campaign",
      date_start: "2026-09-10", date_stop: "2026-09-10",
      spend: "3.04", impressions: "80", clicks: "5",
    }] });
    throw new Error("unexpected insights level");
  });
  const result = await handleMetaRequest(new URL(
    base + "/v1/meta/spend?account_id=" + id +
    "&since=2026-09-10&until=2026-09-11&level=campaign"
  ), token);
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  expect(await result.json()).toMatchObject({
    account: {
      account_id: id, name: "Protocol fixture account", currency: "USD",
      timezone_name: "America/New_York",
    },
    level: "campaign",
    account_spend_minor: "500",
    rows: [{ entity_id: "777", spend_minor: "304",
      date_start: "2026-09-10", date_stop: "2026-09-10" }],
    source: "meta_insights",
    graph_version: "v25.0", observed_at: expect.any(String),
    imported_to_ledger: false,
    breakdowns_additive_with_account: false,
    reporting: "platform_reported_not_billing_settlement",
  });
  expect(seen).toEqual(["account", "campaign"]);
  expect(exactMetaMinor("9007199254740993.01", "USD").toString())
    .toBe("900719925474099301");
  expect(exactMetaMinor("1.234", "KWD")).toBe(1234n);
  expect(exactMetaMinor("43", "JPY")).toBe(43n);
});

it("follows Meta pagination only on the expected Graph resource", async () => {
  const calls = stubGraph((url) => {
    if (url.searchParams.has("after")) {
      expect(url.searchParams.get("after")).toBe("second-page");
      return Response.json({ data: [{
        ...account(), id: "act_888",
      }] });
    }
    return Response.json({
      data: [account()],
      paging: { next: "https://graph.facebook.com/v25.0/me/adaccounts?" +
        "after=second-page&access_token=secret-which-must-not-travel" },
    });
  });
  const result = await handleMetaRequest(new URL(base + "/v1/meta/accounts"), token);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    accounts: [{ account_id: id }, { account_id: "888" }],
    imported_to_ledger: false,
  });
  expect(calls).toHaveBeenCalledTimes(2);

  const malicious = stubGraph(() => Response.json({
    data: [account()],
    paging: { next: "https://attacker.example/collect?access_token=leak" },
  }));
  const bad = await handleMetaRequest(new URL(base + "/v1/meta/accounts"), token);
  expect(bad.status).toBe(502);
  expect(await bad.json()).toEqual({ error: "meta_invalid_page" });
  expect(malicious).toHaveBeenCalledTimes(1);

  const repeated = stubGraph((url) => Response.json({
    data: [account()],
    paging: { next: url.toString() },
  }));
  const loop = await handleMetaRequest(new URL(base + "/v1/meta/accounts"), token);
  expect(loop.status).toBe(502);
  expect(await loop.json()).toEqual({ error: "meta_paging_loop" });
  expect(repeated).toHaveBeenCalledTimes(1);
});

it("rejects invalid authentication date and monetary inputs", async () => {
  const disconnected = await handleMetaRequest(
    new URL(base + "/v1/meta/accounts"), undefined
  );
  expect(disconnected.status).toBe(503);
  expect(await disconnected.json()).toEqual({ error: "meta_not_configured" });

  for (const query of [
    "account_id=bad&since=2026-09-10&until=2026-09-11",
    "account_id=" + id + "&since=2026-02-30&until=2026-03-01",
    "account_id=" + id + "&since=2026-10-10&until=2026-10-09",
    "account_id=" + id + "&since=2026-09-01&until=2026-10-03",
    "account_id=" + id + "&since=2026-09-01&until=2026-09-02&level=placement",
    "account_id=" + id + "&since=2026-09-01&until=2026-09-02&level=ad&level=ad",
  ]) {
    const result = await handleMetaRequest(new URL(base + "/v1/meta/spend?" + query), token);
    expect(result.status).toBe(400);
  }
  expect(() => exactMetaMinor("1.001", "USD")).toThrowError("meta_invalid_money");
  expect(() => exactMetaMinor("-0.01", "USD")).toThrowError("meta_invalid_money");
  expect(() => exactMetaMinor("1e2", "USD")).toThrowError("meta_invalid_money");

  const graph = stubGraph((url) => {
    if (url.pathname === "/v25.0/act_" + id) return Response.json(account());
    return Response.json({ data: [{
      account_id: id, date_start: "2026-09-10", date_stop: "2026-09-10",
      spend: "12.345", impressions: "10", clicks: "1",
    }] });
  });
  const invalidMoney = await handleMetaRequest(new URL(
    base + "/v1/meta/spend?account_id=" + id + "&since=2026-09-10&until=2026-09-10"
  ), token);
  expect(invalidMoney.status).toBe(502);
  expect(await invalidMoney.json()).toEqual({ error: "meta_invalid_money" });
  expect(graph).toHaveBeenCalledTimes(2);
});

it("keeps Meta routes behind the existing operator authorization", async () => {
  const unauthorized = await worker.fetch(new Request(base + "/v1/meta/accounts"),
    env as Env);
  expect(unauthorized.status).toBe(401);
  const disconnected = await worker.fetch(new Request(base + "/v1/meta/accounts", {
    headers: { Authorization: "Bearer test-only-economic-ledger" },
  }), env as Env);
  expect(disconnected.status).toBe(503);
  expect(await disconnected.json()).toEqual({ error: "meta_not_configured" });
});

it("rejects overlapping Meta account-day rows instead of double-counting spend", async () => {
  const row = {
    account_id: id, date_start: "2026-09-10", date_stop: "2026-09-10",
    spend: "11.20", impressions: "2", clicks: "0",
  };
  const seen = stubGraph((url) => {
    if (url.pathname === "/v25.0/act_" + id) return Response.json(account());
    if (url.searchParams.get("after") === "overlapping-page") {
      return Response.json({ data: [row] });
    }
    return Response.json({
      data: [row],
      paging: { next: "https://graph.facebook.com/v25.0/act_" + id +
        "/insights?after=overlapping-page" },
    });
  });
  const result = await handleMetaRequest(new URL(base + "/v1/meta/spend?" +
    "account_id=" + id + "&since=2026-09-10&until=2026-09-10"
  ), token);
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ error: "meta_duplicate_row" });
  expect(seen).toHaveBeenCalledTimes(3);
});

it("classifies malformed source IDs and dates as upstream errors, not caller errors", async () => {
  stubGraph(() => Response.json({ data: [{
    ...account(), id: "act_bad_upstream_id",
  }] }));
  const invalidSourceId = await handleMetaRequest(
    new URL(base + "/v1/meta/accounts"), token
  );
  expect(invalidSourceId.status).toBe(502);
  expect(await invalidSourceId.json()).toEqual({ error: "meta_invalid_response" });

  stubGraph((url) => {
    if (url.pathname === "/v25.0/act_" + id) return Response.json(account());
    return Response.json({ data: [{
      account_id: id, date_start: "2026-02-30", date_stop: "2026-02-30",
      spend: "1.00", impressions: "2", clicks: "0",
    }] });
  });
  const invalidSourceDate = await handleMetaRequest(new URL(base +
    "/v1/meta/spend?account_id=" + id + "&since=2026-02-01&until=2026-03-01"
  ), token);
  expect(invalidSourceDate.status).toBe(502);
  expect(await invalidSourceDate.json()).toEqual({ error: "meta_invalid_response" });
});
