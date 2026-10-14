/** Read-only, source-dated economic subtotals. No inferred completeness or timezone proration. */
export interface EconomicPeriod {
  product_id: string; currency: string; from: string; to: string; time_zone: string;
}
export class EconomicPeriodError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export interface PeriodObservation {
  [key: string]: string | number | null;
  source: string; event_id: string; kind: string; amount_minor: number;
  channel: string | null; occurred_at: string;
}
export interface PeriodCost {
  [key: string]: string | number;
  platform: string; account_id: string; campaign_id: string; local_date: string;
  revision: number; time_zone: string; amount: string; observed_at: string;
}
export interface PeriodSources { observations: PeriodObservation[]; costs: PeriodCost[] }
const DAY = 86400000;
const MAX_ROWS = 10000;
function date(value: string | null): value is string {
  if (!value || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function zone(value: string, stored = false): string {
  try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new EconomicPeriodError(stored ? "economic_invalid_stored_time_zone" : "economic_invalid_time_zone", stored ? 500 : 400); }
}
export function parseEconomicPeriod(url: URL): EconomicPeriod {
  const q = url.searchParams;
  const expected = ["product_id", "currency", "from", "to", "time_zone"];
  if (q.size !== expected.length || [...q.keys()].some(k => !expected.includes(k))) {
    throw new EconomicPeriodError("economic_invalid_query");
  }
  const product = q.get("product_id"), unit = q.get("currency"), from = q.get("from"), to = q.get("to");
  const timezone = q.get("time_zone");
  if (!product || !/^[A-Za-z0-9_.:-]{1,128}$/.test(product) || product === "." || product === ".." ||
      !unit || !/^[A-Z]{3}$/.test(unit) || !date(from) || !date(to) || from > to ||
      (Date.parse(to) - Date.parse(from)) / DAY > 365 || !timezone || timezone.length > 100 ||
      Date.parse(to) + 2 * DAY >= 253402300800000) {
    throw new EconomicPeriodError("economic_invalid_query");
  }
  return { product_id: product, currency: unit, from, to, time_zone: zone(timezone) };
}
function localDate(instant: string, formatter: Intl.DateTimeFormat): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) throw new EconomicPeriodError("economic_invalid_stored_time", 500);
  const parts = formatter.formatToParts(parsed);
  return ["year", "month", "day"].map(key => parts.find(v => v.type === key)!.value).join("-");
}
function between(value: string, period: EconomicPeriod): boolean { return value >= period.from && value <= period.to; }
function minorFactor(currency: string): bigint {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined || digits > 6) throw new EconomicPeriodError("economic_currency_precision_unsupported", 422);
  return 10n ** BigInt(6 - digits);
}
/** Pure calculation over the explicitly supplied read snapshot; it performs no writes. */
export function summarizeEconomicPeriod(period: EconomicPeriod, sources: PeriodSources): object {
  const factor = minorFactor(period.currency);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: period.time_zone,
    year: "numeric", month: "2-digit", day: "2-digit" });
  let receipts = 0n, refunds = 0n, manualSpend = 0n, credits = 0n;
  const cash: object[] = [], manual: object[] = [];
  for (const row of sources.observations) {
    const day = localDate(row.occurred_at, formatter);
    if (!between(day, period)) continue;
    if (!Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0) {
      throw new EconomicPeriodError("economic_invalid_stored_money", 500);
    }
    const amount = BigInt(row.amount_minor);
    const evidence = { source: row.source, event_id: row.event_id, kind: row.kind,
      amount_minor: amount.toString(), occurred_at: row.occurred_at, local_date: day, channel: row.channel };
    if (row.kind === "subscription_receipt" || row.kind === "subscription_refund") {
      if (row.channel !== null) throw new EconomicPeriodError("economic_invalid_stored_channel", 500);
      if (row.kind === "subscription_receipt") receipts += amount;
      else refunds += amount;
      cash.push(evidence);
    } else if (row.kind === "ad_spend" || row.kind === "ad_credit") {
      if (row.channel !== "google" && row.channel !== "meta") throw new EconomicPeriodError("economic_invalid_stored_channel", 500);
      if (row.kind === "ad_spend") manualSpend += amount;
      else credits += amount;
      manual.push(evidence);
    } else throw new EconomicPeriodError("economic_invalid_stored_kind", 500);
  }
  // Latest selection belongs to the read snapshot; a source/day must appear once, not per revision.
  const selected = new Map<string, PeriodCost>();
  for (const row of sources.costs) {
    if (!date(row.local_date) || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
        !/^(0|[1-9][0-9]*)$/.test(row.amount) || !["google", "meta"].includes(row.platform)) {
      throw new EconomicPeriodError("economic_invalid_stored_cost", 500);
    }
    if (!between(row.local_date, period)) continue;
    const key = JSON.stringify([row.platform, row.account_id, row.campaign_id, row.local_date]);
    if (selected.has(key)) throw new EconomicPeriodError("economic_duplicate_source_day", 500);
    selected.set(key, row);
  }
  const groups = new Map<string, { platform: string; account_id: string; time_zone: string;
    comparable: boolean; micros: bigint; rows: object[]; latest_observed_at: string }>();
  let nativeSameZone = 0n;
  for (const row of selected.values()) {
    const sourceZone = zone(row.time_zone, true);
    const key = JSON.stringify([row.platform, row.account_id, sourceZone]);
    const comparable = sourceZone === period.time_zone;
    const micros = BigInt(row.amount) * (row.platform === "meta" ? factor : 1n);
    if (!Number.isFinite(Date.parse(row.observed_at))) throw new EconomicPeriodError("economic_invalid_stored_time", 500);
    const group = groups.get(key) ?? { platform: row.platform, account_id: row.account_id,
      time_zone: sourceZone, comparable, micros: 0n, rows: [], latest_observed_at: row.observed_at };
    group.micros += micros;
    group.latest_observed_at = group.latest_observed_at > row.observed_at ? group.latest_observed_at : row.observed_at;
    group.rows.push({ campaign_id: row.campaign_id, local_date: row.local_date,
      revision: row.revision, spend_micros: micros.toString(), observed_at: row.observed_at });
    groups.set(key, group);
    if (comparable) nativeSameZone += micros;
  }
  const mismatched = [...groups.values()].filter(g => !g.comparable);
  const hasMoneyOut = manual.length + selected.size > 0;
  const out = (manualSpend - credits) * factor + nativeSameZone;
  const difference = cash.length && hasMoneyOut && !mismatched.length ?
    ((receipts - refunds) * factor - out).toString() : null;
  return {
    product_id: period.product_id, currency: period.currency,
    period: { from: period.from, to: period.to, inclusive: true, time_zone: period.time_zone },
    evidence_boundary: "current_durable_read_snapshot", generated_at: new Date().toISOString(),
    money_in: { status: cash.length ? "observed_incomplete" : "no_observations",
      observed_receipts_minor: receipts.toString(), observed_refunds_minor: refunds.toString(),
      observed_net_receipts_minor: (receipts - refunds).toString(), observations: cash },
    money_out: { status: mismatched.length ? "incomparable_time_zones" : hasMoneyOut ? "observed_incomplete" : "no_observations",
      observed_spend_micros: hasMoneyOut && !mismatched.length ? out.toString() : null,
      comparable_observed_subtotal_micros: out.toString(),
      manual_spend_minor: manualSpend.toString(), manual_credits_minor: credits.toString(), manual_observations: manual,
      source_reports: [...groups.values()].map(g => ({ platform: g.platform, account_id: g.account_id,
        from: period.from, to: period.to, time_zone: g.time_zone, comparable: g.comparable,
        observed_spend_micros: g.micros.toString(), latest_observed_at: g.latest_observed_at,
        currency: period.currency, rows: g.rows })) },
    observed_difference_micros: difference,
    coverage: { complete: false, verified_zero: false,
      reasons: ["cash_source_completeness_not_verified", "advertising_source_completeness_not_verified",
        ...(!cash.length ? ["no_cash_observations_in_period"] : []),
        ...(!hasMoneyOut ? ["no_advertising_observations_in_period"] : []),
        ...(mismatched.length ? ["native_daily_buckets_have_different_time_zone"] : [])] },
    attribution: "none", launch_or_budget_increase_authorized: false,
  };
}
export function readEconomicPeriod(sql: SqlStorage, period: EconomicPeriod): object {
  // A UTC envelope contains all possible local-day instants; final selection uses IANA timezone rules.
  const low = new Date(Date.parse(period.from) - DAY).toISOString();
  const high = new Date(Date.parse(period.to) + 2 * DAY).toISOString();
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: period.time_zone,
    year: "numeric", month: "2-digit", day: "2-digit" });
  const observations: PeriodObservation[] = [];
  // Stream the envelope: adjacent local days do not consume the in-period row limit.
  for (const row of sql.exec<PeriodObservation>(
    "SELECT source,event_id,kind,amount_minor,channel,occurred_at FROM observations " +
    "WHERE product_id=? AND currency=? AND occurred_at>=? AND occurred_at<? " +
    "ORDER BY occurred_at,source,event_id", period.product_id, period.currency, low, high)) {
    if (between(localDate(row.occurred_at, formatter), period)) observations.push(row);
    if (observations.length > MAX_ROWS) throw new EconomicPeriodError("economic_period_row_limit", 413);
  }
  const google = sql.exec<PeriodCost>(
    "SELECT 'google' AS platform,r.customer_id AS account_id,r.campaign_id,r.local_date,r.revision," +
    "r.time_zone,r.cost_micros AS amount,r.observed_at FROM google_cost_revisions r " +
    "WHERE r.product_id=? AND r.currency=? AND r.local_date>=? AND r.local_date<=? AND " +
    "r.revision=(SELECT MAX(h.revision) FROM google_cost_revisions h WHERE " +
    "h.customer_id=r.customer_id AND h.campaign_id=r.campaign_id AND h.local_date=r.local_date) " +
    "ORDER BY r.customer_id,r.local_date,r.campaign_id LIMIT 10001",
    period.product_id, period.currency, period.from, period.to).toArray();
  const meta = sql.exec<PeriodCost>(
    "SELECT 'meta' AS platform,r.account_id,r.campaign_id,r.local_date,r.revision," +
    "r.timezone_name AS time_zone,r.spend_minor AS amount,r.observed_at FROM meta_cost_revisions r " +
    "WHERE r.product_id=? AND r.currency=? AND r.local_date>=? AND r.local_date<=? AND " +
    "r.revision=(SELECT MAX(h.revision) FROM meta_cost_revisions h WHERE " +
    "h.account_id=r.account_id AND h.campaign_id=r.campaign_id AND h.local_date=r.local_date) " +
    "ORDER BY r.account_id,r.local_date,r.campaign_id LIMIT 10001",
    period.product_id, period.currency, period.from, period.to).toArray();
  if ([observations, google, meta].some(rows => rows.length > MAX_ROWS)) {
    throw new EconomicPeriodError("economic_period_row_limit", 413);
  }
  return summarizeEconomicPeriod(period, { observations, costs: [...google, ...meta] });
}
