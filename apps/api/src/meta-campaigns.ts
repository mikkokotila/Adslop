/** Paused Meta audience campaign preparation. Not positive keyword targeting. */
const origin = "https://graph.facebook.com";
const version = "v25.0";
type Obj = Record<string, unknown>;

class MetaCampaignError extends Error {
  constructor(readonly code: string, readonly status: number, readonly uncertain = false,
    readonly campaignId: string | null = null,
    readonly source: { upstream_code?: number; upstream_subcode?: number; request_id?: string } = {}) { super(code); }
}
function obj(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MetaCampaignError("meta_invalid_native_response", 502);
  }
  return value as Obj;
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,31}$/.test(value);
}
function metaInterestIds(value: unknown): string[] {
  const targeting = obj(value);
  let interests = targeting.interests;
  if (targeting.flexible_spec !== undefined) {
    if (interests !== undefined || !Array.isArray(targeting.flexible_spec) ||
        targeting.flexible_spec.length !== 1) {
      throw new MetaCampaignError("meta_readback_mismatch", 409);
    }
    const group = obj(targeting.flexible_spec[0]);
    if (Object.keys(group).length !== 1 || !Object.hasOwn(group, "interests")) {
      throw new MetaCampaignError("meta_readback_mismatch", 409);
    }
    interests = group.interests;
  }
  if (!Array.isArray(interests) || !interests.length) {
    throw new MetaCampaignError("meta_readback_mismatch", 409);
  }
  const ids = interests.map(item => {
    const id = obj(item).id;
    if (!validId(id)) throw new MetaCampaignError("meta_readback_mismatch", 409);
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new MetaCampaignError("meta_readback_mismatch", 409);
  return ids;
}
function text(value: unknown, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new MetaCampaignError("meta_invalid_campaign_text", 400);
  }
  return value;
}
function parse(value: unknown) {
  const v = obj(value);
  const allowed = ["name", "daily_budget_minor", "countries", "interest_ids",
    "targeting_mode"];
  if (Object.keys(v).some(k => !allowed.includes(k)) ||
      v.targeting_mode !== "AUDIENCE_INTERESTS" ||
      (typeof v.daily_budget_minor !== "string" ||
       !/^[1-9][0-9]{0,9}$/.test(v.daily_budget_minor))) {
    throw new MetaCampaignError("meta_unsupported_campaign_configuration", 400);
  }
  if (!Array.isArray(v.countries) || v.countries.length < 1 || v.countries.length > 10 ||
      v.countries.some(x => typeof x !== "string" || !/^[A-Z]{2}$/.test(x)) ||
      new Set(v.countries).size !== v.countries.length) {
    throw new MetaCampaignError("meta_invalid_countries", 400);
  }
  if (!Array.isArray(v.interest_ids) || !v.interest_ids.length || v.interest_ids.length > 15 ||
      v.interest_ids.some(x => !validId(x)) ||
      new Set(v.interest_ids).size !== v.interest_ids.length) {
    throw new MetaCampaignError("meta_invalid_interests", 400);
  }
  return { name: text(v.name), budget: v.daily_budget_minor as string,
    countries: v.countries as string[], interests: v.interest_ids as string[] };
}
async function graph(method: "GET" | "POST", path: string, token: string,
  params: Record<string,string>): Promise<Obj> {
  const url = new URL("/" + version + "/" + path, origin);
  let body: string | undefined;
  if (method === "GET") {
    for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  } else {
    body = new URLSearchParams(params).toString();
  }
  let reply: Response;
  try {
    reply = await fetch(url, { method, redirect: "manual", headers: {
      Authorization: "Bearer " + token, Accept: "application/json",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    }, ...(body ? { body } : {}) });
  } catch {
    throw new MetaCampaignError("meta_transport_uncertain", 502, method === "POST");
  }
  if (!reply.ok) {
    if (reply.status >= 500 || reply.status >= 300 && reply.status < 400) {
      throw new MetaCampaignError("meta_upstream_write_uncertain", 502, method === "POST");
    }
    // Keep only numeric error codes and trace IDs, never upstream messages or tokens.
    let raw: unknown;
    try { raw = await reply.json(); }
    catch {
      if (reply.status === 429) throw new MetaCampaignError("meta_rate_limited", 429);
      if (reply.status === 401 || reply.status === 403) throw new MetaCampaignError("meta_access_denied", reply.status);
      throw new MetaCampaignError("meta_invalid_native_response", 502);
    }
    const failure = raw && typeof raw === "object" ? (raw as Obj).error : null;
    const detail = failure && typeof failure === "object" ? failure as Obj : {};
    const source = {
      ...(typeof detail.code === "number" ? { upstream_code: detail.code } : {}),
      ...(typeof detail.error_subcode === "number" ? { upstream_subcode: detail.error_subcode } : {}),
      ...(typeof detail.fbtrace_id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(detail.fbtrace_id) &&
          !detail.fbtrace_id.includes(token) ? { request_id: detail.fbtrace_id } : {}),
    };
    const throttled = reply.status === 429 || [4, 17, 32, 613, 80004].includes(Number(detail.code));
    if (throttled) throw new MetaCampaignError("meta_rate_limited", 429, false, null, source);
    throw new MetaCampaignError(reply.status === 401 || reply.status === 403 ||
      [10, 190, 200].includes(Number(detail.code)) ? "meta_access_denied" : "meta_upstream_rejected",
      reply.status === 401 || reply.status === 403 ? reply.status : 502, false, null, source);
  }
  try { return obj(await reply.json()); }
  catch { throw new MetaCampaignError("meta_invalid_native_response", 502, method === "POST"); }
}
async function snapshot(id: string, token: string, accountId: string, adsetId?: string) {
  const campaign = await graph("GET", id, token, {
    fields: "id,account_id,name,status,effective_status,objective,special_ad_categories",
  });
  if (campaign.id !== id || campaign.account_id !== accountId || campaign.status !== "PAUSED" ||
      campaign.objective !== "OUTCOME_TRAFFIC") {
    throw new MetaCampaignError("meta_readback_mismatch", 409);
  }
  if (!adsetId) return { campaign };
  const adset = await graph("GET", adsetId, token, {
    fields: "id,account_id,name,status,effective_status,campaign_id,daily_budget,targeting,optimization_goal,billing_event",
  });
  const targeting = adset.targeting && typeof adset.targeting === "object" &&
    !Array.isArray(adset.targeting) ? adset.targeting as Obj : null;
  const geography = targeting?.geo_locations && typeof targeting.geo_locations === "object" &&
    !Array.isArray(targeting.geo_locations) ? targeting.geo_locations as Obj : null;
  if (adset.id !== adsetId || adset.campaign_id !== id || adset.account_id !== accountId ||
      adset.status !== "PAUSED" || adset.optimization_goal !== "LINK_CLICKS" ||
      adset.billing_event !== "IMPRESSIONS" ||
      !Array.isArray(geography?.countries) || !geography.countries.length) {
    throw new MetaCampaignError("meta_readback_mismatch", 409);
  }
  metaInterestIds(targeting);
  return { campaign, adset };
}
/** Only explicit PAUSED creation and independent, read-only native retrieval. */
export async function handleMetaCampaignRequest(
  request: Request, url: URL, token: string | undefined,
): Promise<Response> {
  if (url.pathname === "/v1/meta/targeting-interests") {
    if (!token) return Response.json({error:"meta_not_configured"},{status:503});
    if (request.method !== "GET") {
      return Response.json({error:"meta_unsupported_campaign_operation"},{status:405});
    }
    const keys = [...url.searchParams.keys()];
    const q = url.searchParams.get("q");
    if (!q || !q.trim() || q.length > 80 || keys.length !== 1 || keys[0] !== "q") {
      return Response.json({error:"meta_invalid_interest_query"},{status:400});
    }
    try {
      const native = await graph("GET", "search", token, {type:"adinterest",q,limit:"25"});
      if (!Array.isArray(native.data)) {
        throw new MetaCampaignError("meta_invalid_native_response",502);
      }
      const interests = native.data.map(item => {
        const value = obj(item);
        if (!validId(value.id) || typeof value.name !== "string") {
          throw new MetaCampaignError("meta_invalid_native_response",502);
        }
        return {id:value.id,name:value.name,
          ...(Array.isArray(value.path) ? {path:value.path} : {})};
      });
      return Response.json({query:q,targeting_mode:"AUDIENCE_INTERESTS",
        source:"meta_targeting_search",interests});
    } catch (error) {
      if (error instanceof MetaCampaignError) {
        return Response.json({error:error.code},{status:error.status});
      }
      throw error;
    }
  }
  const route = /^\/v1\/meta\/accounts\/([1-9][0-9]{0,31})\/paused-audience-campaigns(?:\/([1-9][0-9]{0,31})(?:\/adsets\/([1-9][0-9]{0,31}))?)?$/.exec(url.pathname);
  if (!route) return Response.json({error:"meta_invalid_campaign_route"}, {status:404});
  if (!token) return Response.json({error:"meta_not_configured"}, {status:503});
  if (url.search) return Response.json({error:"meta_invalid_query"}, {status:400});
  let campaignId: string | null = null;
  let adsetId: string | null = null;
  try {
    if (request.method === "GET" && route[2]) {
      const native = await snapshot(route[2], token, route[1], route[3]);
      return Response.json({status:"verified_paused",
        ...(route[3] ? {targeting_mode:"AUDIENCE_INTERESTS"} :
          {audience_not_verified:true}),
        campaign_id:route[2], ...(route[3] ? {adset_id:route[3]} : {}),
        native, paid_delivery_authorized:false});
    }
    if (request.method !== "POST" || route[2]) {
      throw new MetaCampaignError("meta_unsupported_campaign_operation", 405);
    }
    let payload: unknown;
    try { payload = await request.json(); }
    catch { throw new MetaCampaignError("meta_invalid_json", 400); }
    const config = parse(payload);
    // This account-specific adapter never creates ACTIVE entities.
    const campaign = await graph("POST", "act_" + route[1] + "/campaigns", token, {
      name:config.name, objective:"OUTCOME_TRAFFIC", status:"PAUSED",
      buying_type:"AUCTION", special_ad_categories:"[]",
      is_adset_budget_sharing_enabled:"false",
    });
    if (!validId(campaign.id)) throw new MetaCampaignError("meta_campaign_identity_uncertain", 502, true);
    campaignId = campaign.id;
    await snapshot(campaignId, token, route[1]);
    const adset = await graph("POST", "act_" + route[1] + "/adsets", token, {
      name:config.name + " | Audience",
      campaign_id:campaignId, daily_budget:config.budget, status:"PAUSED",
      optimization_goal:"LINK_CLICKS", billing_event:"IMPRESSIONS",
      bid_strategy:"LOWEST_COST_WITHOUT_CAP",
      targeting:JSON.stringify({
        geo_locations:{countries:config.countries},
        interests:config.interests.map(id => ({id})),
      }),
    });
    if (!validId(adset.id)) throw new MetaCampaignError("meta_adset_identity_uncertain", 502, true,campaignId);
    adsetId = adset.id;
    const native = await snapshot(campaignId, token, route[1], adset.id);
    const actualTargeting = native.adset?.targeting;
    const actual = actualTargeting && typeof actualTargeting === "object" &&
      !Array.isArray(actualTargeting) ? actualTargeting as Obj : null;
    const geo = actual?.geo_locations && typeof actual.geo_locations === "object"
      ? actual.geo_locations as Obj : null;
    const actualIds = metaInterestIds(actual);
    const countryValues = geo?.countries;
    if (!native.adset || native.adset.daily_budget !== config.budget ||
        !Array.isArray(countryValues) ||
        countryValues.length !== config.countries.length ||
        actualIds.length !== config.interests.length ||
        config.countries.some(v => !countryValues.includes(v)) ||
        config.interests.some(v => !actualIds.includes(v))) {
      throw new MetaCampaignError("meta_readback_mismatch",409,true,campaignId);
    }
    return Response.json({status:"verified_paused", campaign_id:campaignId,
      adset_id:adset.id,targeting_mode:"AUDIENCE_INTERESTS",native,
      paid_delivery_authorized:false, creative_not_created:true},{status:201});
  } catch (error) {
    if (error instanceof MetaCampaignError) {
      return Response.json({error:error.code,
        ...(error.uncertain || campaignId ? {status:"write_unverified",
          ...(campaignId ? {campaign_id:campaignId} : {}),
          ...(adsetId ? {adset_id:adsetId} : {})} : {}),
        paid_delivery_authorized:false},{status:error.status});
    }
    throw error;
  }
}

export { graph as metaGraph, snapshot as readPausedMetaScope, MetaCampaignError, metaInterestIds };
