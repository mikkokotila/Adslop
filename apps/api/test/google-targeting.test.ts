/** Native targeting evidence and atomic paused configuration, without product defaults. */
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const account = "1234567890", campaign = "610";
const resource = "customers/" + account + "/campaigns/" + campaign;
const url = "https://adslop.test/v1/google-ads/accounts/" + account + "/paused-search-campaigns/" + campaign + "/targeting";
const credentials = { GOOGLE_ADS_CLIENT_ID: "fixture-client", GOOGLE_ADS_CLIENT_SECRET: "fixture-secret", GOOGLE_ADS_REFRESH_TOKEN: "fixture-refresh" };
const desired = { countries: ["FI"], languages: ["fi"] };
type Criterion = { resourceName: string; criterionId: string; type: string; status: string; negative: boolean;
  device?: { type: string }; location?: { geoTargetConstant: string }; language?: { languageConstant: string }; bidModifier?: number };
type Operation = { campaignOperation?: { update: { resourceName: string; status: string; geoTargetTypeSetting: { positiveGeoTargetType: string } }; updateMask: string };
  campaignCriterionOperation?: { remove?: string; create?: { campaign: string; location?: { geoTargetConstant: string }; language?: { languageConstant: string } } } };
type Options = { active?: boolean; foreign?: boolean; wrongAccount?: boolean; unsupported?: boolean;
  failure?: "network" | "invalid_ack" | "readback" | "mismatch" | "unrelated_changed" };
function nativeMock(options: Options = {}) {
  const geo = { positiveGeoTargetType: "PRESENCE_OR_INTEREST", negativeGeoTargetType: "PRESENCE" };
  let criteria: Criterion[] = [
    { resourceName: "customers/" + account + "/campaignCriteria/" + campaign + "~30000", criterionId: "30000",
      type: "DEVICE", status: "ENABLED", negative: false, device: { type: "DESKTOP" }, bidModifier: 0.5 },
    { resourceName: "customers/" + account + "/campaignCriteria/" + campaign + "~2276", criterionId: "2276",
      type: "LOCATION", status: "ENABLED", negative: true, location: { geoTargetConstant: "geoTargetConstants/2276" } },
  ];
  if (options.unsupported) criteria.push({ resourceName: "customers/" + account + "/campaignCriteria/" + campaign + "~900",
    criterionId: "900", type: "PROXIMITY", status: "ENABLED", negative: false });
  const countries = [{ resourceName: "geoTargetConstants/2840", id: "2840", countryCode: "US", targetType: "Country", status: "ENABLED" },
    { resourceName: "geoTargetConstants/2246", id: "2246", countryCode: "FI", targetType: "Country", status: "ENABLED" }];
  const languages = [{ resourceName: "languageConstants/1000", id: "1000", code: "en", targetable: true },
    { resourceName: "languageConstants/1011", id: "1011", code: "fi", targetable: true }];
  const mutations: Operation[][] = [];
  let nextId = 100;
  const fake = vi.fn(async (uri: RequestInfo | URL, init?: RequestInit) => {
    const address = String(uri);
    if (address === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture-access" });
    if (address.endsWith("/customers:listAccessibleCustomers")) return Response.json({ resourceNames: ["customers/" + account] });
    const body = JSON.parse(String(init?.body)) as { query?: string; mutateOperations?: Operation[]; partialFailure?: boolean };
    const query = body.query ?? "";
    if (query.includes("FROM customer")) return Response.json({ results: [{ customer: {
      id: options.wrongAccount ? "9876543210" : account, descriptiveName: "Fixture", currencyCode: "USD", timeZone: "Europe/Helsinki", manager: false,
    } }] });
    if (address.endsWith("googleAds:mutate")) {
      const ops = body.mutateOperations;
      if (!ops) throw Error("Missing native mutation fixture");
      expect(body.partialFailure).toBe(false);
      expect(ops[0]).toEqual({ campaignOperation: { update: { resourceName: resource, status: "PAUSED",
        geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" } }, updateMask: "status,geo_target_type_setting.positive_geo_target_type" } });
      mutations.push(ops);
      geo.positiveGeoTargetType = options.failure === "mismatch" ? "PRESENCE_OR_INTEREST" : "PRESENCE";
      const results: object[] = [{ campaignResult: { resourceName: resource } }];
      for (const operation of ops.slice(1)) {
        const criterion = operation.campaignCriterionOperation;
        if (!criterion) throw Error("Unsupported fixture operation");
        if (criterion.remove) {
          expect(criteria.find(c => c.resourceName === criterion.remove)?.negative).toBe(false);
          expect(criteria.find(c => c.resourceName === criterion.remove)?.type).not.toBe("DEVICE");
          criteria = criteria.filter(c => c.resourceName !== criterion.remove);
          results.push({ campaignCriterionResult: { resourceName: criterion.remove } });
        } else {
          const create = criterion.create;
          if (!create) throw Error("Missing fixture criterion create");
          expect(create.campaign).toBe(resource);
          const id = String(nextId++), name = "customers/" + account + "/campaignCriteria/" + campaign + "~" + id;
          criteria.push({ resourceName: name, criterionId: id, status: "ENABLED", negative: false,
            type: create.location ? "LOCATION" : "LANGUAGE", ...(create.location ? { location: create.location } : { language: create.language }) });
          results.push({ campaignCriterionResult: { resourceName: name } });
        }
      }
      if (options.failure === "unrelated_changed") criteria[0].bidModifier = 2;
      if (options.failure === "network") throw new TypeError("Native response lost after commit");
      return Response.json(options.failure === "invalid_ack" ? {} : { mutateOperationResponses: results });
    }
    if (mutations.length && options.failure === "readback") return Response.json({ error: "UNAVAILABLE" }, { status: 503 });
    if (query.includes("FROM campaign WHERE")) return Response.json({ results: [{ campaign: { id: campaign,
      resourceName: options.foreign ? resource.replace(account, "9876543210") : resource,
      status: options.active ? "ENABLED" : "PAUSED", advertisingChannelType: "SEARCH", geoTargetTypeSetting: geo } }] });
    if (query.includes("FROM campaign_criterion")) {
      expect(query).toContain("campaign_criterion.status != 'REMOVED'");
      return Response.json({ results: criteria.map(c => ({ campaign: { id: campaign }, campaignCriterion: c })) });
    }
    if (query.includes("FROM geo_target_constant")) return Response.json({ results: countries
      .filter(c => query.includes("'" + c.countryCode + "'") || query.includes("'" + c.resourceName + "'"))
      .map(geoTargetConstant => ({ geoTargetConstant })) });
    if (query.includes("FROM language_constant")) return Response.json({ results: languages
      .filter(c => query.includes("'" + c.code + "'") || query.includes("'" + c.resourceName + "'"))
      .map(languageConstant => ({ languageConstant })) });
    throw Error("Unexpected native targeting query " + query);
  });
  vi.stubGlobal("fetch", fake);
  return { mutations, fake, criteria: () => criteria };
}
async function call(method = "GET", input?: object, authorized = true, suffix = "") {
  return worker.fetch(new Request(url + suffix, { method,
    headers: authorized ? { Authorization: "Bearer test-only-economic-ledger" } : {},
    ...(input ? { body: JSON.stringify(input) } : {}),
  }), { ...env, ...credentials } as Env);
}
afterEach(() => vi.unstubAllGlobals());

it("reports unbounded native targeting honestly", async () => {
  const native = nativeMock();
  const reply = await call();
  expect(reply.status).toBe(200);
  expect(reply.headers.get("Cache-Control")).toBe("no-store");
  expect(await reply.json()).toMatchObject({ countries: [], languages: [], geography_and_language_bounded: false,
    positive_geo_target_type: "PRESENCE_OR_INTEREST", native_write_requested: false, launch_ready: false, paid_delivery_authorized: false });
  expect(native.mutations).toHaveLength(0);
});

it("sets and verifies native countries and languages", async () => {
  const native = nativeMock();
  const unrelated = native.criteria().filter(c => c.negative || c.type === "DEVICE");
  const first = await call("PUT", desired);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ status: "verified_paused_targeting", countries: [{ code: "FI" }],
    languages: [{ code: "fi" }], geography_and_language_bounded: true, positive_geo_target_type: "PRESENCE", paid_delivery_authorized: false });
  expect(native.mutations).toHaveLength(1);
  expect(native.mutations[0]).toHaveLength(3);
  const replacement = { countries: ["US"], languages: ["en"] };
  expect((await call("PUT", replacement)).status).toBe(200);
  expect(native.mutations).toHaveLength(2);
  expect(native.mutations[1]).toHaveLength(5);
  expect(native.criteria().filter(c => c.negative || c.type === "DEVICE")).toEqual(unrelated);
  const country = native.criteria().find(c => c.type === "LOCATION" && !c.negative);
  const languageOnly = { countries: ["US"], languages: ["fi"] };
  expect((await call("PUT", languageOnly)).status).toBe(200);
  expect(native.mutations).toHaveLength(3);
  expect(native.mutations[2]).toHaveLength(3);
  expect(native.criteria().find(c => c.type === "LOCATION" && !c.negative)).toEqual(country);
  expect(native.mutations[2].some(op => op.campaignCriterionOperation?.remove === country?.resourceName)).toBe(false);
  expect((await call("PUT", languageOnly)).status).toBe(200);
  expect(native.mutations).toHaveLength(3);
  expect(await (await call()).json()).toMatchObject({ countries: [{ code: "US" }], languages: [{ code: "fi" }], geography_and_language_bounded: true });
});

it("refuses unsafe or unverifiable targeting writes", async () => {
  const invalid = nativeMock();
  for (const body of [{ ...desired, status: "ENABLED" }, { countries: [], languages: ["en"] },
    { countries: ["us"], languages: ["en"] }, { countries: ["US", "US"], languages: ["en"] }]) {
    expect((await call("PUT", body)).status).toBe(400);
  }
  expect((await call("POST", desired)).status).toBe(405);
  expect((await call("PUT", desired, false)).status).toBe(401);
  expect((await call("GET", undefined, true, "?force=true")).status).toBe(400);
  expect(invalid.fake).not.toHaveBeenCalled();
  expect((await call("PUT", { countries: ["ZZ"], languages: ["en"] })).status).toBe(400);
  expect(invalid.mutations).toHaveLength(0);
  for (const options of [{ active: true }, { foreign: true }, { wrongAccount: true }, { unsupported: true }]) {
    const native = nativeMock(options);
    expect((await call("PUT", desired)).status).toBe(409);
    expect(native.mutations).toHaveLength(0);
  }
  for (const failure of ["network", "invalid_ack", "readback", "mismatch", "unrelated_changed"] as const) {
    const native = nativeMock({ failure });
    const reply = await call("PUT", desired);
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(await reply.json()).toMatchObject({ status: "write_unverified", launch_ready: false, paid_delivery_authorized: false });
    expect(native.mutations).toHaveLength(1);
  }
});
