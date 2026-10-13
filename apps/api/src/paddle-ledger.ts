/** Immutable Paddle source effects and delivery evidence inside the existing cash ledger. */
import { PaddleError, paddleAmountBasis, type PaddleConnection, type PaddleEffect, type PaddleEvent } from "./paddle";
import type { Observation } from "./index";

export class PaddleJournal {
  constructor(private readonly sql: SqlStorage) {}
  create(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS paddle_deliveries (
      id INTEGER PRIMARY KEY, source TEXT NOT NULL, event_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, observed_at TEXT NOT NULL, result TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS paddle_delivery_events ON paddle_deliveries(source, event_id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS paddle_effects (
      source TEXT NOT NULL, resource_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
      kind TEXT NOT NULL, amount_minor TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(source, resource_id)
    )`);
  }
  assertEvent(source: string, event: PaddleEvent): void {
    const first = this.sql.exec<{ fingerprint: string }>(
      "SELECT fingerprint FROM paddle_deliveries WHERE source=? AND event_id=? ORDER BY id LIMIT 1",
      source, event.event_id,
    ).toArray()[0];
    if (first && first.fingerprint !== event.fingerprint) throw new PaddleError("paddle_event_identity_conflict", 409);
  }
  private delivery(source: string, event: PaddleEvent, result: object): void {
    this.sql.exec("INSERT INTO paddle_deliveries(source,event_id,fingerprint,observed_at,result) VALUES (?,?,?,?,?)",
      source, event.event_id, event.fingerprint, new Date().toISOString(), JSON.stringify(result));
  }
  failure(source: string, event: PaddleEvent, error: PaddleError): void {
    this.delivery(source, event, { status: "rejected", error: error.code, request_id: error.requestId,
      event_type: event.event_type, occurred_at: event.occurred_at, entity_id: event.entity_id });
  }
  /** Caller owns one SQLite transaction covering evidence and ordinary observation admission. */
  apply(config: PaddleConnection, event: PaddleEvent, effects: PaddleEffect[]): object {
    this.assertEvent(config.source, event);
    let created = 0;
    for (const effect of effects) {
      const encoded = JSON.stringify(effect);
      const old = this.sql.exec<{ body: string }>(
        "SELECT body FROM paddle_effects WHERE source=? AND resource_id=?", config.source, effect.resource_id,
      ).toArray()[0];
      if (old) {
        if (old.body !== encoded) throw new PaddleError("paddle_resource_identity_conflict", 409);
        continue;
      }
      if (effect.kind === "subscription_refund") {
        const original = this.sql.exec<{ body: string }>(
          "SELECT body FROM paddle_effects WHERE source=? AND resource_id=?", config.source, effect.transaction_id,
        ).toArray()[0];
        if (!original) throw new PaddleError("paddle_original_receipt_missing", 409);
        const receipt = JSON.parse(original.body) as PaddleEffect;
        if (effect.currency !== receipt.currency || effect.product_id !== receipt.product_id) {
          throw new PaddleError("paddle_refund_identity_conflict", 409);
        }
        const refunds = this.sql.exec<{ body: string }>(
          "SELECT body FROM paddle_effects WHERE source=? AND transaction_id=? AND kind='subscription_refund'",
          config.source, effect.transaction_id,
        ).toArray().map(r => JSON.parse(r.body) as PaddleEffect);
        for (const field of ["amount_minor", "gross_minor", "tax_minor"] as const) {
          const total = refunds.reduce((sum, r) => sum + BigInt(r[field]), BigInt(effect[field]));
          if (total > BigInt(receipt[field])) throw new PaddleError("paddle_refunds_exceed_receipt", 409);
        }
      }
      // A sandbox transaction is evidence for testing, never money in the live ledger.
      if (config.environment === "live") {
        const existing = this.sql.exec<{ body: string }>(
          "SELECT body FROM observations WHERE product_id=? AND source=? AND event_id=?",
          effect.product_id, config.source, effect.resource_id,
        ).toArray()[0];
        if (existing) throw new PaddleError("paddle_observation_overlap", 409);
        const observation: Observation = { product_id: effect.product_id, source: config.source,
          event_id: effect.resource_id, kind: effect.kind, amount_minor: Number(effect.amount_minor),
          currency: effect.currency, channel: null, occurred_at: effect.occurred_at };
        this.sql.exec("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)", observation.product_id,
          observation.source, observation.event_id, observation.kind, observation.amount_minor,
          observation.currency, null, observation.occurred_at, JSON.stringify(observation));
      }
      this.sql.exec("INSERT INTO paddle_effects VALUES (?,?,?,?,?,?)", config.source, effect.resource_id,
        effect.transaction_id, effect.kind, effect.amount_minor, encoded);
      created++;
    }
    const result = { status: !effects.length ? "ignored_non_cash_event" : !created ? "duplicate" :
      config.environment === "sandbox" ? "sandbox_recorded" : "admitted", created,
      event_id: event.event_id, event_type: event.event_type, occurred_at: event.occurred_at,
      source: config.source, environment: config.environment,
      amount_basis: paddleAmountBasis, effects };
    this.delivery(config.source, event, result);
    return result;
  }
  history(source: string, eventId: string): object {
    const all = this.sql.exec<{ id: number; fingerprint: string; observed_at: string; result: string }>(
      "SELECT id,fingerprint,observed_at,result FROM paddle_deliveries WHERE source=? AND event_id=? ORDER BY id DESC LIMIT 101",
      source, eventId,
    ).toArray();
    return { source, event_id: eventId, amount_basis: paddleAmountBasis, truncated: all.length > 100,
      deliveries: all.slice(0, 100).map(row => ({ ...row, result: JSON.parse(row.result) })) };
  }
}
