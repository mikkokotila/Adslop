/**
 * Pause-only Google Search campaign writes with an independent native readback.
 * Write permissions do not grant permission to activate paid delivery.
 */
import { GoogleAdsClient, GoogleAdsError, type GoogleAdsConfig } from './google';

type MatchType = 'EXACT' | 'PHRASE' | 'BROAD';
interface Keyword { text: string; match_type: MatchType }
interface CreateSearch {
  contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING';
  name: string;
  daily_budget_micros: string;
  cpc_bid_micros: string;
  keywords: Keyword[];
  headlines: string[];
  descriptions: string[];
  final_url: string;
}
interface UpdateSearch { name?: string; daily_budget_micros?: string }
type Native = Record<string, unknown>;

interface WriteIdentity {
  customer_id: string;
  campaign_id?: string;
  campaign_resource_name?: string;
  budget_resource_name?: string;
  ad_group_resource_name?: string;
  ad_resource_name?: string;
  keyword_resource_names?: string[];
}

class CampaignError extends Error {
  constructor(
    readonly code: string, readonly status: number,
    readonly write?: WriteIdentity, readonly requestId: string | null = null,
  ) {
    super(code);
  }
}

function failedWrite(error: unknown, identity: WriteIdentity, acknowledged: boolean): never {
  const uncertain = error instanceof GoogleAdsError && (
    error.code === 'google_ads_network_unavailable' ||
    error.code === 'google_ads_invalid_response' ||
    (error.responseStatus !== null && error.responseStatus >= 500)
  );
  if ((acknowledged || uncertain) &&
      (error instanceof CampaignError || error instanceof GoogleAdsError)) {
    throw new CampaignError(error.code, error.status, identity, error.requestId);
  }
  throw error;
}

function asObject(v: unknown, code = 'google_ads_invalid_native_response'): Native {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new CampaignError(code, 502);
  return v as Native;
}

function field(v: unknown): string {
  if (typeof v !== 'string') throw new CampaignError('google_ads_invalid_native_response', 502);
  return v;
}

function input(value: unknown, allowed: string[]): Native {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new CampaignError('google_ads_unsupported_campaign_configuration', 400);
  }
  return value as Native;
}

function name(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() ||
      value.length > limit || /[\u0000-\u001f]/.test(value)) {
    throw new CampaignError('google_ads_invalid_campaign_text', 400);
  }
  return value;
}

function positiveMicros(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) ||
      BigInt(value) > 9223372036854775807n) {
    throw new CampaignError('google_ads_invalid_money_micros', 400);
  }
  return value;
}

function uniqueTexts(value: unknown, minimum: number, maximum: number, length: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new CampaignError('google_ads_invalid_ad_assets', 400);
  }
  const list = value.map((item) => name(item, length));
  if (new Set(list.map((text) => text.toLowerCase())).size !== list.length) {
    throw new CampaignError('google_ads_duplicate_ad_assets', 400);
  }
  return list;
}

function parseCreate(value: unknown): CreateSearch {
  const v = input(value, [
    'name', 'daily_budget_micros', 'cpc_bid_micros',
    'keywords', 'headlines', 'descriptions', 'final_url',
    'contains_eu_political_advertising',
  ]);
  // The API requires an explicit declaration. Do not invent one on behalf
  // of the marketer; this slice does not support EU political campaigns.
  if (v.contains_eu_political_advertising !== 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING') {
    throw new CampaignError('google_ads_eu_political_campaign_unsupported', 400);
  }
  if (!Array.isArray(v.keywords) || v.keywords.length < 1 || v.keywords.length > 25) {
    throw new CampaignError('google_ads_invalid_keywords', 400);
  }
  const keywords = v.keywords.map((raw: unknown): Keyword => {
    const key = input(raw, ['text', 'match_type']);
    if (typeof key.match_type !== 'string' ||
        !['EXACT', 'PHRASE', 'BROAD'].includes(key.match_type)) {
      throw new CampaignError('google_ads_invalid_keyword_match_type', 400);
    }
    return { text: name(key.text, 80), match_type: key.match_type as MatchType };
  });
  if (new Set(keywords.map((key) =>
    key.match_type + ':' + key.text.toLowerCase()
  )).size !== keywords.length) throw new CampaignError('google_ads_duplicate_keywords', 400);
  if (typeof v.final_url !== 'string') throw new CampaignError('google_ads_invalid_final_url', 400);
  let final: URL;
  try { final = new URL(v.final_url); }
  catch { throw new CampaignError('google_ads_invalid_final_url', 400); }
  if (final.protocol !== 'https:' || !final.hostname ||
      final.username || final.password || final.href !== v.final_url ||
      v.final_url.length > 2048) {
    throw new CampaignError('google_ads_invalid_final_url', 400);
  }
  return {
    contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    name: name(v.name, 128),
    daily_budget_micros: positiveMicros(v.daily_budget_micros),
    cpc_bid_micros: positiveMicros(v.cpc_bid_micros),
    keywords,
    headlines: uniqueTexts(v.headlines, 3, 15, 30),
    descriptions: uniqueTexts(v.descriptions, 2, 4, 90),
    final_url: v.final_url,
  };
}

function parseUpdate(value: unknown): UpdateSearch {
  const v = input(value, ['name', 'daily_budget_micros']);
  if (!Object.keys(v).length) throw new CampaignError('google_ads_empty_update', 400);
  return {
    ...(v.name !== undefined ? { name: name(v.name, 128) } : {}),
    ...(v.daily_budget_micros !== undefined
      ? { daily_budget_micros: positiveMicros(v.daily_budget_micros) } : {}),
  };
}

function nativeArray(value: unknown): Native[] {
  if (!Array.isArray(value)) throw new CampaignError('google_ads_invalid_native_response', 502);
  return value.map((row) => asObject(row));
}

function child(row: Native, key: string): Native {
  return asObject(row[key]);
}

function one(rows: Native[], key: string): Native {
  if (rows.length !== 1) throw new CampaignError('google_ads_native_readback_missing', 502);
  return child(rows[0], key);
}

function googleResource(customer: string, kind: string, resource: string): string {
  const prefix = 'customers/' + customer + '/' + kind + '/';
  if (!resource.startsWith(prefix) || !/^[1-9]\d*$/.test(resource.slice(prefix.length))) {
    throw new CampaignError('google_ads_mutate_resource_missing', 502);
  }
  return resource.slice(prefix.length);
}

function mutatedResource(value: unknown, index: number, kind: string): string {
  const reply = asObject(value);
  if (reply.partialFailureError) throw new CampaignError('google_ads_partial_mutation', 502);
  const responses = nativeArray(reply.mutateOperationResponses);
  return field(child(responses[index] ?? {}, kind + 'Result').resourceName);
}

function acknowledgedCreate(value: unknown, customer: string, keywordCount: number): WriteIdentity {
  const identity: WriteIdentity = { customer_id: customer };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return identity;
  const rows = (value as Native).mutateOperationResponses;
  if (!Array.isArray(rows)) return identity;
  const resource = (index: number, result: string, kind: string, suffix = '[1-9]\\d*') => {
    const row = rows[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
    const entry = (row as Native)[result + 'Result'];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const name = (entry as Native).resourceName;
    return typeof name === 'string' &&
      new RegExp('^customers/' + customer + '/' + kind + '/' + suffix + '$').test(name)
      ? name : undefined;
  };
  for (const [index, result, kind, key, suffix] of [
    [0, 'campaignBudget', 'campaignBudgets', 'budget_resource_name', '[1-9]\\d*'],
    [1, 'campaign', 'campaigns', 'campaign_resource_name', '[1-9]\\d*'],
    [2, 'adGroup', 'adGroups', 'ad_group_resource_name', '[1-9]\\d*'],
    [keywordCount + 3, 'adGroupAd', 'adGroupAds', 'ad_resource_name', '[1-9]\\d*~[1-9]\\d*'],
  ] as const) {
    const name = resource(index, result, kind, suffix);
    if (name) identity[key] = name;
  }
  if (identity.campaign_resource_name) {
    identity.campaign_id = identity.campaign_resource_name.split('/').at(-1);
  }
  const keywords = Array.from({ length: keywordCount }, (_, i) =>
    resource(i + 3, 'adGroupCriterion', 'adGroupCriteria', '[1-9]\\d*~[1-9]\\d*'))
    .filter((name): name is string => name !== undefined);
  if (keywords.length) identity.keyword_resource_names = keywords;
  return identity;
}

function adTexts(list: unknown): string[] {
  if (!Array.isArray(list)) throw new CampaignError('google_ads_native_readback_missing', 502);
  return list.map((item) => field(asObject(item).text));
}

function equivalent(a: string[], b: string[]): boolean {
  return [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

interface Snapshot {
  campaign: Native;
  budget: Native;
  groups: Native[];
  keywords: Native[];
  ads: Native[];
}

/** Fetches independent GAQL source records, never reuses a mutate echo as evidence. */
async function snapshot(client: GoogleAdsClient, customer: string, campaignId: string): Promise<Snapshot> {
  const number = campaignId;
  const campaigns = await client.search(customer,
    'SELECT campaign.id, campaign.name, campaign.status, ' +
    'campaign.advertising_channel_type, campaign.campaign_budget, ' +
    'campaign.bidding_strategy_type, campaign.contains_eu_political_advertising, ' +
    'campaign.network_settings.target_google_search, ' +
    'campaign.network_settings.target_search_network, ' +
    'campaign.network_settings.target_content_network FROM campaign ' +
    'WHERE campaign.id = ' + number);
  const campaign = one(campaigns, 'campaign');
  const budgetName = field(campaign.campaignBudget);
  if (!budgetName.startsWith('customers/' + customer + '/campaignBudgets/')) {
    throw new CampaignError('google_ads_native_budget_mismatch', 502);
  }
  const budgets = await client.search(customer,
    'SELECT campaign_budget.resource_name, campaign_budget.amount_micros, ' +
    'campaign_budget.explicitly_shared FROM campaign_budget ' +
    "WHERE campaign_budget.resource_name = '" + budgetName + "'");
  const budget = one(budgets, 'campaignBudget');
  const groups = (await client.search(customer,
    'SELECT campaign.id, ad_group.id, ad_group.name, ad_group.type, ' +
    'ad_group.status, ad_group.cpc_bid_micros FROM ad_group ' +
    'WHERE campaign.id = ' + number)).map((row) => child(row, 'adGroup'));
  const keywords = (await client.search(customer,
    'SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ' +
    'ad_group_criterion.status, ad_group_criterion.keyword.text, ' +
    'ad_group_criterion.keyword.match_type FROM ad_group_criterion ' +
    'WHERE campaign.id = ' + number +
    " AND ad_group_criterion.type = 'KEYWORD'")).map((row) => ({
      ...child(row, 'adGroupCriterion'),
      adGroup: child(row, 'adGroup'),
    }));
  const ads = (await client.search(customer,
    'SELECT campaign.id, ad_group.id, ad_group_ad.status, ad_group_ad.ad.id, ' +
    'ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ' +
    'ad_group_ad.ad.responsive_search_ad.headlines, ' +
    'ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad ' +
    'WHERE campaign.id = ' + number +
    " AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'")).map((row) => ({
      ...child(row, 'adGroupAd'),
      adGroup: child(row, 'adGroup'),
    }));
  return { campaign, budget, groups, keywords, ads };
}

function ensurePaused(s: Snapshot): void {
  if (s.campaign.status !== 'PAUSED' ||
      s.campaign.advertisingChannelType !== 'SEARCH') {
    throw new CampaignError('google_ads_paid_delivery_not_authorized', 409);
  }
}

function verifyCreate(
  s: Snapshot, id: string, budgetName: string, groupId: string,
  adResource: string, expected: CreateSearch,
): void {
  const settings = child(s.campaign, 'networkSettings');
  const failures = [
    s.campaign.id !== id,
    s.campaign.name !== expected.name,
    s.campaign.status !== 'PAUSED',
    s.campaign.advertisingChannelType !== 'SEARCH',
    s.campaign.biddingStrategyType !== 'MANUAL_CPC',
    s.campaign.containsEuPoliticalAdvertising !== expected.contains_eu_political_advertising,
    s.campaign.campaignBudget !== budgetName,
    settings.targetGoogleSearch !== true,
    settings.targetSearchNetwork === true,
    settings.targetContentNetwork === true,
    s.budget.amountMicros !== expected.daily_budget_micros,
    s.budget.explicitlyShared === true,
  ];
  const group = s.groups.find((g) => g.id === groupId);
  failures.push(!group || group.name !== expected.name + ' Keywords' ||
    group.status !== 'PAUSED' || group.type !== 'SEARCH_STANDARD' ||
    group.cpcBidMicros !== expected.cpc_bid_micros);
  const keys = s.keywords.filter((key) => child(key, 'adGroup').id === groupId);
  failures.push(keys.length !== expected.keywords.length);
  const wantedKeys = expected.keywords.map((k) => k.text + ':' + k.match_type);
  const actualKeys = keys.map((k) => {
    if (k.status !== 'PAUSED') failures.push(true);
    const keyword = child(k, 'keyword');
    return keyword.text + ':' + keyword.matchType;
  });
  failures.push(!equivalent(wantedKeys, actualKeys));
  const adId = adResource.split('~').at(-1);
  const ad = s.ads.find((a) => child(a, 'ad').id === adId &&
    child(a, 'adGroup').id === groupId);
  if (!ad || ad.status !== 'PAUSED') {
    failures.push(true);
  } else {
    const item = child(ad, 'ad');
    const rsa = child(item, 'responsiveSearchAd');
    failures.push(item.type !== 'RESPONSIVE_SEARCH_AD' ||
      !equivalent(expected.headlines, adTexts(rsa.headlines)) ||
      !equivalent(expected.descriptions, adTexts(rsa.descriptions)) ||
      !Array.isArray(item.finalUrls) ||
      !equivalent([expected.final_url], item.finalUrls as string[]));
  }
  if (failures.some(Boolean)) throw new CampaignError('google_ads_write_readback_mismatch', 409);
}

async function create(
  client: GoogleAdsClient, customer: string, config: CreateSearch, loginCustomerId: string | null,
): Promise<object> {
  const prefix = 'customers/' + customer + '/';
  const budget = prefix + 'campaignBudgets/-1';
  const campaign = prefix + 'campaigns/-2';
  const group = prefix + 'adGroups/-3';
  const operations: Native[] = [
    { campaignBudgetOperation: { create: {
      resourceName: budget, name: config.name + ' Budget',
      amountMicros: config.daily_budget_micros, explicitlyShared: false,
    } } },
    { campaignOperation: { create: {
      resourceName: campaign, name: config.name, status: 'PAUSED',
      advertisingChannelType: 'SEARCH', campaignBudget: budget,
      containsEuPoliticalAdvertising: config.contains_eu_political_advertising,
      manualCpc: { enhancedCpcEnabled: false },
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false,
        targetContentNetwork: false, targetPartnerSearchNetwork: false },
    } } },
    { adGroupOperation: { create: {
      resourceName: group, name: config.name + ' Keywords', campaign,
      status: 'PAUSED', type: 'SEARCH_STANDARD', cpcBidMicros: config.cpc_bid_micros,
    } } },
    ...config.keywords.map((key) => ({
      adGroupCriterionOperation: { create: {
        adGroup: group, status: 'PAUSED',
        keyword: { text: key.text, matchType: key.match_type },
      } },
    })),
    { adGroupAdOperation: { create: {
      adGroup: group, status: 'PAUSED',
      ad: {
        finalUrls: [config.final_url],
        responsiveSearchAd: {
          headlines: config.headlines.map((text) => ({ text })),
          descriptions: config.descriptions.map((text) => ({ text })),
        },
      },
    } } },
  ];
  const identity: WriteIdentity = { customer_id: customer };
  let acknowledged = false;
  try {
    const response = await client.request('/customers/' + customer + '/googleAds:mutate', {
      mutateOperations: operations, partialFailure: false,
      responseContentType: 'RESOURCE_NAME_ONLY',
    }, loginCustomerId);
    acknowledged = true;
    Object.assign(identity, acknowledgedCreate(response, customer, config.keywords.length));
    const campaignName = mutatedResource(response, 1, 'campaign');
    const campaignId = googleResource(customer, 'campaigns', campaignName);
    const budgetName = mutatedResource(response, 0, 'campaignBudget');
    const groupName = mutatedResource(response, 2, 'adGroup');
    const adName = mutatedResource(response, operations.length - 1, 'adGroupAd');
    // Keep acknowledged identities even if another response or readback fails.
    for (let i = 0; i < config.keywords.length; i++) {
      mutatedResource(response, i + 3, 'adGroupCriterion');
    }
    const groupId = googleResource(customer, 'adGroups', groupName);
    if (!adName.startsWith(prefix + 'adGroupAds/' + groupId + '~')) {
      throw new CampaignError('google_ads_mutate_resource_missing', 502);
    }
    const actual = await snapshot(client, customer, campaignId);
    verifyCreate(actual, campaignId, budgetName, groupId, adName, config);
    return { status: 'verified_paused', ...identity,
      native: actual, paid_delivery_authorized: false };
  } catch (error) {
    failedWrite(error, identity, acknowledged);
  }
}

async function update(
  client: GoogleAdsClient, customer: string, campaignId: string, config: UpdateSearch,
  loginCustomerId: string | null,
): Promise<object> {
  const existing = await snapshot(client, customer, campaignId);
  ensurePaused(existing);
  const budgetName = field(existing.campaign.campaignBudget);
  if (config.daily_budget_micros !== undefined &&
      existing.budget.explicitlyShared === true) {
    throw new CampaignError('google_ads_shared_budget_update_denied', 409);
  }
  const operations: Native[] = [
    { campaignOperation: {
      update: {
        resourceName: 'customers/' + customer + '/campaigns/' + campaignId,
        status: 'PAUSED',
        ...(config.name !== undefined ? { name: config.name } : {}),
      },
      updateMask: config.name !== undefined ? 'name,status' : 'status',
    } },
  ];
  if (config.daily_budget_micros !== undefined) {
    operations.push({ campaignBudgetOperation: {
      update: { resourceName: budgetName, amountMicros: config.daily_budget_micros },
      updateMask: 'amount_micros',
    } });
  }
  const identity: WriteIdentity = {
    customer_id: customer, campaign_id: campaignId,
    campaign_resource_name: 'customers/' + customer + '/campaigns/' + campaignId,
    budget_resource_name: budgetName,
  };
  let acknowledged = false;
  try {
    const response = await client.request('/customers/' + customer + '/googleAds:mutate', {
      mutateOperations: operations, partialFailure: false,
      responseContentType: 'RESOURCE_NAME_ONLY',
    }, loginCustomerId);
    acknowledged = true;
    if (mutatedResource(response, 0, 'campaign') !== identity.campaign_resource_name) {
      throw new CampaignError('google_ads_mutate_resource_missing', 502);
    }
    if (config.daily_budget_micros !== undefined &&
        mutatedResource(response, 1, 'campaignBudget') !== budgetName) {
      throw new CampaignError('google_ads_mutate_resource_missing', 502);
    }
    const actual = await snapshot(client, customer, campaignId);
    ensurePaused(actual);
    if ((config.name !== undefined && actual.campaign.name !== config.name) ||
        (config.daily_budget_micros !== undefined &&
         actual.budget.amountMicros !== config.daily_budget_micros)) {
      throw new CampaignError('google_ads_write_readback_mismatch', 409);
    }
    return { status: 'verified_paused', ...identity,
      native: actual, paid_delivery_authorized: false };
  } catch (error) {
    failedWrite(error, identity, acknowledged);
  }
}

/** Routes only explicit pause-first creation and restricted updates. */
export async function pausedSearchCampaigns(
  request: Request, url: URL, env: GoogleAdsConfig,
): Promise<Response> {
  const route = /^\/v1\/google-ads\/accounts\/([0-9]{10})\/paused-search-campaigns(?:\/([1-9]\d*))?$/.exec(
    url.pathname,
  );
  if (!route) return Response.json({ error: 'google_ads_invalid_campaign_route' }, { status: 400 });
  let client: GoogleAdsClient | undefined;
  try {
    if (!((request.method === 'POST' && !route[2]) ||
          (request.method === 'PATCH' && !!route[2]) ||
          (request.method === 'GET' && !!route[2]))) {
      throw new CampaignError('google_ads_unsupported_campaign_operation', 405);
    }
    let payload: CreateSearch | UpdateSearch | undefined;
    if (request.method !== 'GET') {
      let body: unknown;
      try { body = await request.json(); }
      catch { throw new CampaignError('google_ads_invalid_json', 400); }
      payload = request.method === 'POST' ? parseCreate(body) : parseUpdate(body);
    }
    client = await GoogleAdsClient.connect(env);
    const account = await client.account(route[1]);
    if (account.manager) throw new CampaignError('google_ads_manager_campaign_write_denied', 409);
    let result: object;
    if (request.method === 'POST') {
      result = await create(client, route[1], payload as CreateSearch, account.login_customer_id);
    } else if (request.method === 'PATCH') {
      result = await update(client, route[1], route[2], payload as UpdateSearch, account.login_customer_id);
    } else {
      const actual = await snapshot(client, route[1], route[2]);
      ensurePaused(actual);
      result = { status: 'verified_paused', customer_id: route[1],
        campaign_id: route[2], native: actual, paid_delivery_authorized: false };
    }
    return Response.json(result, { status: request.method === 'POST' ? 201 : 200 });
  } catch (error) {
    if (error instanceof CampaignError || error instanceof GoogleAdsError) {
      return Response.json({
        error: error.code,
        request_id: error.requestId ?? client?.responseRequestId ?? null,
        ...(error instanceof CampaignError && error.write ? {
          status: 'write_unverified', ...error.write, paid_delivery_authorized: false,
        } : {}),
      }, { status: error.status });
    }
    throw error;
  }
}
