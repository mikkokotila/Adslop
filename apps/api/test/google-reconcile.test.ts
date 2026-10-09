import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

const customer = '1234567890';
const base = 'https://adslop.test';
const credentials = {
  GOOGLE_ADS_CLIENT_ID: 'fixture-client',
  GOOGLE_ADS_CLIENT_SECRET: 'fixture-secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'fixture-refresh',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'fixture-developer',
};

async function api(path: string, body?: object): Promise<Response> {
  return worker.fetch(new Request(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer test-only-economic-ledger' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), { ...env, ...credentials } as Env);
}

const path = '/v1/google-ads/accounts/' + customer;
const product = 'reconcile-fixture';
const mapping = {
  product_id: product, from: '2026-10-08', to: '2026-10-08', campaign_ids: ['101'],
};
const report = () => api(path + '/reconcile', mapping);
const history = () => api(path + '/revisions');
const economics = () => api('/v1/economics?product_id=' + product + '&currency=EUR');

function native(values: {
  one?: string | null; two?: string | null; override?: string; currency?: string;
  date?: string; beforeCampaign?: () => Promise<void>;
} = {}) {
  const first = values.one === undefined ? '1000001' : values.one;
  const second = values.two === undefined ? null : values.two;
  const all = [first, second].filter((v): v is string => v !== null);
  const total = values.override ?? all.reduce((n, v) => n + BigInt(v), 0n).toString();
  const mocked = vi.fn(async (resource: RequestInfo | URL, options?: RequestInit) => {
    const url = String(resource);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'fixture-token' });
    }
    expect(new Headers(options?.headers).get('developer-token')).toBe('fixture-developer');
    expect(new Headers(options?.headers).get('login-customer-id')).toBeNull();
    if (url.endsWith('/customers:listAccessibleCustomers')) {
      return Response.json({ resourceNames: ['customers/' + customer] });
    }
    const request = JSON.parse(options?.body as string) as { query: string };
    if (request.query.includes('customer.id')) {
      return Response.json({ results: [{
        customer: { id: customer, descriptiveName: 'Fixture account',
          currencyCode: values.currency ?? 'EUR', timeZone: 'Europe/Helsinki', manager: false },
      }] });
    }
    if (request.query.includes('FROM customer')) {
      return Response.json({ results: [{
        segments: { date: '2026-10-08' }, metrics: { costMicros: total },
      }] });
    }
    if (request.query.includes('FROM campaign')) {
      await values.beforeCampaign?.();
      const rows = [];
      if (first !== null) rows.push({
        segments: { date: values.date ?? '2026-10-08' },
        campaign: { id: '101', name: 'Fixture Search one' },
        metrics: { costMicros: first, clicks: '2', impressions: '50' },
      });
      if (second !== null) rows.push({
        segments: { date: '2026-10-08' },
        campaign: { id: '202', name: 'Fixture Search two' },
        metrics: { costMicros: second, clicks: '3', impressions: '60' },
      });
      return Response.json({ results: rows });
    }
    throw Error('unexpected fixture GAQL query ' + request.query);
  });
  vi.stubGlobal('fetch', mocked);
  return mocked;
}

beforeEach(async () => { await reset(); });
afterEach(() => vi.unstubAllGlobals());

it('imports a source-reconciled daily campaign exactly once alongside subscription receipts', async () => {
  native();
  expect((await api('/v1/observations', {
    product_id: product, source: 'receipt-fixture', event_id: 'one',
    kind: 'subscription_receipt', amount_minor: 1000, currency: 'EUR',
    channel: null, occurred_at: '2026-10-08T12:00:00.000Z',
  })).status).toBe(201);
  const first = await report();
  expect(first.status).toBe(201);
  expect(await first.json()).toMatchObject({
    created: 1, corrected: 0, duplicate: 0, source_account_spend_micros: '1000001',
    selected_campaign_spend_micros: '1000001', currency: 'EUR',
    time_zone: 'Europe/Helsinki',
  });
  const repeat = await report();
  expect(repeat.status).toBe(200);
  expect(await repeat.json()).toMatchObject({ created: 0, corrected: 0, duplicate: 1 });
  const outcome = await economics();
  expect(await outcome.json()).toMatchObject({
    subscription_revenue_minor: 1000, advertising_spend_minor: null,
    advertising_spend_micros: '1000001', difference_minor: null,
    difference_micros: '8999999',
    advertising_spend_by_channel_minor: { google: null, meta: 0 },
  });
  const journal = await history();
  expect(await journal.json()).toMatchObject({ revisions: [
    { campaign_id: '101', local_date: '2026-10-08', revision: 1,
      cost_micros: '1000001', currency: 'EUR', time_zone: 'Europe/Helsinki' },
  ] });
});

it('records native reporting corrections as new revisions without double-counting', async () => {
  native();
  expect((await report()).status).toBe(201);
  vi.unstubAllGlobals();
  native({ one: '2000001' });
  const correction = await report();
  expect(correction.status).toBe(200);
  expect(await correction.json()).toMatchObject({ created: 0, corrected: 1, duplicate: 0 });
  expect((await (await economics()).json())).toMatchObject({
    advertising_spend_micros: '2000001', difference_micros: '-2000001',
  });
  expect((await (await history()).json())).toMatchObject({ revisions: [
    { revision: 1, cost_micros: '1000001' },
    { revision: 2, cost_micros: '2000001' },
  ] });
  expect((await (await report()).json())).toMatchObject({ corrected: 0, duplicate: 1 });
});

it('does not create spend from two different dimensions or two products assigned to one campaign', async () => {
  native({ one: '1000000', two: '3000000' });
  const first = await report();
  expect(await first.json()).toMatchObject({
    selected_campaign_spend_micros: '1000000',
    source_account_spend_micros: '4000000',
  });
  expect((await (await economics()).json())).toMatchObject({
    advertising_spend_minor: 100, advertising_spend_micros: '1000000',
  });
  const collision = await api(path + '/reconcile', { ...mapping, product_id: 'other-product' });
  expect(collision.status).toBe(409);
  expect(await collision.json()).toMatchObject({ error: 'google_ads_source_identity_conflict' });
  const second = await api(path + '/reconcile', {
    ...mapping, product_id: 'other-product', campaign_ids: ['202'],
  });
  expect(second.status).toBe(201);
  const other = await api('/v1/economics?product_id=other-product&currency=EUR');
  expect(await other.json()).toMatchObject({ advertising_spend_minor: 300 });
});

it('rejects source total breaks atomically instead of inventing balancing costs', async () => {
  native({ one: '1000000', override: '2000000' });
  const result = await report();
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: 'google_ads_account_campaign_cost_break' });
  expect((await (await history()).json())).toMatchObject({ revisions: [] });
});

it.each([
  { campaign: '909', one: '1000001' },
  { campaign: '101', one: null },
])('rejects unreported requested campaign $campaign instead of claiming a duplicate', async ({ campaign, one }) => {
  native({ one });
  const result = await api(path + '/reconcile', { ...mapping, campaign_ids: [campaign] });
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: 'google_ads_no_selected_campaign_cost_rows' });
  expect(await (await history()).json()).toMatchObject({ revisions: [] });
  expect(await (await economics()).json()).toMatchObject({ advertising_spend_micros: '0' });
});

it('does not erase previously reported expenditure when a native cost row vanishes', async () => {
  native();
  expect((await report()).status).toBe(201);
  vi.unstubAllGlobals();
  native({ one: null, override: '0' });
  const result = await report();
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: 'google_ads_missing_prior_source_row' });
  expect((await (await economics()).json())).toMatchObject({ advertising_spend_micros: '1000001' });
});

it.each(['ad_spend', 'ad_credit'])('rejects overlapping manual Google %s in both admission orders', async (kind) => {
  native();
  const manual = {
    product_id: product, source: 'manual-fixture', event_id: 'overlap',
    kind, channel: 'google', amount_minor: 200,
    currency: 'EUR', occurred_at: '2026-10-08T12:00:00.000Z',
  };
  expect((await api('/v1/observations', manual)).status).toBe(201);
  const denied = await report();
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({ error: 'google_ads_manual_spend_overlap' });
  expect((await (await history()).json())).toMatchObject({ revisions: [] });
  const secondProduct = 'reconcile-second-fixture';
  expect((await api(path + '/reconcile', { ...mapping, product_id: secondProduct })).status).toBe(201);
  const after = await api('/v1/observations', { ...manual, product_id: secondProduct });
  expect(after.status).toBe(409);
  expect(await after.json()).toMatchObject({ error: 'google_ads_manual_spend_overlap' });
  const totals = await api('/v1/economics?product_id=' + secondProduct + '&currency=EUR');
  expect(await totals.json()).toMatchObject({ advertising_spend_micros: '1000001' });
});

it.each(['2026-99-08', '2026-02-30'])('rejects invalid source date %s atomically and permits a retry', async (date) => {
  native({ date });
  const invalid = await report();
  expect(invalid.status).toBe(502);
  expect(await invalid.json()).toMatchObject({ error: 'google_ads_invalid_source_date' });
  expect(await (await history()).json()).toMatchObject({ revisions: [] });
  expect(await (await economics()).json()).toMatchObject({ advertising_spend_micros: '0' });
  vi.unstubAllGlobals();
  native();
  expect((await report()).status).toBe(201);
});

it('rejects overlapping acquisition before it can append an out-of-order cost revision', async () => {
  let enter!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  let held = false;
  const mock = native({ beforeCampaign: async () => {
    if (held) return;
    held = true;
    enter();
    await paused;
  } });
  const first = report();
  await entered;
  const newer = native({ one: '2000001' });
  const overlapping = await report();
  resume();
  const accepted = await first;
  expect(overlapping.status).toBe(409);
  expect(await overlapping.json()).toMatchObject({ error: 'google_ads_reconcile_busy' });
  expect(accepted.status).toBe(201);
  expect(mock).toHaveBeenCalledTimes(5);
  expect(newer).not.toHaveBeenCalled();
  expect(await (await history()).json()).toMatchObject({ revisions: [
    { revision: 1, cost_micros: '1000001' },
  ] });
  expect((await report()).status).toBe(200);
  expect(await (await economics()).json()).toMatchObject({ advertising_spend_micros: '2000001' });
  expect(await (await history()).json()).toMatchObject({ revisions: [
    { revision: 1, cost_micros: '1000001' }, { revision: 2, cost_micros: '2000001' },
  ] });
});

it('preserves source error evidence across RPC and releases acquisition for retry', async () => {
  native().mockResolvedValueOnce(new Response('', {
    status: 503,
  }));
  const failed = await report();
  expect(failed.status).toBe(503);
  expect(await failed.json()).toMatchObject({ error: 'google_ads_oauth_unavailable', request_id: null });
  expect(await (await history()).json()).toMatchObject({ revisions: [] });
  expect((await report()).status).toBe(201);
});

it('does not let malformed mapping or unauthenticated requests call Google', async () => {
  const mock = native();
  const malformed = await api(path + '/reconcile', { ...mapping, campaign_ids: ['101', '101'] });
  expect(malformed.status).toBe(400);
  const unauthorized = await worker.fetch(new Request(base + path + '/reconcile', {
    method: 'POST', body: JSON.stringify(mapping),
  }), { ...env, ...credentials } as Env);
  expect(unauthorized.status).toBe(401);
  expect(mock).not.toHaveBeenCalled();
});
