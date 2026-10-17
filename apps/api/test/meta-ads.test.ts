import { env } from "cloudflare:workers";
import { runInDurableObject, evictAllDurableObjects } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const account = "123456789012345", page = "101", campaign = "201", adset = "301", creative = "401", ad = "501";
const hash = "a".repeat(32), base = "https://adslop.test/v1/meta/accounts/" + account;
const body = { name: "Product fixture", campaign_id: campaign, adset_id: adset, page_id: page,
  image_hash: hash, final_url: "https://example.org/", primary_text: "Product information.",
  headline: "Explore the product", description: "Read the product description.",
  parent_expectation: { daily_budget_minor: "500", countries: ["US"], interest_ids: ["7001"] } };
const auth = "Bearer test-only-economic-ledger";
async function api(method: string, path: string, data?: unknown, key = "operation-one", token = "fixture-meta") {
  return worker.fetch(new Request(base + path, { method, headers: {
    Authorization: auth, "Idempotency-Key": key,
  }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }), { ...env, META_ACCESS_TOKEN: token } as Env);
}
type Obj = Record<string, unknown>;
function mock(options: { missingPage?: boolean; missingImage?: boolean; badCreative?: boolean;
  activeParent?: boolean; wrongAccount?: boolean; adFailure?: boolean; readFailure?: boolean;
  paged?: boolean; deny?: boolean; pagesDenied?: boolean; unsafeNext?: boolean;
  pageTasks?: unknown; promotionEligible?: unknown; wrongPage?: boolean;
  creativeName?: string; creativeAccount?: string; creativeIdentity?: string; creativeStory?: Obj;
  assetFeed?: Obj; adName?: string; activeAfterCreativeRead?: boolean; targeting?: Obj;
  beforeCreative?: () => Promise<void>; beforeAd?: () => Promise<void> } = {}) {
  const calls: Array<{ path: string; method: string; params: Record<string, string> }> = [];
  const mutations: string[] = [];
  let story: Obj = { page_id: page, link_data: { link: body.final_url, image_hash: hash,
    message: body.primary_text, name: body.headline, description: body.description,
    call_to_action: { type: "LEARN_MORE", value: { link: body.final_url } } } };
  let creativeName = options.creativeName ?? body.name, creativeRead = false;
  const fake = vi.fn(async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(resource)), path = url.pathname.replace("/v25.0/", "");
    const method = init?.method ?? "GET";
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-meta");
    expect(url.searchParams.has("access_token")).toBe(false);
    const params = Object.fromEntries(method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body)));
    calls.push({ path, method, params });
    if (options.deny) return Response.json({ error: { code: 190, error_subcode: 463,
      fbtrace_id: "trace-fixture", message: "fixture-meta should never be returned" } }, { status: 400 });
    if (method === "POST") {
      mutations.push(path);
      expect(params.status).not.toBe("ACTIVE");
      if (path.endsWith("/adimages")) return Response.json({ images: { uploaded: { hash } } });
      if (path.endsWith("/adcreatives")) {
        if (options.beforeCreative) await options.beforeCreative();
        story = JSON.parse(params.object_story_spec) as Obj; creativeName = options.creativeName ?? params.name;
        return Response.json({ id: creative });
      }
      if (path.endsWith("/ads")) {
        if (options.beforeAd) await options.beforeAd();
        expect(params.status).toBe("PAUSED");
        expect(params.adset_id).toBe(adset);
        expect(JSON.parse(params.creative)).toEqual({ creative_id: creative });
        if (options.adFailure) return Response.json({ error: "upstream" }, { status: 503 });
        return Response.json({ id: ad });
      }
    }
    if (path === "act_" + account) return Response.json({ id: "act_" + account,
      account_id: account, name: "Fixture account", currency: "USD", timezone_name: "UTC" });
    if (path.endsWith("/promote_pages")) return Response.json({ data: [] });
    if (path === "me/accounts") {
      expect(params.fields).toBe("id,name,link,tasks");
      expect(params.is_promotable).toBe("true");
      if (options.pagesDenied) return Response.json({ error: { code: 200, fbtrace_id: "page-trace" } }, { status: 403 });
      if (options.unsafeNext) return Response.json({ data: [], paging: {
        next: "https://unrelated.example.org/?access_token=never-follow", cursors: { after: "unsafe" },
      } });
      if (options.paged && !params.after) return Response.json({ data: [], paging: {
        next: url.origin + url.pathname + "?after=second&access_token=never-use-this", cursors: { after: "second" },
      } });
      return Response.json({ data: options.missingPage ? [] : [{ id: page, name: "Fixture page",
        tasks: Object.hasOwn(options, "pageTasks") ? options.pageTasks : ["ADVERTISE", "MANAGE"],
        link: "https://www.facebook.com/" + page, access_token: "never-return-page-token" }] });
    }
    if (path === page) return Response.json({ id: options.wrongPage ? "999" : page,
      promotion_eligible: Object.hasOwn(options, "promotionEligible") ? options.promotionEligible : true });
    if (path.endsWith("/adimages")) return Response.json({ data: options.missingImage ? [] : [{ hash,
      name: "Image fixture", width: 1200, height: 628, url: "https://example.org/image.png" }] });
    if (path.endsWith("/campaigns")) return Response.json({ data: [{ id: campaign, account_id: account,
      name: "Fixture campaign", status: "PAUSED", objective: "OUTCOME_TRAFFIC" }] });
    if (path.endsWith("/ads")) return Response.json({ data: [{ id: ad, account_id: account,
      campaign_id: campaign, adset_id: adset, name: body.name, status: "PAUSED", creative: { id: creative } }] });
    if (path.endsWith("/adcreatives")) return Response.json({ data: [{ id: creative, account_id: account,
      name: body.name, image_hash: hash, link_url: body.final_url }] });
    if (path === "me/permissions") return Response.json({ data: [
      { permission: "ads_read", status: "granted" }, { permission: "ads_management", status: "granted" },
    ] });
    if (path === campaign) return Response.json({ id: campaign, name: "Fixture campaign",
      account_id: options.wrongAccount ? "999" : account,
      status: options.activeParent || (options.activeAfterCreativeRead && creativeRead) ? "ACTIVE" : "PAUSED",
      objective: "OUTCOME_TRAFFIC", special_ad_categories: [] });
    if (path === adset) return Response.json({ id: adset, account_id: account, campaign_id: campaign,
      status: "PAUSED", daily_budget: "500", optimization_goal: "LINK_CLICKS", billing_event: "IMPRESSIONS",
      targeting: options.targeting ?? { geo_locations: { countries: ["US"] }, interests: [{ id: "7001" }] } });
    if (path === creative) {
      creativeRead = true;
      return Response.json({ id: options.creativeIdentity ?? creative, account_id: options.creativeAccount ?? account,
        name: creativeName, object_story_spec: options.creativeStory ?? (options.badCreative ? { ...story,
          link_data: { ...(story.link_data as Obj), link: "https://wrong.example.org/" } } : story),
        ...(params.fields.split(",").includes("asset_feed_spec") ? { asset_feed_spec: options.assetFeed } : {}) });
    }
    if (path === ad) {
      if (options.readFailure) return Response.json({ error: { code: 200, fbtrace_id: "trace-read" } }, { status: 403 });
      return Response.json({ id: ad, account_id: account, campaign_id: campaign, adset_id: adset,
        name: options.adName ?? body.name, status: "PAUSED", effective_status: "CAMPAIGN_PAUSED", creative: { id: creative } });
    }
    throw Error("Unexpected fixture path " + path);
  });
  vi.stubGlobal("fetch", fake);
  return { calls, mutations, fake };
}
beforeEach(async () => {
  // Only this journal is stateful here. Clear rows without destructively aborting disk callbacks.
  const namespace = (env as Env).MONEY;
  await runInDurableObject(namespace.get(namespace.idFromName("private-operator")), (_instance, state) => {
    state.storage.sql.exec("DELETE FROM meta_ad_operations").toArray();
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

it("discovers eligible Pages images and existing campaigns without exposing Page tokens", async () => {
  mock({ paged: true });
  const result = await api("GET", "/creative-assets");
  expect(result.status).toBe(200);
  const value = await result.json();
  expect(value).toMatchObject({ complete: true, pages: { status: "available", rows: [{ id: page }] },
    images: { rows: [{ hash }] }, permissions: { rows: [{ permission: "ads_read" }, { permission: "ads_management" }] } });
  expect(JSON.stringify(value)).not.toContain("never-return-page-token");
  expect(result.headers.get("Cache-Control")).toBe("no-store");
});
it("creates a paused ad only after verifying its Page image and paused parents", async () => {
  const native = mock();
  const first = await api("POST", "/paused-ads", body);
  expect(first.status).toBe(201);
  const value = await first.json();
  expect(value).toMatchObject({ status: "verified_paused", campaign_id: campaign, adset_id: adset,
    creative_id: creative, ad_id: ad, image_hash: hash, configuration_match: true,
    paid_delivery_authorized: false, launch_ready: false });
  expect(native.mutations).toEqual(["act_" + account + "/adcreatives", "act_" + account + "/ads"]);
  // No in-memory operation map: replay must also survive a complete actor eviction.
  await evictAllDurableObjects();
  const repeats = await api("POST", "/paused-ads", body);
  expect(await repeats.json()).toEqual(value);
  expect(native.mutations).toHaveLength(2);
  const conflict = await api("POST", "/paused-ads", { ...body, headline: "Different" });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: "meta_idempotency_conflict" });
  expect(native.mutations).toHaveLength(2);
  const readback = await api("GET", "/paused-ads/" + ad);
  expect(readback.status).toBe(200);
  expect(await readback.json()).toMatchObject({ status: "verified_paused", native: {
    campaign_id: campaign, adset_id: adset, ad_id: ad, creative: { final_url: body.final_url, page_id: page, image_hash: hash },
  } });
});
it("creates paused ads against normalized OR-interest parents", async () => {
  const targeting={geo_locations:{countries:["US"]},flexible_spec:[{interests:[{id:"7001"}]}],
    targeting_automation:{advantage_audience:1}};
  const native=mock({targeting});
  const result=await api("POST","/paused-ads",body);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({status:"verified_paused",configuration_match:true,
    native:{adset:{targeting}},paid_delivery_authorized:false,launch_ready:false});
  expect(native.mutations).toEqual(["act_"+account+"/adcreatives","act_"+account+"/ads"]);
  const readback=await api("GET","/paused-ads/"+ad);
  expect(readback.status).toBe(200);
  expect(await readback.json()).toMatchObject({native:{adset:{targeting}}});
});
it("blocks changed normalized interests before ad creation", async () => {
  const cases=[
    {countries:["US"],interests:[{id:"7002"}],budget:"500"},
    {countries:["US"],interests:[{id:"7001"},{id:"7002"}],budget:"500"},
    {countries:["CA"],interests:[{id:"7001"}],budget:"500"},
    {countries:["US"],interests:[{id:"7001"}],budget:"501"},
  ];
  for (const [index,item] of cases.entries()) {
    const native=mock({targeting:{geo_locations:{countries:item.countries},
      flexible_spec:[{interests:item.interests}]}});
    const result=await api("POST","/paused-ads",{...body,
      parent_expectation:{...body.parent_expectation,daily_budget_minor:item.budget}},"normalized-"+index);
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({paid_delivery_authorized:false});
    expect(native.mutations).toEqual([]);
  }
});
it("accepts a newly managed Page without promotion history", async () => {
  const native = mock({ paged: true, pageTasks: ["ADVERTISE"] });
  const inventory = await api("GET", "/creative-assets");
  expect(await inventory.json()).toMatchObject({ pages: {
    status: "available", rows: [{ id: page, tasks: ["ADVERTISE"] }],
  } });
  const result = await api("POST", "/paused-ads", body);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({ status: "verified_paused", ad_id: ad });
  expect(native.calls.some(v => v.path.endsWith("/promote_pages"))).toBe(false);
  expect(native.calls).toContainEqual({ path: page, method: "GET", params: { fields: "id,promotion_eligible" } });
  expect(native.mutations).toEqual(["act_" + account + "/adcreatives", "act_" + account + "/ads"]);
});
it("accepts provider-assigned creative metadata names", async () => {
  const nativeName = body.name + " 2026-10-17-provider-label";
  const native = mock({ creativeName: nativeName });
  const result = await api("POST", "/paused-ads", body);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({ configuration_match: true, native: {
    ad: { name: body.name }, creative: { name: nativeName, primary_text: body.primary_text, final_url: body.final_url },
  } });
  expect(native.mutations).toEqual(["act_" + account + "/adcreatives", "act_" + account + "/ads"]);
});
it("reuses a verified acknowledged creative without creating another", async () => {
  const native = mock({ creativeName: "Provider library name" });
  const recovery = { ...body, creative_id: creative };
  const first = await api("POST", "/paused-ads", recovery);
  expect(first.status).toBe(201);
  const value = await first.json();
  expect(value).toMatchObject({ status: "verified_paused", creative_id: creative, ad_id: ad,
    configuration_match: true, paid_delivery_authorized: false, native: {
      ad: { name: body.name }, creative: { id: creative, name: "Provider library name" },
    } });
  expect(native.mutations).toEqual(["act_" + account + "/ads"]);
  expect(native.calls.findIndex(v => v.path === creative)).toBeLessThan(native.calls.findIndex(v => v.method === "POST"));
  await evictAllDurableObjects();
  expect(await (await api("POST", "/paused-ads", recovery)).json()).toEqual(value);
  expect(await (await api("POST", "/paused-ads", { ...recovery, creative_id: "402" })).json())
    .toMatchObject({ error: "meta_idempotency_conflict" });
  expect(native.mutations).toHaveLength(1);
});
it("rejects mismatched recovery creatives before ad creation", async () => {
  const link = { link: body.final_url, image_hash: hash, message: body.primary_text, name: body.headline,
    description: body.description, call_to_action: { type: "LEARN_MORE", value: { link: body.final_url } } };
  const changes = [
    { creativeIdentity: "999" }, { creativeAccount: "999" },
    { creativeStory: { page_id: "999", link_data: link } },
    ...Object.entries({ link: "https://wrong.example.org/", image_hash: "b".repeat(32), message: "Different copy",
      name: "Different headline", description: "Different description",
      call_to_action: { type: "SHOP_NOW", value: { link: body.final_url } } })
      .map(([key, value]) => ({ creativeStory: { page_id: page, link_data: { ...link, [key]: value } } })),
    { creativeStory: { page_id: page, link_data: { ...link,
      call_to_action: { type: "LEARN_MORE", value: { link: "https://wrong.example.org/" } } } } },
    { assetFeed: { bodies: [{ text: "Alternate content" }] } },
  ];
  for (const [i, change] of changes.entries()) {
    const native = mock(change);
    const result = await api("POST", "/paused-ads", { ...body, creative_id: creative }, "recovery-mismatch-" + i);
    expect(result.status).toBe(409);
    const value = await result.json();
    expect(value).not.toHaveProperty("status");
    expect(value).not.toHaveProperty("creative_id");
    expect(native.mutations).toHaveLength(0);
  }
});
it("rechecks paused parents after validating a reused creative", async () => {
  const native = mock({ activeAfterCreativeRead: true });
  const result = await api("POST", "/paused-ads", { ...body, creative_id: creative });
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ creative_id: creative, paid_delivery_authorized: false });
  expect(native.mutations).toHaveLength(0);
});
it("keeps exact ad-name verification when creative metadata names differ", async () => {
  const native = mock({ creativeName: "Provider library name", adName: "Unexpected ad name" });
  const result = await api("POST", "/paused-ads", { ...body, creative_id: creative });
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: "meta_ad_readback_mismatch", status: "write_unverified",
    creative_id: creative, ad_id: ad });
  expect(native.mutations).toEqual(["act_" + account + "/ads"]);
});
it.each(["adFailure", "readFailure"] as const)("does not repeat a recovery ad write after %s", async flag => {
  const native = mock({ [flag]: true });
  const recovery = { ...body, creative_id: creative };
  const first = await api("POST", "/paused-ads", recovery);
  expect(first.status).toBe(flag === "adFailure" ? 502 : 403);
  const value = await first.json();
  expect(value).toMatchObject({ status: "write_unverified", creative_id: creative });
  await evictAllDurableObjects();
  expect(await (await api("POST", "/paused-ads", recovery)).json()).toEqual(value);
  expect(native.mutations).toEqual(["act_" + account + "/ads"]);
});
it("rejects missing Page advertising authority before native writes", async () => {
  for (const [i, tasks] of [["ANALYZE"], [], undefined, null, [1]].entries()) {
    const native = mock({ pageTasks: tasks });
    const result = await api("POST", "/paused-ads", body, "page-authority-" + i);
    expect(result.status).toBe(i < 2 ? 403 : 502);
    expect(await result.json()).toMatchObject({ error: i < 2 ? "meta_page_not_authorized_for_account" : "meta_invalid_native_response" });
    expect(native.mutations).toHaveLength(0);
  }
});
it("rejects false or unknown Page promotion eligibility before native writes", async () => {
  for (const [i, eligible] of [false, undefined, null, "true"].entries()) {
    const native = mock({ promotionEligible: eligible });
    const result = await api("POST", "/paused-ads", body, "page-eligibility-" + i);
    expect(result.status).toBe(i === 0 ? 409 : 502);
    expect(await result.json()).toMatchObject({ error: i === 0 ? "meta_page_not_promotion_eligible" : "meta_page_promotion_eligibility_unavailable" });
    expect(native.mutations).toHaveLength(0);
  }
  const native = mock({ wrongPage: true });
  expect((await api("POST", "/paused-ads", body, "wrong-page-identity")).status).toBe(409);
  expect(native.mutations).toHaveLength(0);
});
it("rejects unsafe inputs before contacting Meta", async () => {
  const native = mock();
  const invalid = [ { ...body, status: "ACTIVE" }, { ...body, final_url: "http://example.org/" },
    { ...body, page_id: "untrusted" }, { ...body, final_url: "https://name:password@example.org/" },
    { ...body, parent_expectation: { ...body.parent_expectation, countries: ["US", "US"] } },
    { ...body, parent_expectation: { ...body.parent_expectation, daily_budget_minor: 500 } },
    ...[null, 401, "", "0401", "401?fields=id", "1".repeat(33)].map(creative_id => ({ ...body, creative_id })),
  ];
  for (const [i, payload] of invalid.entries()) expect((await api("POST", "/paused-ads", payload, "bad" + i)).status).toBe(400);
  expect(native.fake).not.toHaveBeenCalled();
});
it.each(["missingPage", "missingImage", "activeParent", "wrongAccount"] as const)("prevents any creative write when %s", async flag => {
  const native = mock({ [flag]: true });
  const result = await api("POST", "/paused-ads", body);
  expect([403, 409]).toContain(result.status);
  expect(native.mutations).toHaveLength(0);
});
it("retains the creative ID when native copy differs and never creates an ad", async () => {
  const native = mock({ badCreative: true });
  const result = await api("POST", "/paused-ads", body);
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ status: "write_unverified", creative_id: creative,
    error: "meta_ad_readback_mismatch", paid_delivery_authorized: false });
  expect(native.mutations).toHaveLength(1);
});
it("does not resend an ambiguous ad write when the same operation is repeated", async () => {
  const native = mock({ adFailure: true });
  const first = await api("POST", "/paused-ads", body);
  expect(first.status).toBe(502);
  const value = await first.json();
  expect(value).toMatchObject({ status: "write_unverified", creative_id: creative });
  expect(value).not.toHaveProperty("ad_id");
  expect(await (await api("POST", "/paused-ads", body)).json()).toEqual(value);
  expect(native.mutations).toHaveLength(2);
});
it("preserves every acknowledged native ID after failed final readback", async () => {
  mock({ readFailure: true });
  const result = await api("POST", "/paused-ads", body);
  expect(result.status).toBe(403);
  expect(await result.json()).toMatchObject({ status: "write_unverified", campaign_id: campaign,
    adset_id: adset, creative_id: creative, ad_id: ad, upstream_code: 200, request_id: "trace-read" });
});
it("uploads bounded PNG data and independently verifies the account image hash", async () => {
  const native = mock();
  // A minimal image fixture for transport, not invented advertising or financial evidence.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5i8AAAAASUVORK5CYII=";
  const result = await api("POST", "/images", { image_base64: png });
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({ status: "verified_image", image_hash: hash,
    source_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), paid_delivery_authorized: false });
  expect(native.mutations).toEqual(["act_" + account + "/adimages"]);
  expect((await api("POST", "/images", { image_base64: "invalid" }, "other-image")).status).toBe(400);
  expect(native.mutations).toHaveLength(1);
});
it("reports native permission codes without including secret-bearing error messages", async () => {
  mock({ deny: true });
  const result = await api("POST", "/paused-ads", body);
  expect(result.status).toBe(502);
  const value = await result.json();
  expect(value).toMatchObject({ error: "meta_access_denied", upstream_code: 190, upstream_subcode: 463, request_id: "trace-fixture" });
  expect(JSON.stringify(value)).not.toContain("fixture-meta");
});
it("keeps new Meta ad routes behind operator authorization", async () => {
  const native = mock();
  for (const path of ["/creative-assets", "/images", "/paused-ads", "/paused-ads/" + ad]) {
    const res = await worker.fetch(new Request(base + path), { ...env, META_ACCESS_TOKEN: "fixture-meta" } as Env);
    expect(res.status).toBe(401);
  }
  const missingKey = await worker.fetch(new Request(base + "/paused-ads", { method: "POST",
    body: JSON.stringify(body), headers: { Authorization: auth } }), { ...env, META_ACCESS_TOKEN: "fixture-meta" } as Env);
  expect(missingKey.status).toBe(400);
  expect(await missingKey.json()).toMatchObject({ error: "meta_idempotency_key_required" });
  expect(native.fake).not.toHaveBeenCalled();
});

it("returns explicit partial discovery when Page entitlement is unavailable", async () => {
  mock({ pagesDenied: true });
  const result = await api("GET", "/creative-assets");
  expect(result.status).toBe(200);
  const value = await result.json();
  expect(value).toMatchObject({ complete: false, pages: { status: "unavailable", error: "meta_access_denied",
    upstream_code: 200, request_id: "page-trace" }, images: { status: "available" } });
  expect(value).not.toHaveProperty("pages.rows");
});
it("rejects an off-origin paging destination without sending credentials there", async () => {
  const native = mock({ unsafeNext: true });
  const result = await api("GET", "/creative-assets");
  expect(await result.json()).toMatchObject({ complete: false, pages: {
    status: "unavailable", error: "meta_invalid_asset_page" } });
  expect(native.calls.filter(v => v.path === "me/accounts")).toHaveLength(1);
});
it("serializes duplicate requests while a native write is pending", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const native = mock({ beforeCreative: async () => { entered(); await wait; } });
  const first = api("POST", "/paused-ads", body);
  await started;
  const concurrent = await api("POST", "/paused-ads", body);
  expect(concurrent.status).toBe(409);
  expect(await concurrent.json()).toMatchObject({ error: "meta_operation_incomplete", status: "write_unverified" });
  expect(native.mutations).toHaveLength(1);
  release();
  expect((await first).status).toBe(201);
  expect(native.mutations).toHaveLength(2);
  expect((await api("POST", "/paused-ads", body)).status).toBe(201);
  expect(native.mutations).toHaveLength(2);
});

it("retains the acknowledged creative identity during a pending ad write", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const native = mock({ beforeAd: async () => { entered(); await wait; } });
  const first = api("POST", "/paused-ads", body);
  await started;
  const pending = await api("POST", "/paused-ads", body);
  expect(pending.status).toBe(409);
  expect(await pending.json()).toMatchObject({ status: "write_unverified", error: "meta_operation_incomplete",
    campaign_id: campaign, adset_id: adset, creative_id: creative, image_hash: hash });
  release();
  expect((await first).status).toBe(201);
  expect(native.mutations).toHaveLength(2);
});

it.each([401, 403, 429])("preserves native HTTP %i when an upstream body is not JSON", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));
  const result = await api("POST", "/paused-ads", body);
  expect(result.status).toBe(status);
  expect(await result.json()).toMatchObject({ error: status === 429 ? "meta_rate_limited" : "meta_access_denied",
    paid_delivery_authorized: false });
});
