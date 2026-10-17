import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }):
      Record<string, string>;
  }
}
const readme = import.meta.glob('../../../README.md', {
  query: '?raw', import: 'default', eager: true,
})['../../../README.md'];

const customer = '1234567890';
const manager = '9876543210';
const root = 'https://adslop.test/v1/google-ads/accounts/' + customer;
const credentials = {
  GOOGLE_ADS_CLIENT_ID: 'fixture-client',
  GOOGLE_ADS_CLIENT_SECRET: 'fixture-secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'fixture-refresh',
};
const config = {
  contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  name: 'Paused Search fixture',
  daily_budget_micros: '10000000',
  cpc_bid_micros: '250000',
  keywords: [{ text: 'hello world', match_type: 'EXACT' },
    { text: 'search service', match_type: 'PHRASE' }],
  headlines: ['Headline One', 'Headline Two', 'Headline Three'],
  descriptions: ['Description one for testing', 'Description two for testing'],
  final_url: 'https://example.org/landing',
};
const totalConfig = { ...config, daily_budget_micros: undefined, total_budget_micros: '10000000',
  start_date_time: '2027-02-28 00:00:00', end_date_time: '2027-03-03 23:59:59' };

async function call(
  method: string, path = '/paused-search-campaigns', body?: object, bindings: Partial<Env> = {},
): Promise<Response> {
  return worker.fetch(new Request(root + path, {
    method, headers: { Authorization: 'Bearer test-only-economic-ledger' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), { ...env, ...credentials, ...bindings } as Env);
}

type NativeState = {
  campaign: Record<string, unknown>;
  budget: Record<string, unknown>;
  group: Record<string, unknown>;
  keywords: Array<{ adGroup: object; adGroupCriterion: object }>;
  ad: { adGroup: object; adGroupAd: object };
};

function googleMock(options: {
  mismatch?: boolean; active?: boolean; shared?: boolean; denyMutate?: boolean;
  declarationMismatch?: boolean; readbackStatus?: number; failAfterMutation?: number;
  managed?: boolean;
  mutateFailure?: 'network' | 'invalid_json' | 500 | 503;
  rejectMutateStatus?: 400 | 429;
  missingMutateResult?: 'campaign' | 'budget'; malformedReadback?: boolean;
  budgetEvidence?: Record<string, unknown>; campaignEvidence?: Record<string, unknown>;
  afterUpdate?: { budget?: Record<string, unknown>; campaign?: Record<string, unknown> };
} = {}) {
  let state: NativeState | null = null;
  let failedReadback = false;
  const mutations: Array<{ mutateOperations: Array<Record<string, any>> }> = [];
  const mutateReply = (value: object): Response => {
    if (options.mutateFailure && mutations.length >= (options.failAfterMutation ?? 1)) {
      if (options.mutateFailure === 'network') throw new TypeError('connection closed after commit');
      if (options.mutateFailure === 'invalid_json') {
        return new Response('{', { headers: { 'request-id': 'fixture-mutate' } });
      }
      return Response.json({ error: 'INTERNAL' }, {
        status: options.mutateFailure, headers: { 'request-id': 'fixture-mutate' },
      });
    }
    if (options.missingMutateResult) {
      const rows = (value as { mutateOperationResponses: object[] }).mutateOperationResponses;
      rows[options.missingMutateResult === 'campaign' ? 1 : 0] = {};
    }
    return Response.json(value, { headers: { 'request-id': 'fixture-mutate-ack' } });
  };
  const fetchMock = vi.fn(async (uri: RequestInfo | URL, init?: RequestInit) => {
    const url = String(uri);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'fixture-token' });
    }
    expect(new Headers(init?.headers).get('developer-token')).toBeNull();
    if (url.endsWith('/customers:listAccessibleCustomers')) {
      expect(new Headers(init?.headers).get('login-customer-id')).toBeNull();
      return Response.json({ resourceNames: options.managed
        ? ['customers/' + manager] : ['customers/' + manager, 'customers/' + customer] });
    }
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    const query = typeof body.query === 'string' ? body.query : '';
    const managerRequest = url.includes('/customers/' + manager + '/');
    expect(new Headers(init?.headers).get('login-customer-id')).toBe(
      query.includes('FROM customer_client') ? manager : managerRequest ? null :
        options.managed ? manager : null,
    );
    if (url.endsWith('googleAds:mutate')) {
      if (options.rejectMutateStatus) {
        return Response.json({ error: 'REJECTED' }, {
          status: options.rejectMutateStatus, headers: { 'request-id': 'fixture-rejected' },
        });
      }
      if (options.denyMutate) {
        return Response.json({ error: 'PERMISSION_DENIED' }, {
          status: 403, headers: { 'request-id': 'fixture-denied' },
        });
      }
      const request = body as { mutateOperations: Array<Record<string, any>> };
      expect(JSON.stringify(request.mutateOperations)).not.toContain('"ENABLED"');
      mutations.push(request);
      const ops = request.mutateOperations;
      const prefix = 'customers/' + customer + '/';
      if (ops[0].campaignBudgetOperation?.create) {
        expect(ops[1].campaignOperation.create.containsEuPoliticalAdvertising)
          .toBe('DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING');
        state = {
          budget: { resourceName: prefix + 'campaignBudgets/510',
            period: ops[0].campaignBudgetOperation.create.period ?? 'DAILY',
            amountMicros: ops[0].campaignBudgetOperation.create.amountMicros,
            totalAmountMicros: ops[0].campaignBudgetOperation.create.totalAmountMicros,
            explicitlyShared: options.shared ?? false },
          campaign: { id: '610', status: options.active ? 'ENABLED' : 'PAUSED',
            name: ops[1].campaignOperation.create.name, advertisingChannelType: 'SEARCH',
            campaignBudget: prefix + 'campaignBudgets/510',
            startDateTime: ops[1].campaignOperation.create.startDateTime ?? '2026-10-17 00:00:00',
            endDateTime: ops[1].campaignOperation.create.endDateTime,
            biddingStrategyType: 'MANUAL_CPC',
            containsEuPoliticalAdvertising: options.declarationMismatch
              ? 'CONTAINS_EU_POLITICAL_ADVERTISING'
              : ops[1].campaignOperation.create.containsEuPoliticalAdvertising,
            networkSettings: { targetGoogleSearch: true,
              targetSearchNetwork: false, targetContentNetwork: false } },
          group: { id: '710', name: ops[2].adGroupOperation.create.name,
            status: 'PAUSED', type: 'SEARCH_STANDARD',
            cpcBidMicros: ops[2].adGroupOperation.create.cpcBidMicros },
          keywords: ops.slice(3, -1).map((operation, i) => ({
            adGroup: { id: '710' },
            adGroupCriterion: { criterionId: String(810 + i), status: 'PAUSED',
              keyword: operation.adGroupCriterionOperation.create.keyword },
          })),
          ad: { adGroup: { id: '710' },
            adGroupAd: { status: 'PAUSED', ad: {
              id: '910', type: 'RESPONSIVE_SEARCH_AD',
              finalUrls: ops.at(-1)!.adGroupAdOperation.create.ad.finalUrls,
              responsiveSearchAd: {
                headlines: options.mismatch ? [{ text: 'Different' }] :
                  ops.at(-1)!.adGroupAdOperation.create.ad.responsiveSearchAd.headlines,
                descriptions: ops.at(-1)!.adGroupAdOperation.create.ad.responsiveSearchAd.descriptions,
              },
            } } },
        };
        return mutateReply({ mutateOperationResponses: [
          { campaignBudgetResult: { resourceName: prefix + 'campaignBudgets/510' } },
          { campaignResult: { resourceName: prefix + 'campaigns/610' } },
          { adGroupResult: { resourceName: prefix + 'adGroups/710' } },
          ...state.keywords.map((_, i) => ({
            adGroupCriterionResult: {
              resourceName: prefix + 'adGroupCriteria/710~' + String(810 + i),
            },
          })),
          { adGroupAdResult: { resourceName: prefix + 'adGroupAds/710~910' } },
        ] });
      }
      if (!state) throw Error('no created campaign fixture');
      const campaignOp = ops[0].campaignOperation.update;
      if (campaignOp.name) state.campaign.name = campaignOp.name;
      state.campaign.status = 'PAUSED';
      if (ops[1]?.campaignBudgetOperation) {
        state.budget.amountMicros = ops[1].campaignBudgetOperation.update.amountMicros;
      }
      Object.assign(state.budget, options.afterUpdate?.budget);
      Object.assign(state.campaign, options.afterUpdate?.campaign);
      return mutateReply({ mutateOperationResponses: [
        { campaignResult: { resourceName: prefix + 'campaigns/610' } },
        ...(ops.length > 1 ? [
          { campaignBudgetResult: { resourceName: prefix + 'campaignBudgets/510' } },
        ] : []),
      ] });
    }
    if (query.includes('FROM customer_client')) return Response.json({ results: [{
      customerClient: { id: customer, descriptiveName: 'Fixture account',
        currencyCode: 'EUR', timeZone: 'Europe/Helsinki', manager: false, status: 'ENABLED' },
    }] });
    if (query.includes('customer.id')) return Response.json({ results: [{
      customer: { id: managerRequest ? manager : customer, descriptiveName: 'Fixture account',
        currencyCode: 'EUR', timeZone: 'Europe/Helsinki', manager: managerRequest },
    }] });
    if (!state) return Response.json({ results: [] });
    if (query.includes('FROM campaign_budget')) {
      expect(query).toContain('campaign_budget.period');
      expect(query).toContain('campaign_budget.total_amount_micros');
      return Response.json({ results: [{ campaignBudget: { ...state.budget, ...options.budgetEvidence } }] });
    }
    if (query.includes('FROM campaign')) {
      expect(query).toContain('campaign.contains_eu_political_advertising');
      expect(query).toContain('campaign.start_date_time');
      expect(query).toContain('campaign.end_date_time');
      if (options.malformedReadback) {
        return Response.json({ results: [{ campaign: null }] }, {
          headers: { 'request-id': 'fixture-native-shape' },
        });
      }
      if (options.readbackStatus && !failedReadback &&
          mutations.length >= (options.failAfterMutation ?? 1)) {
        failedReadback = true;
        return Response.json({ error: 'UNAVAILABLE' }, {
          status: options.readbackStatus, headers: { 'request-id': 'fixture-readback' },
        });
      }
      return Response.json({ results: [{ campaign: { ...state.campaign, ...options.campaignEvidence } }] });
    }
    if (query.includes('FROM ad_group_criterion')) {
      return Response.json({ results: state.keywords });
    }
    if (query.includes('FROM ad_group_ad')) {
      return Response.json({ results: [state.ad] });
    }
    if (query.includes('FROM ad_group')) {
      return Response.json({ results: [{ adGroup: state.group }] });
    }
    throw Error('unexpected GAQL fixture ' + query);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { mutations, calls: fetchMock };
}
afterEach(() => vi.unstubAllGlobals());

it('creates a paused Search campaign with exact total budget and schedule', async () => {
  const google = googleMock();
  const result = await call('POST', '/paused-search-campaigns', totalConfig);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({ status: 'verified_paused', paid_delivery_authorized: false,
    native: { budget: { period: 'CUSTOM_PERIOD', totalAmountMicros: totalConfig.total_budget_micros, explicitlyShared: false },
      campaign: { status: 'PAUSED', startDateTime: totalConfig.start_date_time, endDateTime: totalConfig.end_date_time },
      groups: [{ status: 'PAUSED' }], keywords: [{ status: 'PAUSED' }, { status: 'PAUSED' }], ads: [{ status: 'PAUSED' }] } });
  expect(google.mutations).toHaveLength(1);
  const request = google.mutations[0];
  expect(request).toMatchObject({ partialFailure: false });
  expect(request.mutateOperations[0].campaignBudgetOperation.create).toEqual({
    resourceName: 'customers/' + customer + '/campaignBudgets/-1', name: totalConfig.name + ' Budget',
    period: 'CUSTOM_PERIOD', totalAmountMicros: totalConfig.total_budget_micros, explicitlyShared: false,
  });
  expect(request.mutateOperations[1].campaignOperation.create).toMatchObject({ status: 'PAUSED',
    startDateTime: totalConfig.start_date_time, endDateTime: totalConfig.end_date_time });
  expect(JSON.stringify(request.mutateOperations)).not.toContain('"ENABLED"');
});

it('rejects invalid mixed total budgets before native requests', async () => {
  const google = googleMock();
  const cases = [
    { ...totalConfig, daily_budget_micros: '1000000' }, { ...totalConfig, total_budget_micros: undefined },
    { ...config, start_date_time: totalConfig.start_date_time }, { ...config, end_date_time: null },
    ...['0', '-1', '01', '1.1', '9223372036854775808', 1, null].map(total_budget_micros => ({ ...totalConfig, total_budget_micros })),
    ...[undefined, null, '2027-02-29 00:00:00', '2100-02-29 00:00:00', '0000-01-01 00:00:00',
      '2027-02-28T00:00:00Z', '2027-02-28 24:00:00', '2027-02-28 00:00:60'].map(start_date_time => ({ ...totalConfig, start_date_time })),
    ...[undefined, null, '2027-02-30 23:59:59', totalConfig.start_date_time, '2027-02-27 23:59:59']
      .map(end_date_time => ({ ...totalConfig, end_date_time })),
  ];
  for (const body of cases) expect((await call('POST', '/paused-search-campaigns', body)).status).toBe(400);
  expect(google.calls).toHaveBeenCalledTimes(0);
});

it('rejects changed native total budgets and schedules', async () => {
  const cases = [
    { budgetEvidence: { totalAmountMicros: '10000001' } },
    { budgetEvidence: { period: 'DAILY', amountMicros: '10000000', totalAmountMicros: '0' } },
    { budgetEvidence: { period: 'UNSPECIFIED' } }, { budgetEvidence: { explicitlyShared: true } },
    { budgetEvidence: { resourceName: 'customers/' + customer + '/campaignBudgets/999' } },
    ...[undefined, '0', '9223372036854775808', 10000000].map(totalAmountMicros => ({ budgetEvidence: { totalAmountMicros } })),
    { budgetEvidence: { amountMicros: '1' } },
    { campaignEvidence: { startDateTime: '2027-02-28 00:00:01' } },
    ...[undefined, '2027-03-04 23:59:59', '2027-02-30 00:00:00', '2027-02-27 00:00:00']
      .map(endDateTime => ({ campaignEvidence: { endDateTime } })),
  ];
  for (const options of cases) {
    const google = googleMock(options);
    const result = await call('POST', '/paused-search-campaigns', totalConfig);
    expect([409, 502]).toContain(result.status);
    expect(await result.json()).toMatchObject({ status: 'write_unverified', campaign_id: '610',
      budget_resource_name: 'customers/' + customer + '/campaignBudgets/510', paid_delivery_authorized: false });
    expect(google.mutations).toHaveLength(1);
  }
  for (const afterUpdate of [{ budget: { totalAmountMicros: '10000001' } },
    { campaign: { endDateTime: '2027-03-04 23:59:59' } },
    { budget: { period: 'DAILY', amountMicros: '10000000', totalAmountMicros: '0' } }]) {
    const google = googleMock({ afterUpdate });
    expect((await call('POST', '/paused-search-campaigns', totalConfig)).status).toBe(201);
    const result = await call('PATCH', '/paused-search-campaigns/610', { name: 'Still paused' });
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ status: 'write_unverified', campaign_id: '610', paid_delivery_authorized: false });
    expect(google.mutations).toHaveLength(2);
  }
});

it('rejects daily updates to total budgets before writes', async () => {
  const google = googleMock();
  expect((await call('POST', '/paused-search-campaigns', totalConfig)).status).toBe(201);
  const result = await call('PATCH', '/paused-search-campaigns/610', { name: 'Must not change', daily_budget_micros: '1000000' });
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: 'google_ads_total_budget_daily_update_denied' });
  expect(google.mutations).toHaveLength(1);
});

it('preserves total budgets through paused reads and name updates', async () => {
  const google = googleMock({ budgetEvidence: { amountMicros: '0' } });
  expect((await call('POST', '/paused-search-campaigns', totalConfig)).status).toBe(201);
  const before = await call('GET', '/paused-search-campaigns/610');
  expect(before.status).toBe(200);
  const original = await before.json() as { native: {
    budget: Record<string, unknown>; campaign: Record<string, unknown>;
  } };
  const updated = await call('PATCH', '/paused-search-campaigns/610', { name: 'New paused total name' });
  expect(updated.status).toBe(200);
  const value = await updated.json() as typeof original;
  expect(value.native.budget).toEqual(original.native.budget);
  expect(value.native.campaign).toEqual({ ...original.native.campaign, name: 'New paused total name' });
  expect(value).toMatchObject({ paid_delivery_authorized: false, native: { budget: {
    period: 'CUSTOM_PERIOD', totalAmountMicros: totalConfig.total_budget_micros }, campaign: {
    status: 'PAUSED', startDateTime: totalConfig.start_date_time, endDateTime: totalConfig.end_date_time } } });
  const after = await call('GET', '/paused-search-campaigns/610');
  expect(after.status).toBe(200);
  expect(await after.json()).toMatchObject({ native: value.native });
  expect(google.mutations).toHaveLength(2);
  expect(google.mutations[1].mutateOperations).toEqual([{ campaignOperation: {
    update: { resourceName: 'customers/' + customer + '/campaigns/610', status: 'PAUSED', name: 'New paused total name' },
    updateMask: 'name,status' } }]);
});

it('creates one atomic PAUSED keyword Search campaign and verifies native config by readback', async () => {
  const google = googleMock();
  const result = await call('POST', '/paused-search-campaigns', config);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({
    status: 'verified_paused', campaign_id: '610',
    paid_delivery_authorized: false, native: {
      campaign: { name: config.name, status: 'PAUSED', advertisingChannelType: 'SEARCH' },
      budget: { amountMicros: config.daily_budget_micros },
      groups: [{ status: 'PAUSED', cpcBidMicros: config.cpc_bid_micros }],
    },
  });
  expect(google.mutations).toHaveLength(1);
  const operations = google.mutations[0].mutateOperations;
  expect(operations).toHaveLength(6);
  expect(operations[0].campaignBudgetOperation.create.resourceName).toMatch(/-1$/);
  expect(operations[1].campaignOperation.create.resourceName).toMatch(/-2$/);
  expect(operations[2].adGroupOperation.create.resourceName).toMatch(/-3$/);
  expect(JSON.stringify(operations)).not.toContain('"ENABLED"');
  const readback = await call('GET', '/paused-search-campaigns/610');
  expect(readback.status).toBe(200);
  expect(await readback.json()).toMatchObject({
    status: 'verified_paused', native: { keywords: [
      { status: 'PAUSED', keyword: { text: 'hello world', matchType: 'EXACT' } },
      { status: 'PAUSED', keyword: { text: 'search service', matchType: 'PHRASE' } },
    ] },
  });
});

it('updates only name and a dedicated budget while retaining campaign PAUSED', async () => {
  const google = googleMock();
  expect((await call('POST', '/paused-search-campaigns', config)).status).toBe(201);
  const updated = await call('PATCH', '/paused-search-campaigns/610', {
    name: 'A new paused Search name', daily_budget_micros: '11000000',
  });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({
    status: 'verified_paused', native: {
      campaign: { name: 'A new paused Search name', status: 'PAUSED' },
      budget: { amountMicros: '11000000' },
    },
  });
  expect(google.mutations).toHaveLength(2);
  expect(google.mutations[1].mutateOperations).toMatchObject([
    { campaignOperation: { updateMask: 'name,status', update: { status: 'PAUSED' } } },
    { campaignBudgetOperation: { updateMask: 'amount_micros' } },
  ]);
});

it.each([
  { label: 'directly accessible standalone customer', managed: false, loginId: null },
  { label: 'managed customer', managed: true, loginId: manager },
])('routes creation, updates and readback for a $label with a configured manager', async ({ managed, loginId }) => {
  const google = googleMock({ managed });
  const bindings = { GOOGLE_ADS_LOGIN_CUSTOMER_ID: manager };
  const created = await call('POST', '/paused-search-campaigns', config, bindings);
  expect(created.status).toBe(201);
  const updated = await call('PATCH', '/paused-search-campaigns/610', {
    name: 'Routed paused Search campaign', daily_budget_micros: '11000000',
  }, bindings);
  expect(updated.status).toBe(200);
  const readback = await call('GET', '/paused-search-campaigns/610', undefined, bindings);
  expect(readback.status).toBe(200);
  expect(await readback.json()).toMatchObject({
    status: 'verified_paused', native: {
      campaign: { name: 'Routed paused Search campaign', status: 'PAUSED' },
      budget: { amountMicros: '11000000' },
    },
  });
  const accountCalls = google.calls.mock.calls.filter(([url]) =>
    String(url).includes('/customers/' + customer + '/googleAds:'));
  expect(accountCalls.filter(([url]) => String(url).endsWith('googleAds:mutate'))).toHaveLength(2);
  expect(accountCalls.filter(([url]) => String(url).endsWith('googleAds:search')).length)
    .toBeGreaterThan(2);
  for (const [, init] of accountCalls) {
    expect(new Headers(init?.headers).get('login-customer-id')).toBe(loginId);
  }
  expect(google.mutations).toHaveLength(2);
});

it('rejects write/readback mismatches rather than reporting a verified campaign', async () => {
  const google = googleMock({ mismatch: true });
  const reply = await call('POST', '/paused-search-campaigns', config);
  expect(reply.status).toBe(409);
  expect(await reply.json()).toMatchObject({
    error: 'google_ads_write_readback_mismatch', status: 'write_unverified',
    customer_id: customer, campaign_id: '610',
    campaign_resource_name: 'customers/' + customer + '/campaigns/610',
    budget_resource_name: 'customers/' + customer + '/campaignBudgets/510',
    ad_group_resource_name: 'customers/' + customer + '/adGroups/710',
    ad_resource_name: 'customers/' + customer + '/adGroupAds/710~910',
  });
  expect(google.mutations).toHaveLength(1);
});

it.each([429, 503])('preserves created resources after a %i readback failure without retrying', async (status) => {
  const google = googleMock({ readbackStatus: status });
  const reply = await call('POST', '/paused-search-campaigns', config);
  expect(reply.status).toBe(503);
  expect(await reply.json()).toMatchObject({
    error: 'google_ads_quota_or_service_unavailable', request_id: 'fixture-readback',
    status: 'write_unverified', customer_id: customer, campaign_id: '610',
    campaign_resource_name: 'customers/' + customer + '/campaigns/610',
    budget_resource_name: 'customers/' + customer + '/campaignBudgets/510',
    ad_group_resource_name: 'customers/' + customer + '/adGroups/710',
    ad_resource_name: 'customers/' + customer + '/adGroupAds/710~910',
  });
  const recovered = await call('GET', '/paused-search-campaigns/610');
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({ status: 'verified_paused', campaign_id: '610' });
  expect(google.mutations).toHaveLength(1);
});

const ambiguousMutations = [
  { failure: 'network', status: 503, error: 'google_ads_network_unavailable', requestId: null },
  { failure: 'invalid_json', status: 502, error: 'google_ads_invalid_response', requestId: 'fixture-mutate' },
  { failure: 500, status: 502, error: 'google_ads_request_failed', requestId: 'fixture-mutate' },
  { failure: 503, status: 503, error: 'google_ads_quota_or_service_unavailable', requestId: 'fixture-mutate' },
] as const;

it.each(ambiguousMutations)('marks create outcome unknown after $failure without inventing IDs or retrying', async ({ failure, status, error, requestId }) => {
  const google = googleMock({ mutateFailure: failure });
  const reply = await call('POST', '/paused-search-campaigns', config);
  expect(reply.status).toBe(status);
  expect(await reply.json()).toEqual({
    error, request_id: requestId, status: 'write_unverified',
    customer_id: customer, paid_delivery_authorized: false,
  });
  expect(google.mutations).toHaveLength(1);
  const stored = await call('GET', '/paused-search-campaigns/610');
  expect(stored.status).toBe(200);
  expect(await stored.json()).toMatchObject({ status: 'verified_paused', campaign_id: '610' });
  expect(google.mutations).toHaveLength(1);
});

it.each(ambiguousMutations)('preserves update identity after $failure without retrying', async ({ failure, status, error, requestId }) => {
  const google = googleMock({ mutateFailure: failure, failAfterMutation: 2 });
  expect((await call('POST', '/paused-search-campaigns', config)).status).toBe(201);
  const reply = await call('PATCH', '/paused-search-campaigns/610', {
    daily_budget_micros: '11000000',
  });
  expect(reply.status).toBe(status);
  expect(await reply.json()).toEqual({
    error, request_id: requestId, status: 'write_unverified', customer_id: customer,
    campaign_id: '610', campaign_resource_name: 'customers/' + customer + '/campaigns/610',
    budget_resource_name: 'customers/' + customer + '/campaignBudgets/510',
    paid_delivery_authorized: false,
  });
  const stored = await call('GET', '/paused-search-campaigns/610');
  expect(stored.status).toBe(200);
  expect(await stored.json()).toMatchObject({ native: { budget: { amountMicros: '11000000' } } });
  expect(google.mutations).toHaveLength(2);
});

it.each(['campaign', 'budget'] as const)('preserves other acknowledged identities when the %s result is malformed', async (missing) => {
  const google = googleMock({ missingMutateResult: missing });
  const reply = await call('POST', '/paused-search-campaigns', config);
  expect(reply.status).toBe(502);
  expect(await reply.json()).toEqual({
    error: 'google_ads_invalid_native_response', request_id: 'fixture-mutate-ack',
    status: 'write_unverified', customer_id: customer, paid_delivery_authorized: false,
    ...(missing === 'campaign' ? {
      budget_resource_name: 'customers/' + customer + '/campaignBudgets/510',
    } : {
      campaign_id: '610', campaign_resource_name: 'customers/' + customer + '/campaigns/610',
    }),
    ad_group_resource_name: 'customers/' + customer + '/adGroups/710',
    ad_resource_name: 'customers/' + customer + '/adGroupAds/710~910',
    keyword_resource_names: [
      'customers/' + customer + '/adGroupCriteria/710~810',
      'customers/' + customer + '/adGroupCriteria/710~811',
    ],
  });
  expect(google.mutations).toHaveLength(1);
});

it('preserves a successful HTTP request ID when native readback schema is malformed', async () => {
  const google = googleMock({ malformedReadback: true });
  const reply = await call('POST', '/paused-search-campaigns', config);
  expect(reply.status).toBe(502);
  expect(await reply.json()).toMatchObject({
    error: 'google_ads_invalid_native_response', request_id: 'fixture-native-shape',
    status: 'write_unverified', campaign_id: '610',
  });
  expect(google.mutations).toHaveLength(1);
});

it.each([
  { nativeStatus: 400, status: 502, error: 'google_ads_request_failed' },
  { nativeStatus: 429, status: 503, error: 'google_ads_quota_or_service_unavailable' },
] as const)('keeps explicit HTTP $nativeStatus rejection distinct from an uncertain write', async ({ nativeStatus, status, error }) => {
  const google = googleMock({ rejectMutateStatus: nativeStatus });
  const reply = await call('POST', '/paused-search-campaigns', config);
  expect(reply.status).toBe(status);
  expect(await reply.json()).toEqual({ error, request_id: 'fixture-rejected' });
  expect(google.mutations).toHaveLength(0);
});

it('preserves update identity when readback fails after the second acknowledged mutation', async () => {
  const google = googleMock({ readbackStatus: 503, failAfterMutation: 2 });
  expect((await call('POST', '/paused-search-campaigns', config)).status).toBe(201);
  const updated = await call('PATCH', '/paused-search-campaigns/610', {
    daily_budget_micros: '11000000',
  });
  expect(updated.status).toBe(503);
  expect(await updated.json()).toMatchObject({
    status: 'write_unverified', campaign_id: '610', request_id: 'fixture-readback',
    budget_resource_name: 'customers/' + customer + '/campaignBudgets/510',
  });
  const recovered = await call('GET', '/paused-search-campaigns/610');
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({ native: { budget: { amountMicros: '11000000' } } });
  expect(google.mutations).toHaveLength(2);
});

it('rejects a native political-ad declaration that differs from the submitted declaration', async () => {
  const google = googleMock({ declarationMismatch: true });
  const reply = await call('POST', '/paused-search-campaigns', config);
  expect(reply.status).toBe(409);
  expect(await reply.json()).toMatchObject({
    status: 'write_unverified', error: 'google_ads_write_readback_mismatch', campaign_id: '610',
  });
  expect(google.mutations).toHaveLength(1);
});

it('requires an explicit non-political declaration without making external requests', async () => {
  const google = googleMock();
  const { contains_eu_political_advertising: declaration, ...missing } = config;
  expect(declaration).toBe('DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING');
  for (const body of [missing, { ...config, contains_eu_political_advertising: 'UNSPECIFIED' },
    { ...config, contains_eu_political_advertising: 'CONTAINS_EU_POLITICAL_ADVERTISING' }]) {
    const reply = await call('POST', '/paused-search-campaigns', body);
    expect(reply.status).toBe(400);
    expect(await reply.json()).toMatchObject({ error: 'google_ads_eu_political_campaign_unsupported' });
  }
  expect(google.calls).toHaveBeenCalledTimes(0);
});

it('rejects non-string keyword match types without coercion or external requests', async () => {
  const google = googleMock();
  for (const match_type of [{ toString: null }, ['EXACT'], null, 1]) {
    const reply = await call('POST', '/paused-search-campaigns', {
      ...config, keywords: [{ text: 'hello world', match_type }],
    });
    expect(reply.status).toBe(400);
    expect(await reply.json()).toMatchObject({ error: 'google_ads_invalid_keyword_match_type' });
  }
  expect(google.calls).toHaveBeenCalledTimes(0);
});

it('accepts the documented POST body verbatim as a paused campaign request', async () => {
  const google = googleMock();
  const example = /`POST \/v1\/google-ads\/accounts\/\{id\}\/paused-search-campaigns` with `([^`]+)`/.exec(readme);
  expect(example).not.toBeNull();
  const reply = await worker.fetch(new Request(root + '/paused-search-campaigns', {
    method: 'POST', headers: { Authorization: 'Bearer test-only-economic-ledger' },
    body: example![1],
  }), { ...env, ...credentials } as Env);
  expect(reply.status).toBe(201);
  expect(await reply.json()).toMatchObject({ status: 'verified_paused', campaign_id: '610' });
  expect(google.mutations).toHaveLength(1);
});

it('refuses updates to paid-active Search campaigns and shared budgets', async () => {
  const active = googleMock({ active: true });
  expect((await call('POST', '/paused-search-campaigns', config)).status).toBe(409);
  const blocked = await call('PATCH', '/paused-search-campaigns/610', { name: 'New name' });
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({ error: 'google_ads_paid_delivery_not_authorized' });
  expect(active.mutations).toHaveLength(1);
  vi.unstubAllGlobals();
  const shared = googleMock({ shared: true });
  expect((await call('POST', '/paused-search-campaigns', config)).status).toBe(409);
  const denied = await call('PATCH', '/paused-search-campaigns/610', {
    daily_budget_micros: '20000000',
  });
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({ error: 'google_ads_shared_budget_update_denied' });
  expect(shared.mutations).toHaveLength(1);
});

it('rejects unknown status, invalid RSA assets, and non-HTTPS URLs without mutating', async () => {
  const google = googleMock();
  for (const body of [
    { ...config, status: 'ENABLED' },
    { ...config, descriptions: ['Only one'] },
    { ...config, headlines: ['Dup', 'Dup', 'Third'] },
    { ...config, final_url: 'http://example.org/not-secure' },
  ]) {
    const reply = await call('POST', '/paused-search-campaigns', body);
    expect(reply.status).toBe(400);
  }
  const unsafeUpdate = await call('PATCH', '/paused-search-campaigns/610', {
    status: 'ENABLED', name: 'A rename',
  });
  expect(unsafeUpdate.status).toBe(400);
  expect(google.mutations).toHaveLength(0);
  expect(google.calls).toHaveBeenCalledTimes(0);
});

it('requires source write permission and returns native request IDs without pretending success', async () => {
  googleMock({ denyMutate: true });
  const result = await call('POST', '/paused-search-campaigns', config);
  expect(result.status).toBe(403);
  expect(await result.json()).toEqual({
    error: 'google_ads_access_denied', request_id: 'fixture-denied',
  });
  const unauthorized = await worker.fetch(
    new Request(root + '/paused-search-campaigns', {
      method: 'POST', body: JSON.stringify(config),
    }), { ...env, ...credentials } as Env,
  );
  expect(unauthorized.status).toBe(401);
});
