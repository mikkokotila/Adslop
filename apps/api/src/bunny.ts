import type { Observation } from "./index";

const signedFields = [
  "schema", "product_id", "source", "event_id", "kind", "amount_minor", "currency", "occurred_at",
] as const;
const queryFields = new Set<string>([...signedFields, "sig"]);

export interface BunnyLog {
  pullZoneId: number;
  requestId: string;
  timestamp: string;
  statusCode: number;
  path: string;
  url: string;
}

export interface BunnyPage {
  data: BunnyLog[];
  pagination: { offset: number; limit: number; returned: number; hasMore: boolean };
}

export interface BunnyEvidence {
  pull_zone_id: number;
  request_id: string;
  logged_at: string;
  evidence_hash: string;
  raw_json: string | null;
  event: Observation | null;
  reason: string | null;
}

export interface BunnyConfig {
  zoneId: number;
  host: string;
  signingKey: string;
}

const text = new TextEncoder();

function hex(data: ArrayBuffer): string {
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isBunnyLog(value: unknown): value is BunnyLog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Number.isSafeInteger(row.pullZoneId) &&
    typeof row.requestId === "string" && /^[0-9a-f]{32}$/i.test(row.requestId) &&
    typeof row.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp)) &&
    Number.isInteger(row.statusCode) &&
    typeof row.path === "string" && typeof row.url === "string";
}

export function isBunnyPage(value: unknown, offset: number): value is BunnyPage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.data) || !obj.data.every(isBunnyLog)) return false;
  const page = obj.pagination;
  if (typeof page !== "object" || page === null || Array.isArray(page)) return false;
  const state = page as Record<string, unknown>;
  return state.offset === offset && Number.isSafeInteger(state.limit) &&
    Number(state.limit) > 0 && state.returned === obj.data.length &&
    typeof state.hasMore === "boolean";
}

function canonical(params: URLSearchParams): string {
  const normalized = new URLSearchParams();
  for (const field of signedFields) normalized.set(field, params.get(field) ?? "");
  return normalized.toString();
}

async function verifySignature(params: URLSearchParams, secret: string): Promise<boolean> {
  const signature = params.get("sig");
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw", text.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const bytes = new Uint8Array(signature.match(/../g)!.map((part) => Number.parseInt(part, 16)));
  return crypto.subtle.verify("HMAC", key, bytes, text.encode(canonical(params)));
}

export async function interpretBunnyLog(
  log: BunnyLog, cfg: BunnyConfig
): Promise<BunnyEvidence | null> {
  if (log.pullZoneId !== cfg.zoneId) throw new Error("bunny_pull_zone_mismatch");
  const sourceFields = {
    pullZoneId: log.pullZoneId, requestId: log.requestId,
    timestamp: log.timestamp, statusCode: log.statusCode,
    path: log.path, url: log.url,
  };
  const sourceJson = JSON.stringify(sourceFields);
  const evidence_hash = hex(await crypto.subtle.digest("SHA-256", text.encode(sourceJson)));
  const base = {
    pull_zone_id: cfg.zoneId,
    request_id: log.requestId,
    logged_at: new Date(log.timestamp).toISOString(),
    evidence_hash, raw_json: null,
  };
  let url: URL;
  try { url = new URL(log.url); }
  catch { return { ...base, event: null, reason: "invalid_log_url" }; }
  if (url.pathname !== "/collect") return null;
  const reject = (reason: string, raw_json: string | null = null): BunnyEvidence => ({
    ...base, raw_json, event: null, reason,
  });
  if (url.protocol !== "https:" || url.host !== cfg.host ||
      log.path !== url.pathname + url.search) return reject("source_url_mismatch");
  if (log.statusCode < 200 || log.statusCode >= 300) return reject("edge_request_failed");
  const params = url.searchParams;
  if ([...params.keys()].some((key) => !queryFields.has(key))) return reject("unknown_query_field");
  if ([...queryFields].some((field) => params.getAll(field).length !== 1)) {
    return reject("missing_or_repeated_query_field");
  }
  if (!await verifySignature(params, cfg.signingKey)) return reject("invalid_signature");
  // Signed records can safely retain their original allowed URL fields for
  // diagnosis even when a later semantic check rejects the event.
  const signedEvidence = sourceJson;
  if (params.get("schema") !== "1") return reject("unsupported_event_schema", signedEvidence);
  const kind = params.get("kind");
  const amount = params.get("amount_minor") ?? "";
  if ((kind !== "subscription_receipt" && kind !== "subscription_refund") ||
      !/^[1-9][0-9]*$/.test(amount)) return reject("invalid_commercial_event", signedEvidence);
  const amount_minor = Number(amount);
  const product_id = params.get("product_id") ?? "";
  const sourceName = params.get("source") ?? "";
  const event_id = params.get("event_id") ?? "";
  const currency = params.get("currency") ?? "";
  const occurred_at = params.get("occurred_at") ?? "";
  const prefixedSource = `bunny:${cfg.zoneId}:${sourceName}`;
  if (![product_id, sourceName, event_id, prefixedSource].every(
    (id) => id !== "." && id !== ".." && /^[A-Za-z0-9_.:-]{1,128}$/.test(id)
  ) || !Number.isSafeInteger(amount_minor) || !/^[A-Z]{3}$/.test(currency) ||
      !Number.isFinite(Date.parse(occurred_at))) {
    return reject("invalid_commercial_event", signedEvidence);
  }
  return {
    ...base,
    raw_json: sourceJson,
    reason: null,
    event: {
      product_id, source: `bunny:${cfg.zoneId}:${sourceName}`, event_id,
      kind, amount_minor, currency, channel: null,
      occurred_at: new Date(occurred_at).toISOString(),
    },
  };
}

export function queryBunnyLogs(zoneId: number, from: number, to: number, offset: number): URL {
  const url = new URL(`https://logging.bunnycdn.com/v2/pullzones/${zoneId}/logs`);
  url.searchParams.set("from", new Date(from).toISOString());
  url.searchParams.set("to", new Date(to).toISOString());
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", "1000");
  url.searchParams.set("order", "asc");
  url.searchParams.set("urlContains", "/collect");
  return url;
}
