/** Immutable Stripe cash effects and append-only delivery dispositions. No customer records. */
import { StripeError, StripeReader, STRIPE_VERSION, type StripeConnection, type StripeEvent,
  type StripeMode } from "./stripe";
import { collectStripeEvent, collectStripeInvoice, type StripeCashBatch, type StripeCashEffect } from "./stripe-cash";

export interface StripeImport {
  event_id?: string;
  invoice_id?: string;
  event?: StripeEvent;
  payload_hash?: string;
}
export interface StripeReply { status: number; body: Record<string, unknown> }
export class StripeJournal {
  constructor(private readonly sql: SqlStorage) {}
  create(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS stripe_effects (
      mode TEXT NOT NULL, account_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      product_id TEXT NOT NULL, invoice_id TEXT NOT NULL, kind TEXT NOT NULL,
      amount_minor TEXT NOT NULL, currency TEXT NOT NULL, occurred_at TEXT NOT NULL,
      body TEXT NOT NULL, observed_at TEXT NOT NULL,
      PRIMARY KEY(mode, account_id, resource_id))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS stripe_effect_product ON stripe_effects(mode, product_id, currency)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS stripe_deliveries (
      id INTEGER PRIMARY KEY, mode TEXT NOT NULL, account_id TEXT NOT NULL,
      event_id TEXT NOT NULL, observed_at TEXT NOT NULL, body TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS stripe_delivery_event ON stripe_deliveries(mode, account_id, event_id)`);
  }
  /** Caller owns a transaction covering all effects and the success disposition. */
  apply(config: StripeConnection, batch: StripeCashBatch): { created: number; duplicate: number } {
    let created = 0, duplicate = 0;
    const ids = new Set<string>();
    for (const effect of batch.effects) {
      if (ids.has(effect.resource_id)) throw new StripeError("stripe_duplicate_source_effect");
      ids.add(effect.resource_id);
      const old = this.sql.exec<{ body: string }>(
        "SELECT body FROM stripe_effects WHERE mode=? AND account_id=? AND resource_id=?",
        config.mode, config.account_id, effect.resource_id
      ).toArray()[0];
      const body = JSON.stringify(effect);
      if (old) {
        if (old.body !== body) throw new StripeError("stripe_conflicting_source_effect");
        duplicate++;
      } else {
        this.sql.exec("INSERT INTO stripe_effects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          config.mode, config.account_id, effect.resource_id, effect.product_id, effect.invoice_id,
          effect.kind, effect.amount_minor, effect.currency, effect.occurred_at, body, new Date().toISOString());
        created++;
      }
    }
    if (batch.invoice_id) {
      const previous = this.sql.exec<{ resource_id: string }>(
        "SELECT resource_id FROM stripe_effects WHERE mode=? AND account_id=? AND invoice_id=?",
        config.mode, config.account_id, batch.invoice_id).toArray();
      if (previous.some(row => !ids.has(row.resource_id))) {
        throw new StripeError("stripe_previously_admitted_effect_missing");
      }
    }
    return { created, duplicate };
  }
  delivery(config: StripeConnection, eventId: string, body: Record<string, unknown>): void {
    this.sql.exec("INSERT INTO stripe_deliveries (mode, account_id, event_id, observed_at, body) VALUES (?, ?, ?, ?, ?)",
      config.mode, config.account_id, eventId, new Date().toISOString(), JSON.stringify(body));
  }
  events(mode: StripeMode, eventId: string): Record<string, unknown> {
    const rows = this.sql.exec<{ body: string; observed_at: string; account_id: string }>(
      "SELECT body, observed_at, account_id FROM stripe_deliveries WHERE mode=? AND event_id=? ORDER BY id DESC LIMIT 100",
      mode, eventId).toArray();
    return { mode, event_id: eventId, latest: rows.length ? JSON.parse(rows[0].body) : null,
      attempts: rows.map(row => ({ ...JSON.parse(row.body), observed_at: row.observed_at, account_id: row.account_id })),
      returned_limit: 100 };
  }
  effects(mode: StripeMode, product: string): Record<string, unknown> {
    const rows = this.sql.exec<{ body: string; account_id: string; observed_at: string }>(
      "SELECT body, account_id, observed_at FROM stripe_effects WHERE mode=? AND product_id=? ORDER BY occurred_at, resource_id LIMIT 1001",
      mode, product).toArray();
    if (rows.length > 1000) throw new StripeError("stripe_effect_query_limit", 413);
    return { mode, product_id: product, coverage: "not_verified", cash_basis: "customer_cash_including_tax_before_fees",
      effects: rows.map(row => ({ ...JSON.parse(row.body), account_id: row.account_id, observed_at: row.observed_at })) };
  }
  totals(product: string, currency: string): { receipts: bigint; refunds: bigint; count: number } {
    const rows = this.sql.exec<{ kind: string; amount_minor: string }>(
      "SELECT kind, amount_minor FROM stripe_effects WHERE mode='live' AND product_id=? AND currency=?",
      product, currency).toArray();
    let receipts = 0n, refunds = 0n;
    for (const row of rows) {
      if (row.kind === "subscription_receipt") receipts += BigInt(row.amount_minor);
      else if (row.kind === "subscription_refund") refunds += BigInt(row.amount_minor);
      else throw new Error("stripe_invalid_stored_effect");
    }
    return { receipts, refunds, count: rows.length };
  }
}
/** No 2xx acknowledgment until effects or an explicit terminal disposition are durable. */
export async function importStripeCash(config: StripeConnection, input: StripeImport,
  sql: SqlStorage, transaction: <T>(operation: () => T) => T): Promise<StripeReply> {
  const journal = new StripeJournal(sql);
  const client = new StripeReader(config);
  const identity = input.event_id ?? input.invoice_id ?? "";
  const common = { mode: config.mode, account_id: config.account_id, event_id: input.event_id ?? null,
    source: input.event ? "stripe_signed_webhook" : "stripe_operator_reconciliation",
    payload_hash: input.payload_hash ?? null, api_version: STRIPE_VERSION, coverage: "not_verified" };
  try {
    await client.account();
    const batch = input.event_id
      ? (await collectStripeEvent(client, input.event_id, input.event)).batch
      : await collectStripeInvoice(client, input.invoice_id!);
    return transaction(() => {
      const counts = journal.apply(config, batch);
      const result = { ...common, ...counts, invoice_id: batch.invoice_id,
        status: batch.reason ? "no_cash" : counts.created ? "admitted" : "duplicate",
        reason: batch.reason, pending_refunds: batch.pending_refunds,
        effect_ids: batch.effects.map((effect: StripeCashEffect) => effect.resource_id),
        request_ids: client.request_ids };
      journal.delivery(config, identity, result);
      return { status: 200, body: result };
    });
  } catch (error) {
    if (!(error instanceof StripeError)) throw error;
    const result = { ...common, status: error.retryable ? "retryable" : "quarantined",
      error: error.code, request_ids: client.request_ids,
      invoice_id: input.invoice_id ?? null };
    transaction(() => journal.delivery(config, identity, result));
    return { status: error.retryable ? 503 : input.event ? 200 : 422, body: result };
  }
}
