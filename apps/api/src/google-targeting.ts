/** Explicit country/language constraints for paused Search campaigns; no activation. */
import { GoogleAdsClient, GoogleAdsError, type GoogleAdsConfig } from "./google";

type Obj = Record<string, unknown>;
type Constant = { code: string; resource_name: string };
type Selection = { countries: string[]; languages: string[] };
type Context = { client: GoogleAdsClient; account: string; campaign: string; login: string | null };
type Snapshot = { campaign: Obj; criteria: Obj[]; countries: Constant[]; languages: Constant[] };
class TargetingError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code); }
}
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TargetingError("google_ads_targeting_invalid_native_response");
  }
  return value as Obj;
}
function strings(value: unknown, pattern: RegExp): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 20 ||
      value.some(v => typeof v !== "string" || !pattern.test(v)) || new Set(value).size !== value.length) {
    throw new TargetingError("google_ads_targeting_invalid_selection", 400);
  }
  return value as string[];
}
function selection(value: unknown): Selection {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["countries", "languages"].includes(key))) {
    throw new TargetingError("google_ads_targeting_invalid_selection", 400);
  }
  const v = value as Obj;
  return { countries: strings(v.countries, /^[A-Z]{2}$/),
    languages: strings(v.languages, /^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/) };
}
const resource = (ctx: Context) => "customers/" + ctx.account + "/campaigns/" + ctx.campaign;
async function query(ctx: Context, text: string): Promise<Obj[]> {
  return ctx.client.search(ctx.account, text, ctx.login);
}
function constantRows(rows: Obj[], kind: "country" | "language"): Constant[] {
  return rows.map(row => {
    const country = kind === "country";
    const native = object(row[country ? "geoTargetConstant" : "languageConstant"]);
    const code = country ? native.countryCode : native.code;
    const prefix = country ? "geoTargetConstants/" : "languageConstants/";
    if (typeof native.id !== "string" || !/^[1-9][0-9]*$/.test(native.id) ||
        native.resourceName !== prefix + native.id || typeof code !== "string" ||
        !(country ? /^[A-Z]{2}$/.test(code) : /^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/.test(code)) ||
        (country ? native.targetType !== "Country" || native.status !== "ENABLED" : native.targetable !== true)) {
      throw new TargetingError("google_ads_targeting_unsupported_native_constant", 409);
    }
    return { code, resource_name: native.resourceName as string };
  });
}
async function constants(ctx: Context, kind: "country" | "language", values: string[], byResource: boolean): Promise<Constant[]> {
  if (!values.length) return [];
  if (new Set(values).size !== values.length) throw new TargetingError("google_ads_targeting_duplicate_native_constant", 409);
  const country = kind === "country", table = country ? "geo_target_constant" : "language_constant";
  const field = byResource ? "resource_name" : country ? "country_code" : "code";
  const fields = country ? "geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.country_code, geo_target_constant.target_type, geo_target_constant.status"
    : "language_constant.resource_name, language_constant.id, language_constant.code, language_constant.targetable";
  const rows = constantRows(await query(ctx, "SELECT " + fields + " FROM " + table + " WHERE " + table + "." + field +
    " IN (" + values.map(v => "'" + v + "'").join(",") + ")" +
    (!byResource && country ? " AND geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED'" : "")), kind);
  const keys = rows.map(row => byResource ? row.resource_name : row.code);
  if (rows.length !== values.length || new Set(keys).size !== keys.length || values.some(v => !keys.includes(v))) {
    throw new TargetingError("google_ads_targeting_constant_not_resolved", byResource ? 409 : 400);
  }
  return rows;
}
function positive(criterion: Obj): boolean {
  return criterion.negative === false && ["LOCATION", "LANGUAGE"].includes(String(criterion.type));
}
function targetResource(criterion: Obj): string {
  const location = criterion.type === "LOCATION";
  const value = object(criterion[location ? "location" : "language"])[location ? "geoTargetConstant" : "languageConstant"];
  if (typeof value !== "string" || !(location ? /^geoTargetConstants\/[1-9][0-9]*$/ : /^languageConstants\/[1-9][0-9]*$/).test(value)) {
    throw new TargetingError("google_ads_targeting_invalid_native_constant");
  }
  return value;
}
function criterionResources(criteria: Obj[], kind: "LOCATION" | "LANGUAGE"): string[] {
  return criteria.filter(c => c.negative === false && c.type === kind && c.status === "ENABLED").map(targetResource);
}
async function snapshot(ctx: Context): Promise<Snapshot> {
  const rows = await query(ctx, "SELECT campaign.id, campaign.resource_name, campaign.status, campaign.advertising_channel_type, " +
    "campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type " +
    "FROM campaign WHERE campaign.id = " + ctx.campaign);
  if (rows.length !== 1) throw new TargetingError("google_ads_targeting_campaign_not_found", 404);
  const campaign = object(rows[0].campaign), geo = object(campaign.geoTargetTypeSetting);
  if (campaign.id !== ctx.campaign || campaign.resourceName !== resource(ctx)) {
    throw new TargetingError("google_ads_targeting_account_mismatch", 409);
  }
  if (campaign.status !== "PAUSED" || campaign.advertisingChannelType !== "SEARCH") {
    throw new TargetingError("google_ads_targeting_paused_search_required", 409);
  }
  if (!["PRESENCE", "PRESENCE_OR_INTEREST", "SEARCH_INTEREST"].includes(String(geo.positiveGeoTargetType)) ||
      !["PRESENCE", "PRESENCE_OR_INTEREST"].includes(String(geo.negativeGeoTargetType))) {
    throw new TargetingError("google_ads_targeting_unsupported_native_geography", 409);
  }
  const criteria = (await query(ctx, "SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.criterion_id, " +
    "campaign_criterion.type, campaign_criterion.status, campaign_criterion.negative, campaign_criterion.bid_modifier, campaign_criterion.device.type, " +
    "campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant " +
    "FROM campaign_criterion WHERE campaign.id = " + ctx.campaign + " AND campaign_criterion.status != 'REMOVED'")).map(row => {
    const c = object(row.campaignCriterion);
    if (object(row.campaign).id !== ctx.campaign || typeof c.criterionId !== "string" ||
        !/^[1-9][0-9]*$/.test(c.criterionId) ||
        c.resourceName !== "customers/" + ctx.account + "/campaignCriteria/" + ctx.campaign + "~" + c.criterionId ||
        typeof c.negative !== "boolean" || !["ENABLED", "PAUSED"].includes(String(c.status)) ||
        typeof c.type !== "string" || !/^[A-Z_]+$/.test(c.type) ||
        c.negative === false && ["PROXIMITY", "LOCATION_GROUP"].includes(c.type)) {
      throw new TargetingError("google_ads_targeting_unsupported_native_criterion", 409);
    }
    return c;
  });
  if (new Set(criteria.map(c => c.resourceName)).size !== criteria.length) {
    throw new TargetingError("google_ads_targeting_duplicate_native_criterion", 409);
  }
  return { campaign, criteria,
    countries: await constants(ctx, "country", criterionResources(criteria, "LOCATION"), true),
    languages: await constants(ctx, "language", criterionResources(criteria, "LANGUAGE"), true) };
}
function same(a: string[], b: string[]): boolean {
  return [...a].sort().join("\n") === [...b].sort().join("\n");
}
function preserved(criteria: Obj[]): string[] {
  return criteria.filter(c => !positive(c)).map(c => JSON.stringify([
    c.resourceName, c.criterionId, c.type, c.status, c.negative, c.bidModifier ?? null,
    c.device === undefined ? null : object(c.device).type,
    c.location === undefined ? null : object(c.location).geoTargetConstant,
    c.language === undefined ? null : object(c.language).languageConstant,
  ]));
}
function result(native: Snapshot, mutated: boolean): Obj {
  const geo = object(native.campaign.geoTargetTypeSetting);
  return { status: "native_paused_targeting_observed", countries: native.countries, languages: native.languages,
    geography_and_language_bounded: !!native.countries.length && !!native.languages.length && geo.positiveGeoTargetType === "PRESENCE",
    positive_geo_target_type: geo.positiveGeoTargetType, native, native_write_requested: mutated,
    observed_at: new Date().toISOString(), launch_ready: false, paid_delivery_authorized: false };
}

/** Native constants and account identities are validated before one atomic PAUSED-only mutation. */
export async function handleGoogleTargeting(request: Request, url: URL, env: GoogleAdsConfig): Promise<Response> {
  const reply = (body: Obj, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const route = /^\/v1\/google-ads\/accounts\/([0-9]{10})\/paused-search-campaigns\/([1-9][0-9]{0,31})\/targeting$/.exec(url.pathname);
  if (!route) return reply({ error: "google_ads_targeting_not_found" }, 404);
  if (url.search) return reply({ error: "google_ads_targeting_invalid_query" }, 400);
  if (!["GET", "PUT"].includes(request.method)) return reply({ error: "google_ads_targeting_method_not_allowed" }, 405);
  let writeRequested = false, acknowledged = false;
  try {
    let wanted: Selection | undefined;
    if (request.method === "PUT") {
      const raw = await request.text();
      if (raw.length > 4096) throw new TargetingError("google_ads_targeting_request_too_large", 413);
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new TargetingError("google_ads_targeting_invalid_json", 400); }
      wanted = selection(parsed);
    }
    const client = await GoogleAdsClient.connect(env), account = await client.account(route[1]);
    if (account.id !== route[1] || account.manager) throw new TargetingError("google_ads_targeting_account_mismatch", 409);
    const ctx: Context = { client, account: route[1], campaign: route[2], login: account.login_customer_id };
    const before = await snapshot(ctx);
    if (!wanted) return reply(result(before, false));
    const countries = await constants(ctx, "country", wanted.countries, false);
    const languages = await constants(ctx, "language", wanted.languages, false);
    const matches = (value: Snapshot) => same(value.countries.map(c => c.resource_name), countries.map(c => c.resource_name)) &&
      same(value.languages.map(c => c.resource_name), languages.map(c => c.resource_name)) &&
      value.criteria.filter(positive).every(c => c.status === "ENABLED") &&
      object(value.campaign.geoTargetTypeSetting).positiveGeoTargetType === "PRESENCE";
    if (!matches(before)) {
      const requested = new Set([...countries, ...languages].map(c => c.resource_name));
      const retained = new Set(before.criteria.filter(positive).filter(c => c.status === "ENABLED" && requested.has(targetResource(c))).map(targetResource));
      const removed = before.criteria.filter(positive).filter(c => c.status !== "ENABLED" || !retained.has(targetResource(c)));
      const operations: Obj[] = [{ campaignOperation: {
        update: { resourceName: resource(ctx), status: "PAUSED", geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" } },
        updateMask: "status,geo_target_type_setting.positive_geo_target_type",
      } }, ...removed.map(c => ({ campaignCriterionOperation: { remove: c.resourceName } })),
      ...countries.filter(c => !retained.has(c.resource_name)).map(c => ({ campaignCriterionOperation: { create: { campaign: resource(ctx), location: { geoTargetConstant: c.resource_name } } } })),
      ...languages.filter(c => !retained.has(c.resource_name)).map(c => ({ campaignCriterionOperation: { create: { campaign: resource(ctx), language: { languageConstant: c.resource_name } } } }))];
      writeRequested = true;
      const acknowledgment = object(await client.request("/customers/" + ctx.account + "/googleAds:mutate",
        { partialFailure: false, mutateOperations: operations }, ctx.login));
      acknowledged = true;
      if (acknowledgment.partialFailureError !== undefined || !Array.isArray(acknowledgment.mutateOperationResponses) ||
          acknowledgment.mutateOperationResponses.length !== operations.length ||
          object(object(acknowledgment.mutateOperationResponses[0]).campaignResult).resourceName !== resource(ctx)) {
        throw new TargetingError("google_ads_targeting_invalid_acknowledgment");
      }
    }
    const after = await snapshot(ctx);
    if (!matches(after) || !same(preserved(before.criteria), preserved(after.criteria)) ||
        object(before.campaign.geoTargetTypeSetting).negativeGeoTargetType !== object(after.campaign.geoTargetTypeSetting).negativeGeoTargetType) {
      throw new TargetingError("google_ads_targeting_readback_mismatch", 409);
    }
    return reply({ ...result(after, writeRequested), status: "verified_paused_targeting" });
  } catch (error) {
    const known = error instanceof TargetingError || error instanceof GoogleAdsError;
    const requestId = error instanceof GoogleAdsError ? error.requestId : null;
    const nativeStatus = error instanceof GoogleAdsError ? error.responseStatus : null;
    const rejected = writeRequested && !acknowledged && nativeStatus !== null && nativeStatus >= 400 && nativeStatus < 500;
    return reply({ error: known ? error.code : "google_ads_targeting_execution_interrupted", campaign_id: route[2],
      request_id: requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId) ? requestId : null,
      native_http_status: nativeStatus,
      ...(writeRequested ? { status: rejected ? "write_rejected" : "write_unverified", native_write_requested: true } : {}),
      paid_delivery_authorized: false, launch_ready: false }, known ? error.status : 502);
  }
}
