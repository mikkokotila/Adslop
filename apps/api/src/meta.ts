// Read-only Meta Marketing API spend evidence. Nothing here writes to the money ledger.
const graphOrigin = "https://graph.facebook.com";
const graphVersion = "v25.0";
const maximumPages = 20;
const maximumRows = 10000;

export type MetaLevel = "account" | "campaign" | "adset" | "ad";
type MetaJson = Record<string, unknown>;

export class MetaReadError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function object(value: unknown): MetaJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MetaReadError("meta_invalid_response", 502);
  }
  return value as MetaJson;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new MetaReadError("meta_invalid_response", 502);
  return value;
}

function accountId(value: string): string {
  if (!/^(?:act_)?[0-9]{1,32}$/.test(value)) {
    throw new MetaReadError("meta_invalid_account", 400);
  }
  return value.replace(/^act_/, "");
}

function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MetaReadError("meta_invalid_dates", 400);
  const n = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) {
    throw new MetaReadError("meta_invalid_dates", 400);
  }
  return n;
}

// Source fields are Meta's responsibility, not caller-supplied query parameters.
// Translate source violations to a 502 rather than blaming the API caller.
function sourceAccountId(value: unknown): string {
  try {
    return accountId(string(value));
  } catch {
    throw new MetaReadError("meta_invalid_response", 502);
  }
}

function sourceDay(value: unknown): number {
  try {
    return day(string(value));
  } catch {
    throw new MetaReadError("meta_invalid_response", 502);
  }
}

export function exactMetaMinor(spend: string, currency: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(spend) ||
      !/^[A-Z]{3}$/.test(currency)) throw new MetaReadError("meta_invalid_money", 502);
  let digits: number;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? -1;
  } catch {
    throw new MetaReadError("meta_invalid_currency", 502);
  }
  if (digits < 0 || digits > 3) throw new MetaReadError("meta_invalid_currency", 502);
  const [whole, fraction = ""] = spend.split(".");
  if (fraction.length > digits) throw new MetaReadError("meta_invalid_money", 502);
  return BigInt(whole) * 10n ** BigInt(digits) +
    BigInt((fraction + "0".repeat(digits)).slice(0, digits) || "0");
}

function graphUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`/${graphVersion}/${path}`, graphOrigin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function graphGet(url: URL, token: string): Promise<MetaJson> {
  let reply: Response;
  try {
    reply = await fetch(url, {
      method: "GET", redirect: "manual",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch {
    throw new MetaReadError("meta_unavailable", 502);
  }
  if (!reply.ok) {
    throw new MetaReadError(
      reply.status === 401 || reply.status === 403 ? "meta_access_denied" :
      reply.status === 429 ? "meta_rate_limited" : "meta_upstream_failed",
      reply.status === 429 ? 429 : 502
    );
  }
  try {
    return object(await reply.json());
  } catch {
    throw new MetaReadError("meta_invalid_response", 502);
  }
}

async function graphPages(path: string, params: Record<string, string>, token: string):
  Promise<MetaJson[]> {
  const initial = graphUrl(path, params);
  const seen = new Set<string>();
  const rows: MetaJson[] = [];
  let url: URL | null = initial;
  for (let page = 0; page < maximumPages && url; page++) {
    const key = url.toString();
    if (seen.has(key)) throw new MetaReadError("meta_paging_loop", 502);
    seen.add(key);
    const body = await graphGet(url, token);
    if (!Array.isArray(body.data)) throw new MetaReadError("meta_invalid_response", 502);
    for (const item of body.data) {
      if (rows.length >= maximumRows) throw new MetaReadError("meta_page_limit", 502);
      rows.push(object(item));
    }
    const paging = body.paging === undefined ? null : object(body.paging);
    const next = paging?.next;
    if (next === undefined || next === null) {
      url = null;
      break;
    }
    if (typeof next !== "string") throw new MetaReadError("meta_invalid_page", 502);
    let following: URL;
    try {
      following = new URL(next);
    } catch {
      throw new MetaReadError("meta_invalid_page", 502);
    }
    if (following.origin !== graphOrigin || following.pathname !== initial.pathname) {
      throw new MetaReadError("meta_invalid_page", 502);
    }
    // Meta can place the access token into paging URLs. Never propagate it in
    // a query string; all requests use the Authorization header instead.
    following.searchParams.delete("access_token");
    url = following;
  }
  if (url) throw new MetaReadError("meta_page_limit", 502);
  return rows;
}

export type MetaAccount = {
  account_id: string; name: string; currency: string;
  timezone_name: string; account_status: number | null;
};

function parseAccount(value: MetaJson): MetaAccount {
  const id = sourceAccountId(value.id);
  const currency = string(value.currency);
  if (!/^[A-Z]{3}$/.test(currency)) throw new MetaReadError("meta_invalid_currency", 502);
  const tz = string(value.timezone_name);
  if (!tz) throw new MetaReadError("meta_invalid_response", 502);
  const status = value.account_status;
  if (status !== undefined && (!Number.isSafeInteger(status) || typeof status !== "number")) {
    throw new MetaReadError("meta_invalid_response", 502);
  }
  return {
    account_id: id, name: string(value.name), currency,
    timezone_name: tz, account_status: typeof status === "number" ? status : null,
  };
}

async function getAccount(id: string, token: string): Promise<MetaAccount> {
  const account = parseAccount(await graphGet(graphUrl(`act_${id}`, {
    fields: "id,name,currency,timezone_name,account_status",
  }), token));
  if (account.account_id !== id) throw new MetaReadError("meta_account_mismatch", 502);
  return account;
}

export type DailySpendRow = {
  date_start: string; date_stop: string; spend_minor: string;
  entity_id: string; entity_name: string | null;
  impressions: string | null; clicks: string | null;
};

function parseSpendRows(
  data: MetaJson[], level: MetaLevel, account: MetaAccount,
  since: number, until: number
): DailySpendRow[] {
  const idField = level === "account" ? "account_id" : level + "_id";
  const nameField = level + "_name";
  const rows = data.map((entry) => {
    const date = string(entry.date_start), stop = string(entry.date_stop);
    const parsedDate = sourceDay(date), parsedStop = sourceDay(stop);
    if (parsedDate !== parsedStop || parsedDate < since || parsedDate > until) {
      throw new MetaReadError("meta_invalid_response", 502);
    }
    const accountOnRow = sourceAccountId(entry.account_id);
    if (accountOnRow !== account.account_id) throw new MetaReadError("meta_account_mismatch", 502);
    const entityId = level === "account" ? account.account_id : sourceAccountId(entry[idField]);
    const name = level === "account" ? account.name : entry[nameField];
    if (name !== undefined && name !== null && typeof name !== "string") {
      throw new MetaReadError("meta_invalid_response", 502);
    }
    for (const metric of ["impressions", "clicks"]) {
      if (entry[metric] !== undefined && !/^(?:0|[1-9][0-9]*)$/.test(string(entry[metric]))) {
        throw new MetaReadError("meta_invalid_response", 502);
      }
    }
    return {
      date_start: date, date_stop: stop, entity_id: entityId,
      entity_name: typeof name === "string" ? name : null,
      spend_minor: exactMetaMinor(string(entry.spend), account.currency).toString(),
      impressions: entry.impressions === undefined ? null : string(entry.impressions),
      clicks: entry.clicks === undefined ? null : string(entry.clicks),
    };
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.entity_id + ":" + row.date_start;
    if (seen.has(key)) throw new MetaReadError("meta_duplicate_row", 502);
    seen.add(key);
  }
  return rows;
}

async function dailyInsights(id: string, level: MetaLevel, token: string,
  account: MetaAccount, since: string, until: string): Promise<DailySpendRow[]> {
  const fields = ["account_id", "date_start", "date_stop", "spend", "impressions", "clicks"];
  if (level !== "account") fields.push(level + "_id", level + "_name");
  const data = await graphPages(`act_${id}/insights`, {
    fields: fields.join(","), level, time_increment: "1", limit: "250",
    time_range: JSON.stringify({ since, until }),
  }, token);
  return parseSpendRows(data, level, account, day(since), day(until));
}

export type MetaSpendReport = {
  account: MetaAccount;
  since: string;
  until: string;
  level: MetaLevel;
  graph_version: string;
  observed_at: string;
  account_spend_minor: string;
  account_rows: DailySpendRow[];
  rows: DailySpendRow[];
  source: "meta_insights";
  imported_to_ledger: false;
  complete: true;
  reporting: "platform_reported_not_billing_settlement";
  breakdowns_additive_with_account: false;
};

/** One complete Meta Insights snapshot in the account's local calendar. */
export async function readMetaSpendReport(
  id: string, since: string, until: string, level: MetaLevel, token: string
): Promise<MetaSpendReport> {
  const accountIdValue = accountId(id);
  const start = day(since), stop = day(until);
  if (start > stop || stop - start > 30 * 86_400_000) {
    throw new MetaReadError("meta_invalid_dates", 400);
  }
  const account = await getAccount(accountIdValue, token);
  const accountRows = await dailyInsights(accountIdValue, "account", token, account, since, until);
  const rows = level === "account" ? accountRows :
    await dailyInsights(accountIdValue, level, token, account, since, until);
  return {
    account, since, until, level, graph_version: graphVersion,
    observed_at: new Date().toISOString(),
    account_spend_minor: accountRows.reduce(
      (sum, row) => sum + BigInt(row.spend_minor), 0n
    ).toString(),
    rows, account_rows: accountRows,
    source: "meta_insights", imported_to_ledger: false, complete: true,
    reporting: "platform_reported_not_billing_settlement",
    breakdowns_additive_with_account: false,
  };
}

function reportResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

export async function handleMetaRequest(url: URL, accessToken: string | undefined): Promise<Response> {
  if (!accessToken) return reportResponse({ error: "meta_not_configured" }, 503);
  try {
    if (url.pathname === "/v1/meta/accounts") {
      if (url.search) throw new MetaReadError("meta_invalid_query", 400);
      const data = await graphPages("me/adaccounts", {
        fields: "id,name,currency,timezone_name,account_status", limit: "100",
      }, accessToken);
      return reportResponse({
        accounts: data.map(parseAccount), source: "meta_graph",
        graph_version: graphVersion, observed_at: new Date().toISOString(),
        imported_to_ledger: false,
      });
    }
    if (url.pathname === "/v1/meta/spend") {
      const allowed = new Set(["account_id", "since", "until", "level"]);
      if ([...url.searchParams.keys()].some(key => !allowed.has(key) ||
          url.searchParams.getAll(key).length !== 1)) {
        throw new MetaReadError("meta_invalid_query", 400);
      }
      const rawId = url.searchParams.get("account_id");
      const since = url.searchParams.get("since");
      const until = url.searchParams.get("until");
      const level = url.searchParams.get("level") ?? "account";
      if (!rawId || !since || !until || !["account", "campaign", "adset", "ad"].includes(level)) {
        throw new MetaReadError("meta_invalid_query", 400);
      }
      return reportResponse(await readMetaSpendReport(
        rawId, since, until, level as MetaLevel, accessToken
      ));
    }
    return reportResponse({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof MetaReadError) {
      return reportResponse({ error: error.code }, error.status);
    }
    throw error;
  }
}
