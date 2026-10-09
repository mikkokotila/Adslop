import { DurableObject } from "cloudflare:workers";
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

export interface Env {
  MONEY: DurableObjectNamespace<MoneyLedger>;
  API_TOKEN: string;
  BUNNY_ACCESS_KEY: string;
  BUNNY_PULL_ZONE_ID: string;
  BUNNY_COLLECT_HOST: string;
  BUNNY_SIGNING_KEY: string;
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

  private recordInTransaction(value: Observation): RecordResult {
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
    return this.ctx.storage.transactionSync(() => this.recordInTransaction(value));
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

  async pollBunny(now: number) {
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
    const from = Math.max(desiredFrom, earliest);
    const to = cursor && cursor.from_ms >= earliest ? cursor.to_ms : targetTo;
    const resumeOffset = cursor && cursor.from_ms >= earliest ? cursor.next_offset : 0;
    if (desiredFrom < earliest) {
      this.recordBunnyGap(zoneId, desiredFrom, earliest);
      if (cursor) this.ctx.storage.sql.exec(
        "DELETE FROM bunny_scan_cursor WHERE zone_id=?", zoneId
      );
    }
    if (from >= to) {
      return { from, to, scanned: 0, admitted: 0, duplicate: 0,
        rejected: 0, seen: 0, complete: true };
    }
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

  async find(product: string, source: string, id: string): Promise<Observation | null> {
    const row = this.ctx.storage.sql.exec<{ body: string }>(
      "SELECT body FROM observations WHERE product_id=? AND source=? AND event_id=?",
      product, source, id
    ).toArray()[0];
    return row ? JSON.parse(row.body) as Observation : null;
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
    const subscriptionRevenue = receipts - refunds;
    const advertisingSpend = spend - credits;
    const difference = subscriptionRevenue - advertisingSpend;
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    const exact = (value: bigint): number => {
      if (value > limit || value < -limit) throw new Error("monetary_total_overflow");
      return Number(value);
    };
    return {
      product_id: product, currency,
      subscription_revenue_minor: exact(subscriptionRevenue),
      advertising_spend_minor: exact(advertisingSpend),
      difference_minor: exact(difference),
      advertising_spend_by_channel_minor: {
        google: exact(byChannel.google), meta: exact(byChannel.meta),
      },
      evidence: "admitted_observations_only",
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
    if (!env.API_TOKEN) return response("api_token_not_configured", 503);
    if (!await authorized(request.headers.get("Authorization"), env.API_TOKEN)) {
      return response("unauthorized", 401);
    }
    const url = new URL(request.url);
    const ledger = env.MONEY.get(env.MONEY.idFromName("private-operator"));
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
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const ledger = env.MONEY.get(env.MONEY.idFromName("private-operator"));
    await ledger.pollBunny(controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
