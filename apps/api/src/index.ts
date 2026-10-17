import { DurableObject } from "cloudflare:workers";
import { StripeError, StripeReader, STRIPE_VERSION, stripeConnection, verifyStripeWebhook,
  boundedBytes, productId, type StripeSettings, type StripeMode, type StripeConnection } from "./stripe";
import { StripeJournal, importStripeCash, type StripeImport } from "./stripe-ledger";
import { EconomicPeriodError, parseEconomicPeriod, readEconomicPeriod, type EconomicPeriod } from "./economics-period";
import { googleAdsRead, GoogleAdsError, GoogleAdsClient, type GoogleAdsConfig } from "./google";
import { GoogleCostJournal, GoogleJournalError } from "./google-ledger";
import { MetaCostJournal, MetaJournalError } from "./meta-ledger";
import { pausedSearchCampaigns } from "./google-campaigns";
import { handleMetaRequest, readMetaSpendReport, MetaReadError } from "./meta";
import { handleMetaCampaignRequest } from "./meta-campaigns";
import { handleMetaAdRequest } from "./meta-ads";
import {
  interpretBunnyLog, isBunnyPage, queryBunnyLogs,
  type BunnyEvidence, type BunnyConfig,
} from "./bunny";

type Kind = "subscription_receipt" | "subscription_refund" | "ad_spend" | "ad_credit";
type Channel = "google" | "meta" | null;

export interface Observation {
  product_id: string;
  source: string;
  event_id: string;
  kind: Kind;
  amount_minor: number;
  currency: string;
  channel: Channel;
  occurred_at: string;
}

export interface Env extends GoogleAdsConfig, StripeSettings {
  MONEY: DurableObjectNamespace<MoneyLedger>;
  API_TOKEN: string;
  BUNNY_ACCESS_KEY: string;
  BUNNY_PULL_ZONE_ID: string;
  BUNNY_COLLECT_HOST: string;
  BUNNY_SIGNING_KEY: string;
  META_ACCESS_TOKEN?: string;
}

const kinds: Kind[] = ["subscription_receipt", "subscription_refund", "ad_spend", "ad_credit"];
const fields = ["product_id", "source", "event_id", "kind", "amount_minor", "currency", "channel", "occurred_at"];

function validId(value: unknown): value is string {
  return typeof value === "string" && value !== "." && value !== ".." && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

function parseObservation(input: unknown): Observation {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_observation");
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.includes(key))) throw new Error("unknown_field");
  if (!validId(row.product_id) || !validId(row.source) || !validId(row.event_id)) {
    throw new Error("invalid_identity");
  }
  if (!kinds.includes(row.kind as Kind)) throw new Error("invalid_kind");
  if (!Number.isSafeInteger(row.amount_minor) || !(Number(row.amount_minor) > 0)) {
    throw new Error("invalid_amount_minor");
  }
  if (typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) {
    throw new Error("invalid_currency");
  }
  const isAd = row.kind === "ad_spend" || row.kind === "ad_credit";
  if (isAd ? row.channel !== "google" && row.channel !== "meta" : row.channel !== null) {
    throw new Error("invalid_channel");
  }
  if (typeof row.occurred_at !== "string" || !Number.isFinite(Date.parse(row.occurred_at))) {
    throw new Error("invalid_occurred_at");
  }
  return {
    product_id: row.product_id,
    source: row.source,
    event_id: row.event_id,
    kind: row.kind as Kind,
    amount_minor: row.amount_minor as number,
    currency: row.currency,
    channel: row.channel as Channel,
    occurred_at: new Date(row.occurred_at).toISOString(),
  };
}

type RecordResult = {
  status: "created" | "duplicate" | "conflict" |
    "google_ads_manual_spend_overlap" | "meta_manual_spend_overlap";
};

export class MoneyLedger extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    new StripeJournal(this.ctx.storage.sql).create();
    new GoogleCostJournal(this.ctx.storage.sql).create();
    new MetaCostJournal(this.ctx.storage.sql).create();
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta_ad_operations (
        request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
        state TEXT NOT NULL, result TEXT, http_status INTEGER
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        product_id TEXT NOT NULL,
        source TEXT NOT NULL,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        channel TEXT,
        occurred_at TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (product_id, source, event_id)
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS bunny_observations (
        zone_id INTEGER NOT NULL, request_id TEXT NOT NULL,
        logged_at TEXT NOT NULL, evidence_hash TEXT NOT NULL,
        raw_json TEXT, disposition TEXT NOT NULL, reason TEXT,
        product_id TEXT, source TEXT, event_id TEXT,
        PRIMARY KEY (zone_id, request_id)
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS bunny_poll_state (
        zone_id INTEGER PRIMARY KEY, through_ms INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS bunny_gaps (
        zone_id INTEGER NOT NULL, start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL, PRIMARY KEY (zone_id, start_ms, end_ms)
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS bunny_scan_cursor (
        zone_id INTEGER PRIMARY KEY, from_ms INTEGER NOT NULL,
        to_ms INTEGER NOT NULL, next_offset INTEGER NOT NULL
      )
    `);
  }

  private stripeImportRunning = false;
  async stripeImport(config: StripeConnection, input: StripeImport): Promise<{ status: number; body: string }> {
    if (this.stripeImportRunning) return { status: 503, body: JSON.stringify({ error: "stripe_import_busy" }) };
    this.stripeImportRunning = true;
    try {
      const result = await importStripeCash(config, input, this.ctx.storage.sql,
        operation => this.ctx.storage.transactionSync(operation));
      return { status: result.status, body: JSON.stringify(result.body) };
    } finally { this.stripeImportRunning = false; }
  }

  async stripeEvidence(mode: StripeMode, type: "events" | "effects", id: string, after = 0, limit = 100): Promise<{ status: number; body: string }> {
    try {
      const journal = new StripeJournal(this.ctx.storage.sql);
      return { status: 200, body: JSON.stringify(type === "events" ? journal.events(mode, id) : journal.effects(mode, id, after, limit)) };
    } catch (error) {
      if (error instanceof StripeError) return { status: error.status, body: JSON.stringify({ error: error.code }) };
      throw error;
    }
  }

  async metaAdWrite(path: string, key: string, body: string, token?: string): Promise<{ body: string; status: number }> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path + "\n" + body));
    const fingerprint = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
    const reserved = this.ctx.storage.transactionSync(() => {
      const old = this.ctx.storage.sql.exec<{
        fingerprint: string; state: string; result: string | null; http_status: number | null;
      }>("SELECT * FROM meta_ad_operations WHERE request_key=?", key).toArray()[0];
      if (old) return old;
      this.ctx.storage.sql.exec("INSERT INTO meta_ad_operations VALUES (?, ?, 'pending', NULL, NULL)", key, fingerprint);
      return null;
    });
    if (reserved) {
      if (reserved.fingerprint !== fingerprint) return {
        body: JSON.stringify({ error: "meta_idempotency_conflict" }), status: 409,
      };
      if (reserved.state === "complete" && reserved.result !== null && reserved.http_status !== null) {
        return { body: reserved.result, status: reserved.http_status };
      }
      return { body: reserved.result ?? JSON.stringify({ error: "meta_operation_incomplete", status: "write_unverified",
        operation_id: key, paid_delivery_authorized: false }), status: 409 };
    }
    let result: { body: string; status: number };
    try {
      const request = new Request("https://adslop.internal" + path, { method: "POST", body });
      const reply = await handleMetaAdRequest(request, new URL(request.url), token, known => {
        // Persist acknowledgments before the next external operation, not only at final success.
        const checkpoint = JSON.stringify({ error: "meta_operation_incomplete", status: "write_unverified",
          operation_id: key, ...known, paid_delivery_authorized: false });
        this.ctx.storage.sql.exec("UPDATE meta_ad_operations SET result=? WHERE request_key=?", checkpoint, key);
      });
      result = { body: await reply.text(), status: reply.status };
    } catch {
      // A lost response or runtime failure is not permission to resend an external write.
      const checkpoint = this.ctx.storage.sql.exec<{ result: string | null }>(
        "SELECT result FROM meta_ad_operations WHERE request_key=?", key
      ).toArray()[0];
      result = { body: checkpoint?.result ?? JSON.stringify({ error: "meta_operation_unverified", status: "write_unverified",
        operation_id: key, paid_delivery_authorized: false }), status: 502 };
    }
    this.ctx.storage.sql.exec(
      "UPDATE meta_ad_operations SET state='complete', result=?, http_status=? WHERE request_key=?",
      result.body, result.status, key
    );
    return result;
  }

  private recordInTransaction(value: Observation): RecordResult {
      if ((value.kind === "ad_spend" || value.kind === "ad_credit") && value.channel === "google" &&
          new GoogleCostJournal(this.ctx.storage.sql).hasImportedSpend(value.product_id, value.currency)) {
        throw new GoogleJournalError("google_ads_manual_spend_overlap", 409);
      }
      if ((value.kind === "ad_spend" || value.kind === "ad_credit") &&
          value.channel === "meta" &&
          new MetaCostJournal(this.ctx.storage.sql).hasImportedSpend(
            value.product_id, value.currency
          )) {
        throw new MetaJournalError("meta_manual_spend_overlap", 409);
      }
      const existing = this.ctx.storage.sql.exec<{ body: string }>(
        "SELECT body FROM observations WHERE product_id=? AND source=? AND event_id=?",
        value.product_id, value.source, value.event_id
      ).toArray()[0];
      const body = JSON.stringify(value);
      if (existing) return { status: existing.body === body ? "duplicate" : "conflict" };
      this.ctx.storage.sql.exec(
        "INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        value.product_id, value.source, value.event_id, value.kind,
        value.amount_minor, value.currency, value.channel, value.occurred_at, body
      );
      return { status: "created" };
  }

  async record(value: Observation): Promise<RecordResult> {
    try {
      return this.ctx.storage.transactionSync(() => this.recordInTransaction(value));
    } catch (error) {
      if (error instanceof GoogleJournalError) {
        return { status: "google_ads_manual_spend_overlap" };
      }
      if (error instanceof MetaJournalError) {
        return { status: "meta_manual_spend_overlap" };
      }
      throw error;
    }
  }

  async admitBunny(evidence: BunnyEvidence): Promise<string> {
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<{ evidence_hash: string; disposition: string }>(
        "SELECT evidence_hash, disposition FROM bunny_observations WHERE zone_id=? AND request_id=?",
        evidence.pull_zone_id, evidence.request_id
      ).toArray()[0];
      if (existing) {
        if (existing.evidence_hash !== evidence.evidence_hash) throw new Error("source_request_conflict");
        return "seen";
      }
      const result = evidence.event ? this.recordInTransaction(evidence.event) : null;
      const disposition = result
        ? (result.status === "created" ? "admitted" : result.status === "duplicate" ? "duplicate" : "rejected")
        : "rejected";
      const reason = result?.status === "conflict" ? "conflicting_event_id" : evidence.reason;
      this.ctx.storage.sql.exec(
        "INSERT INTO bunny_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        evidence.pull_zone_id, evidence.request_id, evidence.logged_at, evidence.evidence_hash,
        evidence.raw_json, disposition, reason,
        evidence.event?.product_id ?? null, evidence.event?.source ?? null,
        evidence.event?.event_id ?? null
      );
      return disposition;
    });
  }

  async bunnyRecord(zone: number, requestId: string) {
    const row = this.ctx.storage.sql.exec<{
      zone_id: number; request_id: string; logged_at: string; evidence_hash: string;
      raw_json: string | null; disposition: string; reason: string | null;
      product_id: string | null; source: string | null; event_id: string | null;
    }>("SELECT * FROM bunny_observations WHERE zone_id=? AND request_id=?",
      zone, requestId).toArray()[0];
    return row ? { ...row, raw_json: row.raw_json ? JSON.parse(row.raw_json) : null } : null;
  }

  async bunnyCoverage(zone: number) {
    const checkpoint = this.ctx.storage.sql.exec<{ through_ms: number }>(
      "SELECT through_ms FROM bunny_poll_state WHERE zone_id=?", zone
    ).toArray()[0];
    const gaps = this.ctx.storage.sql.exec<{ start_ms: number; end_ms: number }>(
      "SELECT start_ms, end_ms FROM bunny_gaps WHERE zone_id=? ORDER BY start_ms", zone
    ).toArray();
    return {
      pull_zone_id: zone,
      through: checkpoint ? new Date(checkpoint.through_ms).toISOString() : null,
      known_gaps: gaps.map((gap) => ({
        from: new Date(gap.start_ms).toISOString(),
        to: new Date(gap.end_ms).toISOString(),
      })),
      completeness: gaps.length ? "known_gap" : "not_verified",
    };
  }

  private recordBunnyGap(zoneId: number, from: number, to: number): void {
    if (from >= to) return;
    this.ctx.storage.transactionSync(() => {
      const overlaps = this.ctx.storage.sql.exec<{ start_ms: number; end_ms: number }>(
        "SELECT start_ms, end_ms FROM bunny_gaps WHERE zone_id=? " +
        "AND end_ms>=? AND start_ms<=?",
        zoneId, from, to
      ).toArray();
      const start = Math.min(from, ...overlaps.map((gap) => gap.start_ms));
      const end = Math.max(to, ...overlaps.map((gap) => gap.end_ms));
      this.ctx.storage.sql.exec(
        "DELETE FROM bunny_gaps WHERE zone_id=? AND end_ms>=? AND start_ms<=?",
        zoneId, start, end
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO bunny_gaps VALUES (?, ?, ?)", zoneId, start, end
      );
    });
  }

  // Do not share promises or I/O objects across Durable Object request
  // contexts. One poll owns the cursor; a concurrent poll reports busy.
  private bunnyPollRunning = false;

  async pollBunny(now: number) {
    if (this.bunnyPollRunning) return { status: "already_running", complete: false };
    this.bunnyPollRunning = true;
    try {
      return await this.pollBunnyOnce(now);
    } finally {
      this.bunnyPollRunning = false;
    }
  }

  private async pollBunnyOnce(now: number) {
    const zoneId = Number(this.env.BUNNY_PULL_ZONE_ID);
    if (!Number.isSafeInteger(zoneId) || zoneId <= 0 || !this.env.BUNNY_ACCESS_KEY ||
        !this.env.BUNNY_SIGNING_KEY || !this.env.BUNNY_COLLECT_HOST) {
      throw new Error("bunny_not_configured");
    }
    if (!Number.isFinite(now)) throw new Error("invalid_poll_time");
    const cfg: BunnyConfig = {
      zoneId, host: this.env.BUNNY_COLLECT_HOST, signingKey: this.env.BUNNY_SIGNING_KEY,
    };
    const latest = this.ctx.storage.sql.exec<{ through_ms: number }>(
      "SELECT through_ms FROM bunny_poll_state WHERE zone_id=?", zoneId
    ).toArray()[0];
    const cursor = this.ctx.storage.sql.exec<{
      from_ms: number; to_ms: number; next_offset: number;
    }>("SELECT from_ms, to_ms, next_offset FROM bunny_scan_cursor WHERE zone_id=?",
      zoneId).toArray()[0];
    const earliest = now - 3 * 86_400_000 + 5 * 60_000;
    const targetTo = now - 60_000;
    const desiredFrom = cursor?.from_ms ??
      (latest ? latest.through_ms - 15 * 60_000 : targetTo - 15 * 60_000);
    // An active cursor owns a fixed query window and offset. Advancing the
    // source-retention floor must not reset a partially processed backlog.
    // Record any expired interval as a coverage gap, not an implicit success.
    const from = cursor ? cursor.from_ms : Math.max(desiredFrom, earliest);
    const to = cursor ? cursor.to_ms : targetTo;
    const resumeOffset = cursor ? cursor.next_offset : 0;
    if (desiredFrom < earliest) {
      this.recordBunnyGap(zoneId, desiredFrom, earliest);
    }
    if (from >= to) {
      return { from, to, scanned: 0, admitted: 0, duplicate: 0,
        rejected: 0, seen: 0, complete: true };
    }
    // Persist the scan window before any network request. A failed first poll
    // must retry the same interval instead of silently skipping older receipts.
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO bunny_scan_cursor VALUES (?, ?, ?, ?) ON CONFLICT(zone_id) " +
        "DO UPDATE SET from_ms=excluded.from_ms, to_ms=excluded.to_ms, " +
        "next_offset=excluded.next_offset",
        zoneId, from, to, resumeOffset
      );
    });
    let scanned = 0, admitted = 0, duplicate = 0, rejected = 0, seen = 0;
    let offset = resumeOffset;
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const query = queryBunnyLogs(zoneId, from, to, offset);
      const reply = await fetch(query, { headers: { AccessKey: this.env.BUNNY_ACCESS_KEY } });
      if (!reply.ok) throw new Error(`bunny_fetch_failed_${reply.status}`);
      const payload: unknown = await reply.json();
      if (!isBunnyPage(payload, offset)) throw new Error("bunny_response_invalid");
      for (const log of payload.data) {
        const evidence = await interpretBunnyLog(log, cfg);
        if (!evidence) continue;
        scanned++;
        const state = await this.admitBunny(evidence);
        if (state === "admitted") admitted++;
        if (state === "duplicate") duplicate++;
        if (state === "rejected") rejected++;
        if (state === "seen") seen++;
      }
      if (!payload.pagination.hasMore) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "INSERT INTO bunny_poll_state VALUES (?, ?) ON CONFLICT(zone_id) " +
            "DO UPDATE SET through_ms=MAX(through_ms, excluded.through_ms)",
            zoneId, to
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM bunny_scan_cursor WHERE zone_id=?", zoneId
          );
        });
        return { from, to, scanned, admitted, duplicate, rejected, seen,
          complete: true };
      }
      if (!payload.data.length) throw new Error("bunny_empty_incomplete_page");
      offset += payload.pagination.limit;
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO bunny_scan_cursor VALUES (?, ?, ?, ?) ON CONFLICT(zone_id) " +
        "DO UPDATE SET from_ms=excluded.from_ms, to_ms=excluded.to_ms, " +
        "next_offset=excluded.next_offset",
        zoneId, from, to, offset
      );
    });
    return { from, to, scanned, admitted, duplicate, rejected, seen,
      complete: false, next_offset: offset };
  }

  private googleReconcileRunning = false;

  async reconcileGoogle(product: string, customer: string, sourceUrl: string,
    campaigns: string[], config: GoogleAdsConfig): Promise<object> {
    if (this.googleReconcileRunning) {
      return { error: "google_ads_reconcile_busy", error_status: 409, request_id: null };
    }
    this.googleReconcileRunning = true;
    try {
      const client = await GoogleAdsClient.connect(config);
      const report = await client.spend(customer, new URL(sourceUrl));
      return this.ctx.storage.transactionSync(() =>
        new GoogleCostJournal(this.ctx.storage.sql).apply(product, report, campaigns)
      );
    } catch (error) {
      // Durable Object RPC does not preserve Error subclasses across the stub.
      if (error instanceof GoogleJournalError || error instanceof GoogleAdsError) {
        return { error: error.code, error_status: error.status,
          request_id: error instanceof GoogleAdsError ? error.requestId : null };
      }
      throw error;
    } finally {
      this.googleReconcileRunning = false;
    }
  }

  async googleHistory(customer: string): Promise<object> {
    return { customer_id: customer, revisions: new GoogleCostJournal(this.ctx.storage.sql).history(customer) };
  }

  private metaReconcileRunning = false;

  async reconcileMeta(product: string, account: string, since: string,
    until: string, campaigns: string[], token?: string): Promise<object> {
    if (this.metaReconcileRunning) {
      return { error: "meta_reconcile_busy", error_status: 409 };
    }
    if (!token) return { error: "meta_not_configured", error_status: 503 };
    this.metaReconcileRunning = true;
    try {
      const snapshot = await readMetaSpendReport(account, since, until, "campaign", token);
      return this.ctx.storage.transactionSync(() =>
        new MetaCostJournal(this.ctx.storage.sql).apply(product, snapshot, campaigns)
      );
    } catch (error) {
      // Durable Object RPC does not preserve custom Error subclasses.
      if (error instanceof MetaJournalError || error instanceof MetaReadError) {
        return { error: error.code, error_status: error.status };
      }
      throw error;
    } finally {
      this.metaReconcileRunning = false;
    }
  }

  async metaHistory(account: string): Promise<object> {
    return {
      account_id: account,
      revisions: new MetaCostJournal(this.ctx.storage.sql).history(account),
    };
  }

  async find(product: string, source: string, id: string): Promise<Observation | null> {
    const row = this.ctx.storage.sql.exec<{ body: string }>(
      "SELECT body FROM observations WHERE product_id=? AND source=? AND event_id=?",
      product, source, id
    ).toArray()[0];
    return row ? JSON.parse(row.body) as Observation : null;
  }

  async economicPeriod(period: EconomicPeriod): Promise<{ status: number; body: string }> {
    try {
      const result = this.ctx.storage.transactionSync(() => readEconomicPeriod(this.ctx.storage.sql, period));
      return { status: 200, body: JSON.stringify(result) };
    } catch (error) {
      if (error instanceof EconomicPeriodError) return { status: error.status, body: JSON.stringify({ error: error.code }) };
      throw error;
    }
  }

  async economics(product: string, currency: string) {
    const rows = this.ctx.storage.sql.exec<{
      kind: Kind; channel: Channel; amount_minor: number;
    }>(
      "SELECT kind, channel, amount_minor FROM observations WHERE product_id=? AND currency=?",
      product, currency
    ).toArray();
    let receipts = 0n, refunds = 0n, spend = 0n, credits = 0n;
    const byChannel = { google: 0n, meta: 0n };
    for (const row of rows) {
      if (!Number.isSafeInteger(row.amount_minor)) throw new Error("monetary_total_overflow");
      const amount = BigInt(row.amount_minor);
      if (row.kind === "subscription_receipt") receipts += amount;
      if (row.kind === "subscription_refund") refunds += amount;
      if (row.kind === "ad_spend") {
        spend += amount;
        if (row.channel) byChannel[row.channel] += amount;
      }
      if (row.kind === "ad_credit") {
        credits += amount;
        if (row.channel) byChannel[row.channel] -= amount;
      }
    }
    const stripe = new StripeJournal(this.ctx.storage.sql).totals(product, currency);
    const stripeBreaks = new StripeJournal(this.ctx.storage.sql).reconciliationBreaks(product, currency);
    const subscriptionRevenue = receipts - refunds + stripe.receipts - stripe.refunds;
    const fractionDigits = new Intl.NumberFormat("en", {
      style: "currency", currency,
    }).resolvedOptions().maximumFractionDigits;
    if (fractionDigits === undefined || fractionDigits > 6) {
      throw new Error("unsupported_currency_fraction_digits");
    }
    const microsPerMinor = 10n ** BigInt(6 - fractionDigits);
    const googleRows = new GoogleCostJournal(this.ctx.storage.sql).latest(product, currency);
    const importedMicros = googleRows.reduce(
      (sum, row) => sum + BigInt(row.cost_micros), 0n
    );
    const metaRows = new MetaCostJournal(this.ctx.storage.sql).latest(product, currency);
    const importedMetaMinor = metaRows.reduce(
      (sum, row) => sum + BigInt(row.spend_minor), 0n
    );
    const advertisingMicros =
      (spend - credits + importedMetaMinor) * microsPerMinor + importedMicros;
    const differenceMicros = subscriptionRevenue * microsPerMinor - advertisingMicros;
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    const exact = (value: bigint): number => {
      if (value > limit || value < -limit) throw new Error("monetary_total_overflow");
      return Number(value);
    };
    const exactMinor = (value: bigint): number | null =>
      value % microsPerMinor === 0n ? exact(value / microsPerMinor) : null;
    return {
      product_id: product, currency,
      subscription_revenue_minor: stripeBreaks.length ? null : exact(subscriptionRevenue),
      advertising_spend_minor: exactMinor(advertisingMicros),
      difference_minor: stripeBreaks.length ? null : exactMinor(differenceMicros),
      advertising_spend_micros: advertisingMicros.toString(),
      difference_micros: stripeBreaks.length ? null : differenceMicros.toString(),
      advertising_spend_by_channel_minor: {
        google: exactMinor(byChannel.google * microsPerMinor + importedMicros),
        meta: exact(byChannel.meta + importedMetaMinor),
      },
      evidence: [
        "admitted_observations",
        ...(stripe.count ? ["stripe_verified_cash"] : []),
        ...(googleRows.length ? ["google_ads_daily_revisions"] : []),
        ...(metaRows.length ? ["meta_ads_daily_revisions"] : []),
      ].join("_and_") + (googleRows.length || metaRows.length || stripe.count ? "" : "_only"),
      ...(stripeBreaks.length ? { cash_status: "reconciliation_required", stripe_reconciliation_breaks: stripeBreaks,
        observed_subscription_subtotal_minor: subscriptionRevenue.toString() } : {}),
      ...(stripe.count ? { stripe_cash_basis: "customer_cash_including_tax_before_fees" } : {}),
      attribution: "none",
      coverage: "not_verified",
    };
  }
}

async function authorized(header: string | null, token: string): Promise<boolean> {
  const encode = new TextEncoder();
  const [given, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(header ?? "")),
    crypto.subtle.digest("SHA-256", encode.encode(`Bearer ${token}`)),
  ]);
  const left = new Uint8Array(given), right = new Uint8Array(expected);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function response(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stripeUrl = new URL(request.url);
    const stripeRoute = /^\/v1\/stripe\/(live|sandbox)\/(webhook|status|import|events|effects)(?:\/((?:evt|in)_[A-Za-z0-9]{1,96}))?$/.exec(stripeUrl.pathname);
    if (stripeRoute) {
      const mode = stripeRoute[1] as StripeMode;
      const operation = stripeRoute[2];
      const reply = (body: unknown, status = 200) => Response.json(body, { status,
        headers: { "Cache-Control": "no-store" } });
      if (operation !== "webhook") {
        if (!env.API_TOKEN) return reply({ error: "api_token_not_configured" }, 503);
        if (!await authorized(request.headers.get("Authorization"), env.API_TOKEN)) {
          return reply({ error: "unauthorized" }, 401);
        }
      }
      try {
        if (stripeUrl.search && operation !== "effects") throw new StripeError("stripe_invalid_query", 400);
        const validMethod = ["webhook", "import"].includes(operation) ? "POST" : "GET";
        if (request.method !== validMethod || (operation === "events") !== !!stripeRoute[3]) {
          return reply({ error: "stripe_invalid_route" }, 405);
        }
        const ledger = env.MONEY.get(env.MONEY.idFromName("private-operator"));
        if (operation === "effects" || operation === "events") {
          const id = operation === "events" ? stripeRoute[3] : stripeUrl.searchParams.get("product_id");
          const query = stripeUrl.searchParams;
          const after = query.get("after") ?? "0", limit = query.get("limit") ?? "100";
          if (!productId(id) || (operation === "effects" &&
              (!query.has("product_id") || [...query.keys()].some(k => !["product_id", "after", "limit"].includes(k)) ||
               new Set(query.keys()).size !== query.size || !/^(0|[1-9][0-9]{0,15})$/.test(after) ||
               !Number.isSafeInteger(Number(after)) || !/^[1-9][0-9]{0,3}$/.test(limit) || Number(limit) > 1000))) {
            throw new StripeError("stripe_invalid_query", 400);
          }
          const result = await ledger.stripeEvidence(mode, operation, id, Number(after), Number(limit));
          return reply(JSON.parse(result.body), result.status);
        }
        const config = stripeConnection(env, mode);
        if (operation === "status") {
          await new StripeReader(config).account();
          return reply({ mode, status: "connected", account_id: config.account_id, api_version: STRIPE_VERSION,
            prices: config.prices, coverage: "not_verified", cash_basis: "customer_cash_including_tax_before_fees" });
        }
        let input: StripeImport;
        if (operation === "webhook") {
          const verified = await verifyStripeWebhook(request, config);
          input = { event_id: verified.event.id, ...verified };
        } else {
          let parsed: unknown;
          try { parsed = JSON.parse(new TextDecoder().decode(await boundedBytes(request, 2048))); }
          catch (error) {
            if (error instanceof StripeError) throw error;
            throw new StripeError("stripe_invalid_json", 400);
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new StripeError("stripe_invalid_import", 400);
          }
          const values = Object.entries(parsed);
          if (values.length !== 1 || !["event_id", "invoice_id"].includes(values[0][0]) ||
              typeof values[0][1] !== "string" || !new RegExp("^" +
                (values[0][0] === "event_id" ? "evt" : "in") + "_[A-Za-z0-9]{1,96}$").test(values[0][1])) {
            throw new StripeError("stripe_invalid_import", 400);
          }
          input = Object.fromEntries(values);
        }
        const result = await ledger.stripeImport(config, input);
        return reply(JSON.parse(result.body), result.status);
      } catch (error) {
        if (error instanceof StripeError) return reply({ error: error.code, request_id: error.request_id,
          ...(error.configuration_issue ? { configuration_issue: error.configuration_issue } : {}) }, error.status);
        throw error;
      }
    }
    if (!env.API_TOKEN) return response("api_token_not_configured", 503);
    if (!await authorized(request.headers.get("Authorization"), env.API_TOKEN)) {
      return response("unauthorized", 401);
    }
    const url = new URL(request.url);
    const ledger = env.MONEY.get(env.MONEY.idFromName("private-operator"));
    if (/^\/v1\/google-ads\/accounts\/[0-9]{10}\/paused-search-campaigns(?:\/[1-9][0-9]*)?$/.test(url.pathname)) {
      return pausedSearchCampaigns(request, url, env);
    }
    const revisions = /^\/v1\/google-ads\/accounts\/([0-9]{10})\/revisions$/.exec(url.pathname);
    if (request.method === "GET" && revisions) {
      return Response.json(await ledger.googleHistory(revisions[1]));
    }
    const reconcile = /^\/v1\/google-ads\/accounts\/([0-9]{10})\/reconcile$/.exec(url.pathname);
    if (request.method === "POST" && reconcile) {
      let input: unknown;
      try { input = await request.json(); } catch { return response("invalid_json", 400); }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return response("google_ads_invalid_mapping", 400);
      }
      const form = input as Record<string, unknown>;
      if (!validId(form.product_id) || typeof form.from !== "string" ||
          typeof form.to !== "string" || !Array.isArray(form.campaign_ids) ||
          form.campaign_ids.length === 0 || form.campaign_ids.some((value: unknown) =>
            typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value)
          ) || new Set(form.campaign_ids).size !== form.campaign_ids.length) {
        return response("google_ads_invalid_mapping", 400);
      }
      const sourceUrl = new URL(request.url);
      sourceUrl.searchParams.set("from", form.from);
      sourceUrl.searchParams.set("to", form.to);
      sourceUrl.searchParams.set("view", "campaign");
      try {
        const result = await ledger.reconcileGoogle(
          form.product_id, reconcile[1], sourceUrl.toString(), form.campaign_ids as string[], {
            GOOGLE_ADS_CLIENT_ID: env.GOOGLE_ADS_CLIENT_ID,
            GOOGLE_ADS_CLIENT_SECRET: env.GOOGLE_ADS_CLIENT_SECRET,
            GOOGLE_ADS_REFRESH_TOKEN: env.GOOGLE_ADS_REFRESH_TOKEN,
            GOOGLE_ADS_LOGIN_CUSTOMER_ID: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
          }
        );
        if ("error" in result) {
          const failure = result as unknown as {
            error: string; error_status: number; request_id: string | null;
          };
          return Response.json({ error: failure.error, request_id: failure.request_id }, {
            status: failure.error_status,
          });
        }
        return Response.json(result, {
          status: (result as { status: string }).status === "created" ? 201 : 200,
        });
      } catch (error) {
        if (error instanceof GoogleJournalError || error instanceof GoogleAdsError) {
          return Response.json({
            error: error.code,
            request_id: error instanceof GoogleAdsError ? error.requestId : null,
          }, { status: error.status });
        }
        throw error;
      }
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/google-ads/")) {
      try {
        return await googleAdsRead(url, env);
      } catch (error) {
        if (error instanceof GoogleAdsError) {
          return Response.json({ error: error.code, request_id: error.requestId }, { status: error.status });
        }
        throw error;
      }
    }
    const metaHistory = /^\/v1\/meta\/accounts\/([0-9]{1,32})\/revisions$/.exec(url.pathname);
    if (request.method === "GET" && metaHistory) {
      if (url.search) return response("meta_invalid_query", 400);
      return Response.json(await ledger.metaHistory(metaHistory[1]));
    }
    const metaReconcile = /^\/v1\/meta\/accounts\/([0-9]{1,32})\/reconcile$/.exec(url.pathname);
    if (request.method === "POST" && metaReconcile) {
      if (url.search) return response("meta_invalid_query", 400);
      let input: unknown;
      try { input = await request.json(); } catch { return response("invalid_json", 400); }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return response("meta_invalid_mapping", 400);
      }
      const form = input as Record<string, unknown>;
      if (Object.keys(form).some((key) =>
          !["product_id", "since", "until", "campaign_ids"].includes(key)) ||
          !validId(form.product_id) || typeof form.since !== "string" ||
          typeof form.until !== "string" || !Array.isArray(form.campaign_ids) ||
          !form.campaign_ids.length || form.campaign_ids.some((value: unknown) =>
            typeof value !== "string" || !/^[0-9]{1,32}$/.test(value)
          ) || new Set(form.campaign_ids).size !== form.campaign_ids.length) {
        return response("meta_invalid_mapping", 400);
      }
      const result = await ledger.reconcileMeta(
        form.product_id, metaReconcile[1], form.since, form.until,
        form.campaign_ids as string[], env.META_ACCESS_TOKEN
      );
      if ("error" in result) {
        const failure = result as { error: string; error_status: number };
        return response(failure.error, failure.error_status);
      }
      return Response.json(result, {
        status: (result as { status: string }).status === "created" ? 201 : 200,
      });
    }
    const metaAd = /^\/v1\/meta\/accounts\/([1-9][0-9]{0,31})\/(creative-assets|images|paused-ads)(?:\/([1-9][0-9]{0,31}))?$/.exec(url.pathname);
    if (metaAd) {
      if (request.method === "POST" && !metaAd[3] && ["images", "paused-ads"].includes(metaAd[2])) {
        if (url.search) return response("meta_invalid_query", 400);
        const key = request.headers.get("Idempotency-Key");
        if (!key || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) return response("meta_idempotency_key_required", 400);
        const body = await request.text();
        if (body.length > 6_000_000) return response("meta_request_too_large", 413);
        const result = await ledger.metaAdWrite(url.pathname, metaAd[1] + ":" + key, body, env.META_ACCESS_TOKEN);
        return new Response(result.body, { status: result.status, headers: {
          "Content-Type": "application/json", "Cache-Control": "no-store", "Idempotency-Key": key,
        } });
      }
      return handleMetaAdRequest(request, url, env.META_ACCESS_TOKEN);
    }
    if (url.pathname === "/v1/meta/targeting-interests" ||
        (url.pathname.startsWith("/v1/meta/accounts/") &&
         url.pathname.includes("/paused-audience-campaigns"))) {
      return handleMetaCampaignRequest(request, url, env.META_ACCESS_TOKEN);
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/meta/")) {
      return handleMetaRequest(url, env.META_ACCESS_TOKEN);
    }
    if (request.method === "POST" && url.pathname === "/v1/bunny/poll") {
      try {
        return Response.json(await ledger.pollBunny(Date.now()));
      } catch (error) {
        if (error instanceof Error) return response(error.message, 502);
        throw error;
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/bunny/coverage") {
      const zone = url.searchParams.get("pull_zone_id");
      if (!zone || !/^[1-9][0-9]*$/.test(zone) ||
          !Number.isSafeInteger(Number(zone))) return response("invalid_query", 400);
      return Response.json(await ledger.bunnyCoverage(Number(zone)));
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/bunny/records/")) {
      const id = url.pathname.slice("/v1/bunny/records/".length);
      const zone = url.searchParams.get("pull_zone_id");
      if (!/^[0-9a-f]{32}$/i.test(id) || !zone || !/^[1-9][0-9]*$/.test(zone) ||
          !Number.isSafeInteger(Number(zone))) return response("invalid_query", 400);
      const value = await ledger.bunnyRecord(Number(zone), id);
      return value ? Response.json(value) : response("not_found", 404);
    }
    if (request.method === "POST" && url.pathname === "/v1/observations") {
      let input: unknown;
      try { input = await request.json(); } catch { return response("invalid_json", 400); }
      let value: Observation;
      try { value = parseObservation(input); }
      catch (error) {
        if (error instanceof Error) return response(error.message, 400);
        throw error;
      }
      let result: RecordResult;
      try {
        result = await ledger.record(value);
      } catch (error) {
        if (error instanceof GoogleJournalError) return response(error.code, error.status);
        throw error;
      }
      if (result.status === "google_ads_manual_spend_overlap" ||
          result.status === "meta_manual_spend_overlap") {
        return response(result.status, 409);
      }
      if (result.status === "conflict") return response("conflicting_event_id", 409);
      return Response.json({ ...result, event_id: value.event_id }, {
        status: result.status === "created" ? 201 : 200,
      });
    }
    if (url.pathname === "/v1/economics/period") {
      if (request.method !== "GET") return response("method_not_allowed", 405);
      try {
        const result = await ledger.economicPeriod(parseEconomicPeriod(url));
        return new Response(result.body, { status: result.status, headers: {
          "Content-Type": "application/json", "Cache-Control": "no-store",
        } });
      } catch (error) {
        if (error instanceof EconomicPeriodError) return response(error.code, error.status);
        throw error;
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/economics") {
      const product = url.searchParams.get("product_id");
      const currency = url.searchParams.get("currency");
      if (!validId(product) || !currency || !/^[A-Z]{3}$/.test(currency)) {
        return response("invalid_query", 400);
      }
      return Response.json(await ledger.economics(product, currency));
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/observations/")) {
      const product = url.searchParams.get("product_id");
      const source = url.searchParams.get("source");
      let eventId: string;
      try {
        eventId = decodeURIComponent(url.pathname.slice("/v1/observations/".length));
      } catch {
        return response("invalid_query", 400);
      }
      if (!validId(product) || !validId(source) || !validId(eventId)) {
        return response("invalid_query", 400);
      }
      const value = await ledger.find(product, source, eventId);
      return value ? Response.json(value) : response("not_found", 404);
    }
    return response("not_found", 404);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const ledger = env.MONEY.get(env.MONEY.idFromName("private-operator"));
    await ledger.pollBunny(controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
