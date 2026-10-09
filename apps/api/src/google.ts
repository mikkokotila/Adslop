import type { GoogleSpendReport } from './google-ledger';

/**
 * Read-only Google Ads REST client. Every amount remains an integer micro-unit
 * decimal string; none of the reporting views are additional expenditure.
 */

export interface GoogleAdsConfig {
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  GOOGLE_ADS_CLIENT_ID: string;
  GOOGLE_ADS_CLIENT_SECRET: string;
  GOOGLE_ADS_REFRESH_TOKEN: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
}

export class GoogleAdsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly requestId: string | null = null,
  ) {
    super(code);
  }
}

type AdsRow = Record<string, unknown>;

interface SearchPage {
  results?: AdsRow[];
  nextPageToken?: string;
}

interface Account {
  id: string;
  name: string;
  currency: string;
  time_zone: string;
  manager: boolean;
  login_customer_id: string | null;
}

const root = 'https://googleads.googleapis.com/v25';
const idPattern = /^[0-9]{10}$/;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GoogleAdsError('google_ads_invalid_response', 502);
  }
  return value as Record<string, unknown>;
}

function property(row: AdsRow, key: string): Record<string, unknown> {
  return object(row[key]);
}

function textField(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new GoogleAdsError('google_ads_invalid_response', 502);
  }
  return value;
}

function googleId(value: unknown): string {
  const id = textField(value);
  if (!idPattern.test(id)) throw new GoogleAdsError('google_ads_invalid_account', 502);
  return id;
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function period(url: URL): { from: string; to: string } {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!validDate(from) || !validDate(to) || from > to) {
    throw new GoogleAdsError('google_ads_invalid_date_range', 400);
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > 366) throw new GoogleAdsError('google_ads_date_range_too_large', 400);
  return { from, to };
}

function amountMicros(row: AdsRow): bigint {
  const amount = property(row, 'metrics').costMicros;
  if (typeof amount !== 'string' || !/^-?\d+$/.test(amount)) {
    throw new GoogleAdsError('google_ads_invalid_cost_micros', 502);
  }
  return BigInt(amount);
}

function accountFrom(value: Record<string, unknown>, loginId: string | null): Account {
  return {
    id: googleId(value.id),
    name: textField(value.descriptiveName),
    currency: textField(value.currencyCode),
    time_zone: textField(value.timeZone),
    manager: value.manager === true,
    login_customer_id: loginId,
  };
}

/** One request-scoped OAuth access token and bounded, complete GAQL paging. */
export class GoogleAdsClient {
  private constructor(
    private readonly env: GoogleAdsConfig,
    private readonly accessToken: string,
  ) {}

  static async connect(env: GoogleAdsConfig): Promise<GoogleAdsClient> {
    if (!env.GOOGLE_ADS_DEVELOPER_TOKEN || !env.GOOGLE_ADS_CLIENT_ID ||
        !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      throw new GoogleAdsError('google_ads_credentials_not_configured', 503);
    }
    if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID &&
        !idPattern.test(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)) {
      throw new GoogleAdsError('google_ads_invalid_login_customer_id', 503);
    }
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!response.ok) {
      throw new GoogleAdsError(
        response.status === 400 || response.status === 401
          ? 'google_ads_reauthorization_required'
          : 'google_ads_oauth_unavailable',
        response.status === 400 || response.status === 401 ? 401 : 503,
      );
    }
    const reply = object(await response.json());
    return new GoogleAdsClient(env, textField(reply.access_token));
  }

  async request(path: string, body?: Record<string, string>, loginId?: string): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: 'Bearer ' + this.accessToken,
      'developer-token': this.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    };
    const login = loginId ?? this.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    if (login) headers['login-customer-id'] = login;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(root + path, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const requestId = response.headers.get('request-id');
      if (response.status === 429 || response.status === 503) {
        throw new GoogleAdsError('google_ads_quota_or_service_unavailable', 503, requestId);
      }
      if (response.status === 401) {
        throw new GoogleAdsError('google_ads_reauthorization_required', 401, requestId);
      }
      if (response.status === 403) {
        throw new GoogleAdsError('google_ads_access_denied', 403, requestId);
      }
      throw new GoogleAdsError('google_ads_request_failed', 502, requestId);
    }
    return response.json();
  }

  async search(customerId: string, query: string, loginId?: string): Promise<AdsRow[]> {
    if (!idPattern.test(customerId)) throw new GoogleAdsError('google_ads_invalid_account', 400);
    const results: AdsRow[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    // A partial report cannot be labelled complete; error instead of truncating.
    for (let page = 0; page < 100; page++) {
      const payload: Record<string, string> = { query };
      if (pageToken) payload.pageToken = pageToken;
      const raw = object(await this.request(
        '/customers/' + customerId + '/googleAds:search', payload, loginId,
      )) as SearchPage;
      if (raw.results !== undefined && !Array.isArray(raw.results)) {
        throw new GoogleAdsError('google_ads_invalid_page', 502);
      }
      results.push(...(raw.results ?? []));
      const next = raw.nextPageToken;
      if (!next) return results;
      if (typeof next !== 'string' || seen.has(next)) {
        throw new GoogleAdsError('google_ads_invalid_page_token', 502);
      }
      seen.add(next);
      pageToken = next;
    }
    throw new GoogleAdsError('google_ads_page_limit_exceeded', 503);
  }

  async account(customerId: string): Promise<Account> {
    const rows = await this.search(customerId,
      'SELECT customer.id, customer.descriptive_name, customer.currency_code, ' +
      'customer.time_zone, customer.manager FROM customer');
    if (rows.length !== 1) throw new GoogleAdsError('google_ads_account_not_found', 502);
    return accountFrom(property(rows[0], 'customer'), this.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null);
  }

  async accounts(): Promise<Account[]> {
    const accessible = object(await this.request('/customers:listAccessibleCustomers'));
    if (!Array.isArray(accessible.resourceNames)) {
      throw new GoogleAdsError('google_ads_invalid_account_list', 502);
    }
    const accounts = new Map<string, Account>();
    for (const resource of accessible.resourceNames) {
      const id = textField(resource).replace(/^customers\//, '');
      if (!idPattern.test(id)) throw new GoogleAdsError('google_ads_invalid_account_list', 502);
      const customer = await this.account(id);
      accounts.set(id, customer);
      if (!customer.manager) continue;
      const children = await this.search(id,
        'SELECT customer_client.id, customer_client.descriptive_name, ' +
        'customer_client.currency_code, customer_client.time_zone, ' +
        'customer_client.manager, customer_client.status FROM customer_client', id);
      for (const item of children) {
        const child = property(item, 'customerClient');
        if (child.status !== 'ENABLED') continue;
        const member = accountFrom(child, id);
        if (!accounts.has(member.id)) accounts.set(member.id, member);
      }
      if (accounts.size > 1000) throw new GoogleAdsError('google_ads_account_limit_exceeded', 503);
    }
    return [...accounts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async inventory(customerId: string, type: 'campaigns' | 'keywords'): Promise<AdsRow[]> {
    const query = type === 'campaigns'
      ? 'SELECT campaign.id, campaign.name, campaign.status, ' +
        'campaign.advertising_channel_type, campaign.network_settings.target_google_search, ' +
        'campaign.network_settings.target_search_network, ' +
        'campaign.network_settings.target_content_network FROM campaign'
      : 'SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ' +
        'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
        "ad_group_criterion.status FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD'";
    return this.search(customerId, query);
  }

  async spend(customerId: string, url: URL): Promise<GoogleSpendReport> {
    const { from, to } = period(url);
    const view = url.searchParams.get('view') ?? 'campaign';
    if (!['account', 'campaign', 'keyword', 'creative'].includes(view)) {
      throw new GoogleAdsError('google_ads_invalid_view', 400);
    }
    const account = await this.account(customerId);
    if (account.manager) throw new GoogleAdsError('google_ads_manager_has_no_spend', 400);
    const dates = " WHERE segments.date BETWEEN '" + from + "' AND '" + to + "'";
    const daily = await this.search(customerId,
      'SELECT segments.date, metrics.cost_micros FROM customer' + dates);
    const total = daily.reduce((sum, row) => sum + amountMicros(row), 0n);
    const select = {
      account: 'SELECT segments.date, metrics.cost_micros FROM customer',
      campaign: 'SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, ' +
        'metrics.clicks, metrics.impressions FROM campaign',
      keyword: 'SELECT segments.date, campaign.id, ad_group.id, ' +
        'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
        'ad_group_criterion.keyword.match_type, metrics.cost_micros, metrics.clicks, ' +
        'metrics.impressions FROM keyword_view',
      creative: 'SELECT segments.date, campaign.id, ad_group.id, ' +
        'ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, ' +
        'metrics.cost_micros, metrics.clicks, metrics.impressions FROM ad_group_ad',
    }[view];
    const rows = view === 'account' ? daily : await this.search(customerId, select + dates);
    const subtotal = rows.reduce((sum, row) => sum + amountMicros(row), 0n);
    return {
      customer_id: account.id, currency: account.currency, time_zone: account.time_zone,
      period: { from, to, basis: 'google_ads_customer_local_date' },
      authority: 'google_ads_customer_metrics_cost_micros',
      account_spend_micros: total.toString(),
      view, breakdown_spend_micros: subtotal.toString(),
      undistributed_micros: (total - subtotal).toString(),
      complete: true, rows,
    };
  }
}

/** Bearer-protected Worker router for Google Ads source evidence. */
export async function googleAdsRead(url: URL, env: GoogleAdsConfig): Promise<Response> {
  const path = url.pathname;
  if (path === '/v1/google-ads/accounts') {
    const client = await GoogleAdsClient.connect(env);
    return Response.json({ accounts: await client.accounts() });
  }
  const match = /^\/v1\/google-ads\/accounts\/([^/]+)\/(campaigns|keywords|spend)$/.exec(path);
  if (!match || !idPattern.test(match[1])) throw new GoogleAdsError('google_ads_invalid_route', 400);
  const client = await GoogleAdsClient.connect(env);
  if (match[2] === 'spend') return Response.json(await client.spend(match[1], url));
  const account = await client.account(match[1]);
  const rows = await client.inventory(match[1], match[2] as 'campaigns' | 'keywords');
  return Response.json({ account, view: match[2], complete: true, rows });
}
