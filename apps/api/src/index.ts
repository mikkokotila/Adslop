import { DurableObject } from "cloudflare:workers";

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

export interface Env {
  MONEY: DurableObjectNamespace<MoneyLedger>;
  API_TOKEN: string;
}

const kinds: Kind[] = ["subscription_receipt", "subscription_refund", "ad_spend", "ad_credit"];
const fields = ["product_id", "source", "event_id", "kind", "amount_minor", "currency", "channel", "occurred_at"];

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
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
  if (isAd ? !["google", "meta"].includes(String(row.channel)) : row.channel !== null) {
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

type RecordResult = { status: "created" | "duplicate" | "conflict" };

export class MoneyLedger extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
  }

  async record(value: Observation): Promise<RecordResult> {
    return this.ctx.storage.transactionSync(() => {
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
    });
  }

  async find(product: string, source: string, id: string): Promise<Observation | null> {
    const row = this.ctx.storage.sql.exec<{ body: string }>(
      "SELECT body FROM observations WHERE product_id=? AND source=? AND event_id=?",
      product, source, id
    ).toArray()[0];
    return row ? JSON.parse(row.body) as Observation : null;
  }

  async economics(product: string, currency: string) {
    const rows = this.ctx.storage.sql.exec<{
      kind: Kind; channel: Channel; total: number;
    }>(
      "SELECT kind, channel, SUM(amount_minor) AS total FROM observations " +
      "WHERE product_id=? AND currency=? GROUP BY kind, channel",
      product, currency
    ).toArray();
    let receipts = 0, refunds = 0, spend = 0, credits = 0;
    const byChannel = { google: 0, meta: 0 };
    for (const row of rows) {
      if (!Number.isSafeInteger(row.total)) throw new Error("monetary_total_overflow");
      if (row.kind === "subscription_receipt") receipts += row.total;
      if (row.kind === "subscription_refund") refunds += row.total;
      if (row.kind === "ad_spend") {
        spend += row.total;
        if (row.channel) byChannel[row.channel] += row.total;
      }
      if (row.kind === "ad_credit") {
        credits += row.total;
        if (row.channel) byChannel[row.channel] -= row.total;
      }
    }
    const subscription_revenue_minor = receipts - refunds;
    const advertising_spend_minor = spend - credits;
    const difference_minor = subscription_revenue_minor - advertising_spend_minor;
    if (![subscription_revenue_minor, advertising_spend_minor, difference_minor,
      byChannel.google, byChannel.meta].every(Number.isSafeInteger)) {
      throw new Error("monetary_total_overflow");
    }
    return {
      product_id: product, currency, subscription_revenue_minor,
      advertising_spend_minor, difference_minor,
      advertising_spend_by_channel_minor: byChannel,
      evidence: "admitted_observations_only",
      attribution: "none",
      coverage: "not_verified",
    };
  }
}

function response(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.API_TOKEN) return response("api_token_not_configured", 503);
    if (request.headers.get("Authorization") !== `Bearer ${env.API_TOKEN}`) {
      return response("unauthorized", 401);
    }
    const url = new URL(request.url);
    const ledger = env.MONEY.get(env.MONEY.idFromName("private-operator"));
    if (request.method === "POST" && url.pathname === "/v1/observations") {
      let input: unknown;
      try { input = await request.json(); } catch { return response("invalid_json", 400); }
      let value: Observation;
      try { value = parseObservation(input); }
      catch (error) {
        if (error instanceof Error) return response(error.message, 400);
        throw error;
      }
      const result = await ledger.record(value);
      if (result.status === "conflict") return response("conflicting_event_id", 409);
      return Response.json({ ...result, event_id: value.event_id }, {
        status: result.status === "created" ? 201 : 200,
      });
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
      const eventId = url.pathname.slice("/v1/observations/".length);
      if (!validId(product) || !validId(source) || !validId(eventId)) {
        return response("invalid_query", 400);
      }
      const value = await ledger.find(product, source, eventId);
      return value ? Response.json(value) : response("not_found", 404);
    }
    return response("not_found", 404);
  },
} satisfies ExportedHandler<Env>;
