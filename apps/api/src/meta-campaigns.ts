/** Paused Meta audience campaign preparation. Not positive keyword targeting. */
const origin = "https://graph.facebook.com";
const version = "v25.0";
type Obj = Record<string, unknown>;

class MetaCampaignError extends Error {
  constructor(readonly code: string, readonly status: number, readonly uncertain = false,
    readonly campaignId: string | null = null) { super(code); }
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
      !/^[1-9][0-9]{0,9}$/.test(String(v.daily_budget_minor))) {
    throw new MetaCampaignError("meta_unsupported_campaign_configuration", 400);
  }
  if (!Array.isArray(v.countries) || v.countries.length < 1 || v.countries.length > 10 ||
      v.countries.some(x => typeof x !== "string" || !/^[A-Z]{2}$/.test(x))) {
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
    throw new MetaCampaignError(reply.status === 401 || reply.status === 403
      ? "meta_access_denied" : "meta_upstream_rejected", 502);
  }
  try { return obj(await reply.json()); }
  catch { throw new MetaCampaignError("meta_invalid_native_response", 502, method === "POST"); }
}
async function snapshot(id: string, token: string, adsetId?: string) {
  const campaign = await graph("GET", id, token, {
    fields: "id,name,status,effective_status,objective,special_ad_categories",
  });
  if (campaign.id !== id || campaign.status !== "PAUSED" ||
      campaign.objective !== "OUTCOME_TRAFFIC") {
    throw new MetaCampaignError("meta_readback_mismatch", 409);
  }
  if (!adsetId) return { campaign };
  const adset = await graph("GET", adsetId, token, {
    fields: "id,name,status,effective_status,campaign_id,daily_budget,targeting,optimization_goal,billing_event",
  });
  if (adset.id !== adsetId || adset.campaign_id !== id || adset.status !== "PAUSED") {
    throw new MetaCampaignError("meta_readback_mismatch", 409);
  }
  return { campaign, adset };
}
/** Only explicit PAUSED creation and independent, read-only native retrieval. */
export async function handleMetaCampaignRequest(
  request: Request, url: URL, token: string | undefined,
): Promise<Response> {
  const route = /^\/v1\/meta\/accounts\/([1-9][0-9]{0,31})\/paused-audience-campaigns(?:\/([1-9][0-9]{0,31})(?:\/adsets\/([1-9][0-9]{0,31}))?)?$/.exec(url.pathname);
  if (!route) return Response.json({error:"meta_invalid_campaign_route"}, {status:404});
  if (!token) return Response.json({error:"meta_not_configured"}, {status:503});
  if (url.search) return Response.json({error:"meta_invalid_query"}, {status:400});
  let campaignId: string | null = null;
  try {
    if (request.method === "GET" && route[2]) {
      const native = await snapshot(route[2], token, route[3]);
      return Response.json({status:"verified_paused", targeting_mode:"AUDIENCE_INTERESTS",
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
    await snapshot(campaignId, token);
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
    const native = await snapshot(campaignId, token, adset.id);
    const actualTargeting = native.adset?.targeting;
    const actual = actualTargeting && typeof actualTargeting === "object" &&
      !Array.isArray(actualTargeting) ? actualTargeting as Obj : null;
    const geo = actual?.geo_locations && typeof actual.geo_locations === "object"
      ? actual.geo_locations as Obj : null;
    const returnedInterests = actual?.interests;
    const actualIds = Array.isArray(returnedInterests)
      ? returnedInterests.map(v => obj(v).id) : [];
    const countryValues = geo?.countries;
    if (!native.adset || native.adset.daily_budget !== config.budget ||
        !Array.isArray(countryValues) ||
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
          ...(campaignId ? {campaign_id:campaignId} : {})} : {}),
        paid_delivery_authorized:false},{status:error.status});
    }
    throw error;
  }
}
