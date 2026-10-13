/** Page and image evidence, and pause-only Meta link ads with native readback. */
import { metaGraph, readPausedMetaScope, MetaCampaignError } from "./meta-campaigns";

type Obj = Record<string, unknown>;
type Identity = { account_id: string; campaign_id?: string; adset_id?: string;
  image_hash?: string; creative_id?: string; ad_id?: string };
const idPattern = /^[1-9][0-9]{0,31}$/;
const hashPattern = /^[a-f0-9]{32}$/;
const root = "https://graph.facebook.com/v25.0/";

function object(v: unknown, input = false): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new MetaCampaignError(input ? "meta_invalid_ad_input" : "meta_invalid_native_response", input ? 400 : 502);
  }
  return v as Obj;
}
function id(v: unknown): string {
  if (typeof v !== "string" || !idPattern.test(v)) throw new MetaCampaignError("meta_invalid_native_identity", 502);
  return v;
}
function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new MetaCampaignError("meta_ad_readback_mismatch", 409);
}
function text(v: unknown, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.trim() !== v || v.length > max || /[\u0000-\u001f]/.test(v)) {
    throw new MetaCampaignError("meta_invalid_ad_input", 400);
  }
  return v;
}
function fields(v: Obj, allowed: string[]): void {
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new MetaCampaignError("meta_unknown_ad_field", 400);
}
function array(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new MetaCampaignError("meta_invalid_native_response", 502);
  return v;
}
function sameSet(actual: unknown, expected: string[]): void {
  const values = array(actual);
  if (values.length !== expected.length || new Set(values).size !== values.length || expected.some(v => !values.includes(v))) {
    throw new MetaCampaignError("meta_ad_readback_mismatch", 409);
  }
}
function response(data: Obj, status = 200): Response {
  return Response.json({ ...data, observed_at: new Date().toISOString(), graph_version: "v25.0" },
    { status, headers: { "Cache-Control": "no-store" } });
}

/** Retain the selected edge/fields across pages; never follow an upstream token-bearing URL. */
async function rows(path: string, token: string, params: Record<string, string>): Promise<Obj[]> {
  const result: Obj[] = [], seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const reply = await metaGraph("GET", path, token, { ...params, limit: "100", ...(after ? { after } : {}) });
    result.push(...array(reply.data).map(v => object(v)));
    if (result.length > 2000) throw new MetaCampaignError("meta_asset_page_limit", 503);
    if (reply.paging === undefined) return result;
    const paging = object(reply.paging);
    if (paging.next === undefined || paging.next === null) return result;
    let next: URL;
    try { next = new URL(String(paging.next)); }
    catch { throw new MetaCampaignError("meta_invalid_asset_page", 502); }
    const initial = new URL(path, root);
    if (typeof paging.next !== "string" || next.origin !== initial.origin || next.pathname !== initial.pathname || next.username || next.password) {
      throw new MetaCampaignError("meta_invalid_asset_page", 502);
    }
    const cursor = object(paging.cursors).after;
    if (typeof cursor !== "string" || !cursor || cursor.length > 4096 || seen.has(cursor)) {
      throw new MetaCampaignError("meta_invalid_asset_cursor", 502);
    }
    seen.add(cursor); after = cursor;
  }
  throw new MetaCampaignError("meta_asset_page_limit", 503);
}
async function account(accountId: string, token: string): Promise<Obj> {
  const a = await metaGraph("GET", "act_" + accountId, token, { fields: "id,account_id,name,currency,timezone_name" });
  equal(a.id, "act_" + accountId); equal(a.account_id, accountId);
  return { account_id: accountId, name: a.name, currency: a.currency, time_zone: a.timezone_name };
}
async function pages(accountId: string, token: string): Promise<Obj[]> {
  return (await rows("act_" + accountId + "/promote_pages", token, { fields: "id,name,link" }))
    .map(p => ({ id: id(p.id), name: p.name, link: p.link }));
}
async function images(accountId: string, token: string, hash?: string): Promise<Obj[]> {
  return (await rows("act_" + accountId + "/adimages", token, {
    fields: "hash,name,width,height,url", ...(hash ? { hashes: JSON.stringify([hash]) } : {}),
  })).map(p => {
    if (typeof p.hash !== "string" || !hashPattern.test(p.hash)) throw new MetaCampaignError("meta_invalid_native_image", 502);
    return { hash: p.hash, name: p.name, width: p.width, height: p.height, url: p.url };
  });
}
async function image(accountId: string, token: string, hash: string): Promise<Obj> {
  const list = await images(accountId, token, hash);
  if (list.length !== 1 || list[0].hash !== hash) throw new MetaCampaignError("meta_image_not_in_account", 409);
  return list[0];
}
async function assets(accountId: string, token: string): Promise<Obj> {
  const current = await account(accountId, token);
  const result: Obj = { account: current, complete: true, source: "meta_graph", graph_version: "v25.0" };
  const reads: Array<[string, () => Promise<Obj[]>]> = [
    ["pages", () => pages(accountId, token)], ["images", () => images(accountId, token)],
    ["campaigns", async () => (await rows("act_" + accountId + "/campaigns", token,
      { fields: "id,account_id,name,status,objective" })).map(v => {
        equal(v.account_id, accountId);
        return { id: id(v.id), name: v.name, status: v.status, objective: v.objective };
      })],
    ["ads", async () => (await rows("act_" + accountId + "/ads", token,
      { fields: "id,account_id,campaign_id,adset_id,name,status,creative{id}" })).map(v => {
        equal(v.account_id, accountId);
        return { id: id(v.id), campaign_id: id(v.campaign_id), adset_id: id(v.adset_id),
          name: v.name, status: v.status, creative_id: id(object(v.creative).id) };
      })],
    ["creatives", async () => (await rows("act_" + accountId + "/adcreatives", token,
      { fields: "id,account_id,name,image_hash,link_url" })).map(v => {
        equal(v.account_id, accountId);
        return { id: id(v.id), name: v.name, image_hash: v.image_hash, link_url: v.link_url };
      })],
    ["permissions", async () => (await rows("me/permissions", token, {})).map(v =>
      ({ permission: v.permission, status: v.status }))],
  ];
  for (const [key, load] of reads) {
    try { result[key] = { status: "available", rows: await load() }; }
    catch (error) {
      if (!(error instanceof MetaCampaignError)) throw error;
      result.complete = false;
      result[key] = { status: "unavailable", error: error.code, ...error.source };
    }
  }
  return result;
}
function parseAd(input: unknown) {
  const v = object(input, true);
  fields(v, ["name", "campaign_id", "adset_id", "page_id", "image_hash", "final_url",
    "primary_text", "headline", "description", "parent_expectation"]);
  for (const key of ["campaign_id", "adset_id", "page_id"]) {
    if (typeof v[key] !== "string" || !idPattern.test(v[key])) throw new MetaCampaignError("meta_invalid_ad_input", 400);
  }
  if (typeof v.image_hash !== "string" || !hashPattern.test(v.image_hash)) throw new MetaCampaignError("meta_invalid_ad_input", 400);
  const link = text(v.final_url, 2048);
  let url: URL;
  try { url = new URL(link); } catch { throw new MetaCampaignError("meta_invalid_ad_destination", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.href !== link) throw new MetaCampaignError("meta_invalid_ad_destination", 400);
  const expected = object(v.parent_expectation, true);
  fields(expected, ["countries", "interest_ids", "daily_budget_minor"]);
  for (const [key, pattern, max] of [["countries", /^[A-Z]{2}$/, 10], ["interest_ids", idPattern, 15]] as const) {
    const items = expected[key];
    if (!Array.isArray(items) || !items.length || items.length > max || new Set(items).size !== items.length ||
        items.some(x => typeof x !== "string" || !pattern.test(x))) throw new MetaCampaignError("meta_invalid_parent_expectation", 400);
  }
  if (typeof expected.daily_budget_minor !== "string" || !/^[1-9][0-9]{0,9}$/.test(expected.daily_budget_minor)) {
    throw new MetaCampaignError("meta_invalid_parent_expectation", 400);
  }
  return { name: text(v.name, 128), campaign_id: v.campaign_id as string, adset_id: v.adset_id as string,
    page_id: v.page_id as string, image_hash: v.image_hash, final_url: link,
    primary_text: text(v.primary_text, 500), headline: text(v.headline, 80), description: text(v.description, 150),
    countries: expected.countries as string[], interests: expected.interest_ids as string[], budget: expected.daily_budget_minor };
}
type AdInput = ReturnType<typeof parseAd>;
function checkParents(scope: Awaited<ReturnType<typeof readPausedMetaScope>>, config: AdInput): void {
  equal(scope.campaign.name === undefined, false);
  if (!Array.isArray(scope.campaign.special_ad_categories) || scope.campaign.special_ad_categories.length) {
    throw new MetaCampaignError("meta_special_category_not_supported", 409);
  }
  const adset = object(scope.adset), targeting = object(adset.targeting);
  equal(adset.daily_budget, config.budget);
  sameSet(object(targeting.geo_locations).countries, config.countries);
  sameSet(array(targeting.interests).map(v => object(v).id), config.interests);
}
function creativeDetails(native: Obj, accountId: string, creativeId: string): Obj {
  equal(native.id, creativeId); equal(native.account_id, accountId);
  const story = object(native.object_story_spec), link = object(story.link_data);
  if (["video_data", "photo_data", "template_data", "text_data"].some(k => story[k] !== undefined) ||
      link.child_attachments !== undefined || link.picture !== undefined) {
    throw new MetaCampaignError("meta_unsupported_native_creative", 409);
  }
  const cta = object(link.call_to_action), value = object(cta.value);
  return { id: creativeId, account_id: accountId, name: native.name, page_id: id(story.page_id),
    image_hash: link.image_hash, final_url: link.link, primary_text: link.message,
    headline: link.name, description: link.description, call_to_action: cta.type, cta_link: value.link };
}
async function readCreative(accountId: string, creativeId: string, token: string): Promise<Obj> {
  const native = await metaGraph("GET", creativeId, token, { fields: "id,account_id,name,object_story_spec" });
  return creativeDetails(native, accountId, creativeId);
}
function compareCreative(native: Obj, config: AdInput): void {
  for (const k of ["name", "page_id", "image_hash", "final_url", "primary_text", "headline", "description"] as const) equal(native[k], config[k]);
  equal(native.call_to_action, "LEARN_MORE"); equal(native.cta_link, config.final_url);
}
async function observedAd(accountId: string, adId: string, token: string) {
  const a = await metaGraph("GET", adId, token, { fields: "id,account_id,campaign_id,adset_id,name,status,effective_status,creative{id}" });
  equal(a.id, adId); equal(a.account_id, accountId); equal(a.status, "PAUSED");
  const campaignId = id(a.campaign_id), adsetId = id(a.adset_id), creativeId = id(object(a.creative).id);
  const parents = await readPausedMetaScope(campaignId, token, accountId, adsetId);
  const creative = await readCreative(accountId, creativeId, token);
  return { account_id: accountId, campaign_id: campaignId, adset_id: adsetId, creative_id: creativeId, ad_id: adId,
    campaign: parents.campaign, adset: parents.adset,
    ad: { id: adId, name: a.name, status: a.status, effective_status: a.effective_status }, creative };
}
function imageData(value: unknown): { base64: string; bytes: Uint8Array } {
  if (typeof value !== "string" || value.length > 5_592_408 || !value.length || value.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new MetaCampaignError("meta_invalid_image_data", 400);
  let decoded: string;
  try { decoded = atob(value); } catch { throw new MetaCampaignError("meta_invalid_image_data", 400); }
  const bytes = Uint8Array.from(decoded, v => v.charCodeAt(0));
  const png = bytes.length > 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x);
  const jpeg = bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((!png && !jpeg) || bytes.length > 4_194_304) throw new MetaCampaignError("meta_invalid_image_data", 400);
  return { base64: value, bytes };
}

/** POST calls are run inside the existing Durable Object's persistent idempotency guard. */
export async function handleMetaAdRequest(request: Request, url: URL, token: string | undefined,
  remember?: (known: Identity) => void): Promise<Response> {
  const route = /^\/v1\/meta\/accounts\/([1-9][0-9]{0,31})\/(creative-assets|images|paused-ads)(?:\/([1-9][0-9]{0,31}))?$/.exec(url.pathname);
  if (!route || (route[3] && route[2] !== "paused-ads")) return response({ error: "not_found" }, 404);
  if (!token) return response({ error: "meta_not_configured" }, 503);
  if (url.search) return response({ error: "meta_invalid_query" }, 400);
  const known: Identity = { account_id: route[1] };
  let acknowledged = false;
  try {
    if (request.method === "GET" && route[2] === "creative-assets") return response(await assets(route[1], token));
    if (request.method === "GET" && route[2] === "paused-ads" && route[3]) {
      return response({ status: "verified_paused", native: await observedAd(route[1], route[3], token),
        configuration_comparison: "not_requested", paid_delivery_authorized: false });
    }
    if (request.method !== "POST" || route[2] === "creative-assets" || route[3]) return response({ error: "method_not_allowed" }, 405);
    const raw = await request.text();
    if (raw.length > 6_000_000) return response({ error: "meta_request_too_large" }, 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return response({ error: "invalid_json" }, 400); }
    if (route[2] === "images") {
      const v = object(input, true); fields(v, ["image_base64"]);
      const data = imageData(v.image_base64);
      await account(route[1], token);
      const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data.bytes).buffer);
      const sourceHash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
      const reply = await metaGraph("POST", "act_" + route[1] + "/adimages", token, { bytes: data.base64 });
      acknowledged = true;
      const nativeImages = Object.values(object(reply.images));
      if (nativeImages.length !== 1) throw new MetaCampaignError("meta_invalid_native_image", 502);
      const hash = object(nativeImages[0]).hash;
      if (typeof hash !== "string" || !hashPattern.test(hash)) throw new MetaCampaignError("meta_invalid_native_image", 502);
      known.image_hash = hash; remember?.(known);
      const native = await image(route[1], token, hash);
      return response({ status: "verified_image", ...known, source_sha256: sourceHash,
        byte_count: data.bytes.length, native, paid_delivery_authorized: false }, 201);
    }
    const config = parseAd(input);
    known.campaign_id = config.campaign_id; known.adset_id = config.adset_id; known.image_hash = config.image_hash;
    await account(route[1], token);
    checkParents(await readPausedMetaScope(config.campaign_id, token, route[1], config.adset_id), config);
    if (!(await pages(route[1], token)).some(p => p.id === config.page_id)) throw new MetaCampaignError("meta_page_not_authorized_for_account", 403);
    await image(route[1], token, config.image_hash);
    const created = await metaGraph("POST", "act_" + route[1] + "/adcreatives", token, {
      name: config.name,
      object_story_spec: JSON.stringify({ page_id: config.page_id, link_data: {
        link: config.final_url, image_hash: config.image_hash, message: config.primary_text,
        name: config.headline, description: config.description,
        call_to_action: { type: "LEARN_MORE", value: { link: config.final_url } },
      } }),
    });
    acknowledged = true; known.creative_id = id(created.id); remember?.(known);
    compareCreative(await readCreative(route[1], known.creative_id, token), config);
    // Recheck the parents immediately before constructing a new ad.
    checkParents(await readPausedMetaScope(config.campaign_id, token, route[1], config.adset_id), config);
    const ad = await metaGraph("POST", "act_" + route[1] + "/ads", token, {
      name: config.name, adset_id: config.adset_id,
      creative: JSON.stringify({ creative_id: known.creative_id }), status: "PAUSED",
    });
    known.ad_id = id(ad.id); remember?.(known);
    const native = await observedAd(route[1], known.ad_id, token);
    equal(native.campaign_id, config.campaign_id); equal(native.adset_id, config.adset_id);
    equal(native.creative_id, known.creative_id); equal(native.ad.name, config.name);
    checkParents({ campaign: native.campaign, adset: native.adset }, config);
    compareCreative(native.creative, config);
    return response({ status: "verified_paused", ...known, configuration_match: true, native,
      paid_delivery_authorized: false, platform_review: "not_verified", launch_ready: false }, 201);
  } catch (error) {
    if (!(error instanceof MetaCampaignError)) throw error;
    return response({ error: error.code, ...error.source,
      ...(acknowledged || error.uncertain ? { status: "write_unverified", ...known } : {}),
      paid_delivery_authorized: false }, error.status);
  }
}
