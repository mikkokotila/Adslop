import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import worker, {type Env} from "../src/index";

const root = "https://adslop.test/v1/meta/accounts/1390405164595271/paused-audience-campaigns";
const config = {name:"Eightchord | Meta | Paused",daily_budget_minor:"500",
  countries:["US"],interest_ids:["6000000000001"],targeting_mode:"AUDIENCE_INTERESTS"};
async function invoke(method: string, path = "", data?: object, token = "fixture") {
  return worker.fetch(new Request(root + path,{method,
    headers:{Authorization:"Bearer test-only-economic-ledger"},
    ...(data ? {body:JSON.stringify(data)}:{})}),{...env,META_ACCESS_TOKEN:token} as Env);
}
afterEach(() => vi.unstubAllGlobals());

it("discovers native interest IDs without treating search text as positive keyword matching",async()=>{
  const fake=vi.fn(async(url:RequestInfo | URL,init?:RequestInit)=>{
    const u=new URL(String(url));
    expect(u.pathname).toBe("/v25.0/search");
    expect(u.searchParams.get("type")).toBe("adinterest");
    expect(u.searchParams.get("q")).toBe("astrology");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture");
    return Response.json({data:[{id:"6000000000001",name:"Astrology",
      path:["Interests","News and entertainment","Astrology"]}]});
  });
  vi.stubGlobal("fetch",fake);
  const res=await worker.fetch(new Request("https://adslop.test/v1/meta/targeting-interests?q=astrology",{
    headers:{Authorization:"Bearer test-only-economic-ledger"}
  }),{...env,META_ACCESS_TOKEN:"fixture"} as Env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({targeting_mode:"AUDIENCE_INTERESTS",
    interests:[{id:"6000000000001",name:"Astrology"}]});
  expect(fake).toHaveBeenCalledTimes(1);
});

it("creates paused Meta campaign and audience ad set with independent readback", async () => {
  const calls: Array<{path:string;body:string}> = [];
  const fake = vi.fn(async (url: RequestInfo | URL, init?:RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture");
    expect(init?.redirect).toBe("manual");
    const path = new URL(String(url)).pathname;
    const body = String(init?.body || "");
    calls.push({path,body});
    if (path.endsWith("/campaigns")) {
      expect(body).toContain("status=PAUSED");
      return Response.json({id:"111"});
    }
    if (path.endsWith("/adsets")) {
      expect(body).toContain("status=PAUSED");
      expect(body).toContain("daily_budget=500");
      return Response.json({id:"222"});
    }
    if (path.endsWith("/111")) return Response.json({id:"111",account_id:"1390405164595271",status:"PAUSED",objective:"OUTCOME_TRAFFIC"});
    if (path.endsWith("/222")) return Response.json({id:"222",account_id:"1390405164595271",status:"PAUSED",
      campaign_id:"111",daily_budget:"500",optimization_goal:"LINK_CLICKS",
      billing_event:"IMPRESSIONS",targeting:{
        geo_locations:{countries:["US"]},interests:[{id:"6000000000001"}]}});
    throw Error("unexpected graph path");
  });
  vi.stubGlobal("fetch",fake);
  const result = await invoke("POST","",config);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({status:"verified_paused",
    campaign_id:"111",adset_id:"222",paid_delivery_authorized:false,
    creative_not_created:true,targeting_mode:"AUDIENCE_INTERESTS"});
  const read = await invoke("GET","/111/adsets/222");
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({status:"verified_paused",
    campaign_id:"111",adset_id:"222",native:{campaign:{status:"PAUSED"},adset:{status:"PAUSED"}},
    paid_delivery_authorized:false});
  expect(calls.filter(c=>c.path.endsWith("/campaigns")||c.path.endsWith("/adsets"))).toHaveLength(2);
});
it("rejects keyword substitution, unapproved activation and unsupported methods",async()=>{
  vi.stubGlobal("fetch",vi.fn());
  const bad=await invoke("POST","",{...config,targeting_mode:"POSITIVE_KEYWORDS"});
  expect(bad.status).toBe(400);
  const extra=await invoke("POST","",{...config,status:"ACTIVE"});
  expect(extra.status).toBe(400);
  const duplicateGeo=await invoke("POST","",{...config,countries:["US","US"]});
  expect(duplicateGeo.status).toBe(400);
  const method=await invoke("PATCH","/111",{status:"ACTIVE"});
  expect(method.status).toBe(405);
  expect(fetch).not.toHaveBeenCalled();
});
it("marks a partially created campaign unverified rather than retrying",async()=>{
  const fake=vi.fn(async(url:RequestInfo | URL)=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith("/campaigns")) return Response.json({id:"111"});
    if(path.endsWith("/111")) return Response.json({id:"111",account_id:"1390405164595271",status:"PAUSED",objective:"OUTCOME_TRAFFIC"});
    if(path.endsWith("/adsets")) return Response.json({error:{message:"denied"}},{status:400});
    throw Error("unexpected graph path");
  });
  vi.stubGlobal("fetch",fake);
  const res=await invoke("POST","",config);
  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({status:"write_unverified",campaign_id:"111",
    paid_delivery_authorized:false});
  expect(fake.mock.calls.filter(x=>String(x[0]).endsWith("/adsets"))).toHaveLength(1);
});

it("rejects numeric budget without mutating anything",async()=>{
  const fake=vi.fn();
  vi.stubGlobal("fetch",fake);
  const res=await invoke("POST","",{...config,daily_budget_minor:500});
  expect(res.status).toBe(400);
  expect(fake).not.toHaveBeenCalled();
});
it("returns a distinct 429 for Meta throttling",async()=>{
  const fake=vi.fn(async()=>Response.json({error:{code:17}},{status:429}));
  vi.stubGlobal("fetch",fake);
  const res=await invoke("POST","",config);
  expect(res.status).toBe(429);
  expect(await res.json()).toMatchObject({error:"meta_rate_limited",
    paid_delivery_authorized:false});
  expect(fake).toHaveBeenCalledTimes(1);
});
it("does not verify expanded audience or altered delivery controls",async()=>{
  for(const altered of [
    {optimization_goal:"IMPRESSIONS"},
    {targeting:{geo_locations:{countries:["US","CA"]},
      interests:[{id:"6000000000001"}]}},
    {targeting:{geo_locations:{countries:["US"]},
      interests:[{id:"6000000000001"},{id:"6000000000002"}]}},
    {account_id:"999"},
  ]) {
    const fake=vi.fn(async(url:RequestInfo | URL)=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith("/campaigns")) return Response.json({id:"111"});
      if(path.endsWith("/adsets")) return Response.json({id:"222"});
      if(path.endsWith("/111")) return Response.json({
        id:"111",account_id:"1390405164595271",status:"PAUSED",objective:"OUTCOME_TRAFFIC"});
      if(path.endsWith("/222")) return Response.json({
        id:"222",account_id:"1390405164595271",campaign_id:"111",
        status:"PAUSED",daily_budget:"500",optimization_goal:"LINK_CLICKS",
        billing_event:"IMPRESSIONS",targeting:{
          geo_locations:{countries:["US"]},interests:[{id:"6000000000001"}]},
        ...altered});
      throw Error("unexpected graph path");
    });
    vi.stubGlobal("fetch",fake);
    const res=await invoke("POST","",config);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({status:"write_unverified",
      campaign_id:"111",paid_delivery_authorized:false});
    expect(fake.mock.calls.filter(x=>String(x[0]).endsWith("/adsets"))).toHaveLength(1);
    vi.unstubAllGlobals();
  }
});

it("preserves ad set identity when post-mutation readback fails",async()=>{
  const fake=vi.fn(async(url:RequestInfo | URL)=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith("/campaigns")) return Response.json({id:"111"});
    if(path.endsWith("/111")) return Response.json({id:"111",account_id:"1390405164595271",
      status:"PAUSED",objective:"OUTCOME_TRAFFIC"});
    if(path.endsWith("/adsets")) return Response.json({id:"222"});
    if(path.endsWith("/222")) return Response.json({error:"unavailable"},{status:503});
    throw Error("unexpected");
  });
  vi.stubGlobal("fetch",fake);
  const result=await invoke("POST","",config);
  expect(result.status).toBe(502);
  expect(await result.json()).toMatchObject({status:"write_unverified",
    campaign_id:"111",adset_id:"222",paid_delivery_authorized:false});
  expect(fake.mock.calls.filter(x=>String(x[0]).endsWith("/adsets"))).toHaveLength(1);
});
it("does not claim audience targeting when native interests are absent",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo | URL)=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith("/111")) return Response.json({id:"111",
      account_id:"1390405164595271",status:"PAUSED",objective:"OUTCOME_TRAFFIC"});
    return Response.json({id:"222",account_id:"1390405164595271",
      campaign_id:"111",status:"PAUSED",optimization_goal:"LINK_CLICKS",
      billing_event:"IMPRESSIONS",targeting:{geo_locations:{countries:["US"]}}});
  }));
  const result=await invoke("GET","/111/adsets/222");
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({error:"meta_readback_mismatch"});
});
it("preserves unrelated money ledger observation retrieval routing",async()=>{
  vi.stubGlobal("fetch",vi.fn());
  const res=await worker.fetch(new Request(
    "https://adslop.test/v1/observations/paused-audience-campaigns?product_id=demo&source=demo",{
      headers:{Authorization:"Bearer test-only-economic-ledger"}
    }),{...env,META_ACCESS_TOKEN:"fixture"} as Env);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({error:"not_found"});
  expect(fetch).not.toHaveBeenCalled();
});

function nativeAudience(targeting: Record<string, unknown>) {
  const fake = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST" && path.endsWith("/campaigns")) return Response.json({id:"111"});
    if (init?.method === "POST" && path.endsWith("/adsets")) {
      const sent = JSON.parse(new URLSearchParams(String(init.body)).get("targeting")!);
      expect(sent).toEqual({geo_locations:{countries:["US"]},interests:[{id:"6000000000001"}]});
      return Response.json({id:"222"});
    }
    if (path.endsWith("/111")) return Response.json({id:"111",account_id:"1390405164595271",
      status:"PAUSED",objective:"OUTCOME_TRAFFIC"});
    if (path.endsWith("/222")) return Response.json({id:"222",account_id:"1390405164595271",
      campaign_id:"111",status:"PAUSED",daily_budget:"500",optimization_goal:"LINK_CLICKS",
      billing_event:"IMPRESSIONS",targeting});
    throw Error("unexpected native audience path");
  });
  vi.stubGlobal("fetch",fake);
  return fake;
}
it("reads a paused audience after native OR-interest normalization",async()=>{
  const targeting={geo_locations:{countries:["US"]},
    flexible_spec:[{interests:[{id:"6000000000001",name:"Native interest"}]}],
    targeting_automation:{advantage_audience:1}};
  const fake=nativeAudience(targeting);
  const result=await invoke("GET","/111/adsets/222");
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({status:"verified_paused",
    targeting_mode:"AUDIENCE_INTERESTS",native:{adset:{targeting}},paid_delivery_authorized:false});
  expect(fake.mock.calls.every(([,init])=>init?.method==="GET")).toBe(true);
});
it("verifies created audiences after native OR-interest normalization",async()=>{
  const targeting={geo_locations:{countries:["US"]},
    flexible_spec:[{interests:[{id:"6000000000001"}]}]};
  const fake=nativeAudience(targeting);
  const result=await invoke("POST","",config);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({status:"verified_paused",
    native:{adset:{targeting}},paid_delivery_authorized:false});
  expect(fake.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(2);
});
it("rejects ambiguous native interest groups",async()=>{
  const interests=[{id:"6000000000001"}];
  const invalid: Array<[Record<string,unknown>,number]> = [
    [{flexible_spec:[]},409],
    [{flexible_spec:[{interests},{interests}]},409],
    [{interests,flexible_spec:[{interests}]},409],
    [{flexible_spec:[{interests,behaviors:[{id:"6000000000002"}]}]},409],
    [{flexible_spec:[{interests,unknown_predicate:[]}]},409],
    [{flexible_spec:[{interests:[]}]},409],
    [{flexible_spec:[{interests:[...interests,...interests]}]},409],
    [{flexible_spec:[{interests:[{id:"not-native"}]}]},409],
    [{flexible_spec:[{interests:[{id:6000000000001}]}]},409],
    [{flexible_spec:null},409],
    [{flexible_spec:[null]},502],
    [{flexible_spec:[{interests:[null]}]},502],
  ];
  for (const [shape,status] of invalid) {
    const fake=nativeAudience({geo_locations:{countries:["US"]},...shape});
    const result=await invoke("GET","/111/adsets/222");
    expect(result.status).toBe(status);
    expect(await result.json()).toMatchObject({paid_delivery_authorized:false});
    expect(fake.mock.calls.every(([,init])=>init?.method==="GET")).toBe(true);
  }
});
