import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

const base = 'https://adslop.test';
const id = '1234567890';
const manager = '9876543210';
const secondManager = '2222222222';
const secondClient = '3333333333';
const credentials = {
  GOOGLE_ADS_CLIENT_ID: 'test-client-id',
  GOOGLE_ADS_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'test-refresh-token',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: manager,
};

async function get(path: string, config = credentials): Promise<Response> {
  return worker.fetch(new Request(base + path, {
    headers: { Authorization: 'Bearer test-only-economic-ledger' },
  }), { ...env, ...config } as Env);
}

function accountInfo(customerId = id, isManager = false) {
  return { customer: {
    id: customerId, descriptiveName: isManager ? 'Manager fixture' : 'Account fixture',
    currencyCode: 'EUR', timeZone: 'Europe/Helsinki', manager: isManager,
  } };
}

const campaignRow = (amount: string, date = '2026-10-08') => ({
  segments: { date },
  campaign: { id: '101', name: 'Search fixture' },
  metrics: { costMicros: amount, clicks: '2', impressions: '100' },
});

function stubAds(options: {
  oauthFailure?: boolean; quota?: boolean; cycle?: boolean;
  mixedDirect?: boolean; adsNetworkFailure?: boolean; badJson?: boolean;
  managerValue?: { value: unknown }; directAccounts?: number;
  nameValue?: { value: unknown }; accessibleNames?: unknown;
  multipleManagers?: boolean;
  invalidRows?: 'account' | 'spend'; pageTokenValue?: { value: unknown };
} = {}) {
  const calls: Array<{ url: string; request: Record<string, unknown> }> = [];
  const mocked = vi.fn(async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = String(resource);
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get('refresh_token')).toBe('test-refresh-token');
      if (options.oauthFailure) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
    }
    expect(url).toContain('https://googleads.googleapis.com/v25/');
    if (options.adsNetworkFailure) throw new Error('private-network-detail');
    if (options.badJson) return new Response('invalid upstream document', { status: 200 });
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-access-token');
    expect(new Headers(init?.headers).get('developer-token')).toBeNull();
    if (options.quota) {
      return Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, {
        status: 429, headers: { 'request-id': 'quota-fixture-id' },
      });
    }
    if (url.endsWith(':listAccessibleCustomers')) {
      if (options.accessibleNames !== undefined) {
        return Response.json({ resourceNames: options.accessibleNames });
      }
      if (options.directAccounts) {
        return Response.json({ resourceNames: Array.from({ length: options.directAccounts },
          (_, index) => 'customers/' + String(1000000000 + index)) });
      }
      return Response.json({ resourceNames: [
        'customers/' + manager,
        ...(options.mixedDirect ? ['customers/1111111111'] : []),
        ...(options.multipleManagers ? ['customers/' + secondManager] : []),
      ] });
    }
    const req = JSON.parse(init?.body as string) as Record<string, unknown>;
    calls.push({ url, request: req });
    const query = req.query as string;
    const customerId = /customers\/(\d+)\//.exec(url)![1];
    if ((options.mixedDirect || options.multipleManagers) && !query.includes('FROM customer_client')) {
      const expectedLogin = customerId === id ? manager : customerId === secondClient ? secondManager : null;
      expect(new Headers(init?.headers).get('login-customer-id')).toBe(expectedLogin);
    }
    if (query.includes('FROM customer_client')) {
      expect(new Headers(init?.headers).get('login-customer-id')).toBe(customerId);
      return Response.json({ results: [
        { customerClient: {
          id: customerId === secondManager ? secondClient : id,
          descriptiveName: 'Client fixture', currencyCode: 'EUR',
          timeZone: 'Europe/Helsinki', manager: false, status: 'ENABLED',
          ...(options.nameValue ? { descriptiveName: options.nameValue.value } : {}),
        } },
        { customerClient: {
          id: customerId, descriptiveName: 'Manager fixture', currencyCode: 'EUR',
          timeZone: 'Europe/Helsinki', manager: true, status: 'ENABLED',
          ...(options.nameValue ? { descriptiveName: options.nameValue.value } : {}),
        } },
      ] });
    }
    if (query.includes('FROM customer') && query.includes('customer.id')) {
      if (options.invalidRows === 'account') return Response.json({ results: [null] });
      const info = accountInfo(customerId, customerId === manager || customerId === secondManager);
      return Response.json({ results: [{ customer: {
        ...info.customer,
        ...(options.managerValue ? { manager: options.managerValue.value } : {}),
        ...(options.nameValue ? { descriptiveName: options.nameValue.value } : {}),
      } }] });
    }
    if (query.includes('FROM customer') && query.includes('segments.date')) {
      if (options.invalidRows === 'spend') return Response.json({ results: [null] });
      return Response.json({ results: [
        { segments: { date: '2026-10-08' }, metrics: { costMicros: '1000001' } },
      ] });
    }
    if (query.includes('FROM campaign') && query.includes('metrics.cost_micros')) {
      if (!req.pageToken) {
        return Response.json({ results: [campaignRow('600001')],
          nextPageToken: options.pageTokenValue ? options.pageTokenValue.value : 'second' });
      }
      expect(req.pageToken).toBe('second');
      return Response.json({
        results: [campaignRow('400000')],
        ...(options.cycle ? { nextPageToken: 'second' } : {}),
      });
    }
    if (query.includes('FROM campaign')) {
      return Response.json({ results: [{ campaign: {
        id: '101', name: 'Search fixture', status: 'PAUSED',
        advertisingChannelType: 'SEARCH',
      } }] });
    }
    if (query.includes('FROM ad_group_criterion')) {
      return Response.json({ results: [{ campaign: { id: '101' },
        adGroup: { id: '202' }, adGroupCriterion: {
          criterionId: '303', keyword: { text: 'fixture', matchType: 'EXACT' },
          status: 'ENABLED',
        },
      }] });
    }
    if (query.includes('FROM keyword_view')) {
      return Response.json({ results: [{ ...campaignRow('400000'),
        adGroup: { id: '202' }, adGroupCriterion: {
          criterionId: '303', keyword: { text: 'fixture', matchType: 'EXACT' },
        },
      }] });
    }
    if (query.includes('FROM ad_group_ad')) {
      return Response.json({ results: [{ ...campaignRow('700000'), adGroupAd: {
        ad: { id: '404', type: 'RESPONSIVE_SEARCH_AD' }, status: 'ENABLED',
      } }] });
    }
    throw Error('unexpected Google Ads fixture query: ' + query);
  });
  vi.stubGlobal('fetch', mocked);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

it('authenticates without a developer token or developer-token header', async () => {
  const requests = stubAds();
  const first = await get('/v1/google-ads/accounts');
  expect(first.status).toBe(200);
  expect(requests.length).toBeGreaterThan(0);
  const legacy = await get('/v1/google-ads/accounts', {
    ...credentials, GOOGLE_ADS_DEVELOPER_TOKEN: 'unused-legacy-value',
  });
  expect(legacy.status).toBe(200);
});

it('refreshes OAuth and discovers managed accounts with native currencies and zones', async () => {
  const calls = stubAds();
  const response = await get('/v1/google-ads/accounts');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accounts: [
    { id, name: 'Client fixture', currency: 'EUR', time_zone: 'Europe/Helsinki',
      manager: false, login_customer_id: manager },
    { id: manager, name: 'Manager fixture', currency: 'EUR', time_zone: 'Europe/Helsinki',
      manager: true, login_customer_id: null },
  ] });
  expect(calls.some((x) => String(x.request.query).includes('FROM customer_client'))).toBe(true);
});

it('keeps directly accessible standalone accounts outside the configured manager usable', async () => {
  stubAds({ mixedDirect: true });
  const response = await get('/v1/google-ads/accounts');
  expect(response.status).toBe(200);
  const result = await response.json() as { accounts: Array<{
    id: string; login_customer_id: string | null;
  }> };
  expect(result.accounts.map((account) => account.id)).toEqual([
    '1111111111', id, manager,
  ]);
  expect(result.accounts[0].login_customer_id).toBeNull();
  expect(result.accounts[1].login_customer_id).toBe(manager);
  for (const customerId of ['1111111111', id]) {
    for (const route of ['campaigns', 'keywords', 'spend?from=2026-10-08&to=2026-10-08']) {
      const read = await get('/v1/google-ads/accounts/' + customerId + '/' + route);
      expect(read.status).toBe(200);
      const body = await read.json() as { account?: { login_customer_id: string | null } };
      if (body.account) expect(body.account.login_customer_id).toBe(customerId === id ? manager : null);
    }
  }
});

it.each([undefined, null, ''])('reads unnamed direct and managed accounts: %s', async (value) => {
  stubAds({ mixedDirect: true, nameValue: { value } });
  const discovery = await get('/v1/google-ads/accounts');
  expect(discovery.status).toBe(200);
  const result = await discovery.json() as { accounts: Array<{ name: string | null }> };
  expect(result.accounts.map((account) => account.name)).toEqual([null, null, null]);
  for (const customerId of ['1111111111', id]) {
    const response = await get('/v1/google-ads/accounts/' + customerId +
      '/spend?from=2026-10-08&to=2026-10-08');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account_spend_micros: '1000001' });
  }
});

it.each([manager, ''])('reads each managed client through its discovered hierarchy: %s', async (login) => {
  stubAds({ multipleManagers: true, mixedDirect: true });
  const config = { ...credentials, GOOGLE_ADS_LOGIN_CUSTOMER_ID: login };
  const discovery = await get('/v1/google-ads/accounts', config);
  expect(discovery.status).toBe(200);
  const result = await discovery.json() as { accounts: Array<{
    id: string; login_customer_id: string | null;
  }> };
  expect(result.accounts.find((account) => account.id === secondClient)?.login_customer_id).toBe(secondManager);
  for (const customerId of [id, secondClient, '1111111111']) {
    for (const route of ['campaigns', 'keywords', 'spend?from=2026-10-08&to=2026-10-08']) {
      const response = await get('/v1/google-ads/accounts/' + customerId + '/' + route, config);
      expect(response.status).toBe(200);
      const body = await response.json() as { account?: { login_customer_id: string | null } };
      if (body.account) {
        const expectedLogin = customerId === id ? manager : customerId === secondClient ? secondManager : null;
        expect(body.account.login_customer_id).toBe(expectedLogin);
      } else {
        expect(body).toMatchObject({ customer_id: customerId, account_spend_micros: '1000001' });
      }
    }
  }
});

it.each([7, true, {}])('rejects populated non-string account names: %s', async (value) => {
  stubAds({ nameValue: { value } });
  expect((await get('/v1/google-ads/accounts')).status).toBe(502);
});

it.each(['1234567890', 'customers/123-456-7890', 'customers/1234567890/extra', 7, null])(
  'rejects malformed accessible customer identities: %s', async (value) => {
    stubAds({ accessibleNames: [value] });
    const response = await get('/v1/google-ads/accounts');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'google_ads_invalid_account_list' });
  },
);

it.each([undefined, null, 'true', 0])('rejects malformed manager flags: %s', async (value) => {
  stubAds({ managerValue: { value } });
  const discovery = await get('/v1/google-ads/accounts');
  expect(discovery.status).toBe(502);
  expect(await discovery.json()).toMatchObject({ error: 'google_ads_invalid_manager_flag' });
  const spend = await get('/v1/google-ads/accounts/' + id +
    '/spend?from=2026-10-08&to=2026-10-08');
  expect(spend.status).toBe(502);
  expect(await spend.json()).toMatchObject({ error: 'google_ads_invalid_manager_flag' });
});

it('enforces the account limit for directly accessible non-manager accounts', async () => {
  const calls = stubAds({ directAccounts: 1001 });
  const response = await get('/v1/google-ads/accounts');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: 'google_ads_account_limit_exceeded' });
  expect(calls).toHaveLength(1001);
  expect(calls.every((call) => !String(call.request.query).includes('customer_client'))).toBe(true);
});

it('converts upstream fetch and JSON failures into secret-free machine-readable errors', async () => {
  stubAds({ adsNetworkFailure: true });
  const failure = await get('/v1/google-ads/accounts');
  expect(failure.status).toBe(503);
  expect(await failure.json()).toEqual({
    error: 'google_ads_network_unavailable', request_id: null,
  });
  vi.unstubAllGlobals();
  stubAds({ badJson: true });
  const invalid = await get('/v1/google-ads/accounts');
  expect(invalid.status).toBe(502);
  expect(await invalid.json()).toMatchObject({ error: 'google_ads_invalid_response' });
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-oauth-error')));
  const oauth = await get('/v1/google-ads/accounts');
  expect(oauth.status).toBe(503);
  expect(await oauth.json()).toMatchObject({ error: 'google_ads_oauth_unavailable' });
});

it.each(['account', 'spend'] as const)('rejects malformed rows in %s responses', async (source) => {
  stubAds({ invalidRows: source });
  const path = source === 'account' ? '/v1/google-ads/accounts' :
    '/v1/google-ads/accounts/' + id + '/spend?from=2026-10-08&to=2026-10-08';
  const response = await get(path);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'google_ads_invalid_response', request_id: null });
});

it.each([0, false, null])('rejects malformed pagination tokens before declaring completeness: %s', async (value) => {
  stubAds({ pageTokenValue: { value } });
  const response = await get('/v1/google-ads/accounts/' + id +
    '/spend?from=2026-10-08&to=2026-10-08');
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'google_ads_invalid_page_token', request_id: null });
});

it('reads all paginated campaign cost as exact micro-units separately from native total', async () => {
  const calls = stubAds();
  const response = await get('/v1/google-ads/accounts/' + id +
    '/spend?from=2026-10-08&to=2026-10-08&view=campaign');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    currency: 'EUR', time_zone: 'Europe/Helsinki',
    period: { from: '2026-10-08', to: '2026-10-08',
      basis: 'google_ads_customer_local_date' },
    account_spend_micros: '1000001', breakdown_spend_micros: '1000001',
    undistributed_micros: '0', view: 'campaign', complete: true,
    rows: [campaignRow('600001'), campaignRow('400000')],
  });
  expect(calls.filter((x) => String(x.request.query).includes('FROM campaign') &&
    String(x.request.query).includes('metrics.cost_micros'))).toHaveLength(2);
});

it('reports keyword and creative as independent non-additive breakdowns', async () => {
  stubAds();
  const keywords = await get('/v1/google-ads/accounts/' + id +
    '/spend?from=2026-10-08&to=2026-10-08&view=keyword');
  expect(await keywords.json()).toMatchObject({
    account_spend_micros: '1000001', breakdown_spend_micros: '400000',
    undistributed_micros: '600001',
  });
  const creatives = await get('/v1/google-ads/accounts/' + id +
    '/spend?from=2026-10-08&to=2026-10-08&view=creative');
  expect(await creatives.json()).toMatchObject({
    account_spend_micros: '1000001', breakdown_spend_micros: '700000',
    undistributed_micros: '300001',
  });
});

it('reads campaign and keyword inventory with stable native IDs', async () => {
  stubAds();
  const campaigns = await get('/v1/google-ads/accounts/' + id + '/campaigns');
  expect(await campaigns.json()).toMatchObject({
    complete: true, view: 'campaigns', rows: [{ campaign: { id: '101', status: 'PAUSED' } }],
  });
  const keywords = await get('/v1/google-ads/accounts/' + id + '/keywords');
  expect(await keywords.json()).toMatchObject({
    complete: true, view: 'keywords',
    rows: [{ adGroupCriterion: { criterionId: '303', keyword: { matchType: 'EXACT' } } }],
  });
});

it('fails explicitly on invalid dates, account IDs and repeated pagination tokens', async () => {
  const calls = stubAds({ cycle: true });
  expect((await get('/v1/google-ads/accounts/' + id +
    '/spend?from=2026-02-30&to=2026-10-08')).status).toBe(400);
  expect((await get('/v1/google-ads/accounts/invalid/campaigns')).status).toBe(400);
  const response = await get('/v1/google-ads/accounts/' + id +
    '/spend?from=2026-10-08&to=2026-10-08');
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: 'google_ads_invalid_page_token' });
  expect(calls.some((x) => x.request.pageToken === 'second')).toBe(true);
});

it('reports expired credentials and quota exhaustion without leaking secrets', async () => {
  stubAds({ oauthFailure: true });
  const expired = await get('/v1/google-ads/accounts');
  expect(expired.status).toBe(401);
  expect(await expired.json()).toMatchObject({ error: 'google_ads_reauthorization_required' });
  vi.unstubAllGlobals();
  stubAds({ quota: true });
  const quota = await get('/v1/google-ads/accounts');
  expect(quota.status).toBe(503);
  expect(await quota.json()).toEqual({
    error: 'google_ads_quota_or_service_unavailable', request_id: 'quota-fixture-id',
  });
});

it('never touches Google without API authorization or required OAuth secrets', async () => {
  const fake = vi.fn();
  vi.stubGlobal('fetch', fake);
  const unauthorized = await worker.fetch(new Request(base + '/v1/google-ads/accounts'), env as Env);
  expect(unauthorized.status).toBe(401);
  const missing = await worker.fetch(new Request(base + '/v1/google-ads/accounts', {
    headers: { Authorization: 'Bearer test-only-economic-ledger' },
  }), env as Env);
  expect(missing.status).toBe(503);
  expect(await missing.json()).toMatchObject({ error: 'google_ads_credentials_not_configured' });
  expect(fake).not.toHaveBeenCalled();
});
