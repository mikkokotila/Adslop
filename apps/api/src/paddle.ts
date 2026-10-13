/** Signed Paddle notifications trigger native reads; browser events never establish cash. */
export interface PaddleConfig {
  PADDLE_ENVIRONMENT?: string;
  PADDLE_ACCOUNT_ID?: string;
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_PRICE_MAP?: string;
}
export interface PaddleConnection {
  environment: "live" | "sandbox";
  account: string;
  apiKey: string;
  webhookSecret: string;
  prices: Record<string, string>;
  source: string;
}
export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  entity_id: string;
  fingerprint: string;
}
export interface PaddleEffect {
  resource_id: string;
  transaction_id: string;
  subscription_id: string;
  product_id: string;
  kind: "subscription_receipt" | "subscription_refund";
  action: "payment" | "refund" | "chargeback";
  amount_minor: string;
  gross_minor: string;
  tax_minor: string;
  currency: string;
  occurred_at: string;
  price_ids: string[];
  payment_ids: string[];
}
export class PaddleError extends Error {
  constructor(readonly code: string, readonly status: number, readonly requestId: string | null = null) {
    super(code);
  }
}
type Obj = Record<string, unknown>;
const entity = /^[a-z]{2,12}_[a-z0-9]{26}$/;
const product = /^(?!\.{1,2}$)[A-Za-z0-9_.:-]{1,128}$/;
const maxBody = 262144;
const basis = "captured_subscription_cash_excluding_tax_before_fees";
export const paddleAmountBasis = basis;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaddleError("paddle_invalid_evidence", 422);
  return value as Obj;
}
function identifier(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !entity.test(value) || !value.startsWith(prefix + "_")) {
    throw new PaddleError("paddle_invalid_identity", 422);
  }
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))) throw new PaddleError("paddle_invalid_timestamp", 422);
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) throw new PaddleError("paddle_invalid_timestamp", 422);
  return normalized;
}
function minor(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PaddleError("paddle_invalid_minor_units", 422);
  }
  return BigInt(value);
}
function list(value: unknown): Obj[] {
  if (!Array.isArray(value) || value.length > 100) throw new PaddleError("paddle_invalid_evidence", 422);
  return value.map(object);
}
function match(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new PaddleError("paddle_source_mismatch", 409);
}
export function paddleConnection(env: PaddleConfig): PaddleConnection {
  if (!env.PADDLE_API_KEY || !env.PADDLE_WEBHOOK_SECRET || !env.PADDLE_PRICE_MAP ||
      !env.PADDLE_ACCOUNT_ID || !env.PADDLE_ENVIRONMENT) throw new PaddleError("paddle_not_configured", 503);
  if (!["live", "sandbox"].includes(env.PADDLE_ENVIRONMENT) || !/^[A-Za-z0-9_-]{1,64}$/.test(env.PADDLE_ACCOUNT_ID)) {
    throw new PaddleError("paddle_invalid_configuration", 503);
  }
  let prices: Obj;
  try { prices = object(JSON.parse(env.PADDLE_PRICE_MAP)); }
  catch { throw new PaddleError("paddle_invalid_price_map", 503); }
  if (!Object.keys(prices).length || Object.entries(prices).some(([key, val]) =>
    !/^pri_[a-z0-9]{26}$/.test(key) || typeof val !== "string" || !product.test(val))) {
    throw new PaddleError("paddle_invalid_price_map", 503);
  }
  return { environment: env.PADDLE_ENVIRONMENT as "live" | "sandbox", account: env.PADDLE_ACCOUNT_ID,
    apiKey: env.PADDLE_API_KEY, webhookSecret: env.PADDLE_WEBHOOK_SECRET, prices: prices as Record<string, string>,
    source: "paddle:" + env.PADDLE_ENVIRONMENT + ":" + env.PADDLE_ACCOUNT_ID };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const row = value as Obj;
    return "{" + Object.keys(row).sort().map(k => JSON.stringify(k) + ":" + canonical(row[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
export async function verifyPaddleWebhook(request: Request, config: PaddleConnection): Promise<PaddleEvent> {
  const signature = request.headers.get("Paddle-Signature");
  if (!signature || signature.length > 512) throw new PaddleError("paddle_invalid_signature", 401);
  const entries = signature.split(";").map(v => v.trim().split("="));
  const times = entries.filter(v => v[0] === "ts"), hashes = entries.filter(v => v[0] === "h1");
  if (times.length !== 1 || !/^[0-9]{10,11}$/.test(times[0][1] ?? "") || !hashes.length || hashes.length > 4 ||
      entries.some(v => v.length !== 2 || !["ts", "h1"].includes(v[0])) ||
      hashes.some(v => !/^[a-f0-9]{64}$/.test(v[1]))) throw new PaddleError("paddle_invalid_signature", 401);
  const ts = times[0][1];
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 5) throw new PaddleError("paddle_signature_expired", 401);
  if (!request.body) throw new PaddleError("paddle_invalid_payload", 400);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBody) { await reader.cancel(); throw new PaddleError("paddle_payload_too_large", 413); }
    chunks.push(value);
  }
  const raw = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { raw.set(chunk, at); at += chunk.length; }
  const prefix = new TextEncoder().encode(ts + ":"), signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix); signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.webhookSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let verified = false;
  for (const [, hash] of hashes) {
    const bytes = Uint8Array.from(hash.match(/.{2}/g)!, v => parseInt(v, 16));
    verified = (await crypto.subtle.verify("HMAC", key, bytes, signed)) || verified;
  }
  if (!verified) throw new PaddleError("paddle_invalid_signature", 401);
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 5) throw new PaddleError("paddle_signature_expired", 401);
  let payload: Obj;
  try { payload = object(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw))); }
  catch { throw new PaddleError("paddle_invalid_payload", 400); }
  const event_id = identifier(payload.event_id, "evt"), data = object(payload.data);
  if (typeof payload.event_type !== "string" || !/^[a-z][a-z_.]{1,80}$/.test(payload.event_type) ||
      typeof data.id !== "string" || !entity.test(data.id)) throw new PaddleError("paddle_invalid_payload", 400);
  const occurred_at = timestamp(payload.occurred_at);
  // notification_id and JSON formatting can differ on delivery; the signed event cannot.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical({
    event_id, event_type: payload.event_type, occurred_at, data,
  })));
  return { event_id, event_type: payload.event_type, occurred_at, entity_id: data.id,
    fingerprint: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("") };
}
async function native(config: PaddleConnection, edge: "transactions" | "adjustments", id: string): Promise<Obj> {
  identifier(id, edge === "transactions" ? "txn" : "adj");
  const host = config.environment === "live" ? "api.paddle.com" : "sandbox-api.paddle.com";
  let reply: Response;
  try {
    reply = await fetch("https://" + host + "/" + edge + "/" + id, {
      headers: { Authorization: "Bearer " + config.apiKey, "Paddle-Version": "1", Accept: "application/json" },
      redirect: "manual", signal: AbortSignal.timeout(1800),
    });
  } catch { throw new PaddleError("paddle_source_unavailable", 503); }
  if (!reply.ok) throw new PaddleError(reply.status === 401 || reply.status === 403 ? "paddle_source_access_denied" :
    reply.status === 404 ? "paddle_source_not_found" : reply.status === 429 ? "paddle_source_rate_limited" :
      "paddle_source_unavailable", 503);
  let value: Obj;
  try { value = object(await reply.json()); } catch { throw new PaddleError("paddle_invalid_source_response", 502); }
  const data = object(value.data); match(data.id, id); return data;
}
function receipt(data: Obj, config: PaddleConnection): PaddleEffect {
  const transactionId = identifier(data.id, "txn"), subscriptionId = identifier(data.subscription_id, "sub");
  if (data.status !== "completed") throw new PaddleError("paddle_transaction_not_completed", 422);
  if (typeof data.currency_code !== "string" || !/^[A-Z]{3}$/.test(data.currency_code)) throw new PaddleError("paddle_invalid_currency", 422);
  const items = list(data.items);
  if (!items.length) throw new PaddleError("paddle_missing_subscription_items", 422);
  const priceIds: string[] = [], products = new Set<string>();
  for (const item of items) {
    const price = object(item.price), cycle = object(price.billing_cycle), priceId = identifier(price.id, "pri");
    if (!["day", "week", "month", "year"].includes(String(cycle.interval)) ||
        !Number.isSafeInteger(cycle.frequency) || Number(cycle.frequency) <= 0 ||
        !Number.isSafeInteger(item.quantity) || Number(item.quantity) <= 0) throw new PaddleError("paddle_non_recurring_items", 422);
    if (!Object.hasOwn(config.prices, priceId)) throw new PaddleError("paddle_unmapped_price", 422);
    products.add(config.prices[priceId]); priceIds.push(priceId);
  }
  if (products.size !== 1) throw new PaddleError("paddle_mixed_product_transaction", 422);
  const totals = object(object(data.details).totals);
  match(totals.currency_code, data.currency_code);
  if (minor(totals.credit) !== 0n || minor(totals.credit_to_balance) !== 0n || minor(totals.balance) !== 0n) {
    throw new PaddleError("paddle_credited_or_unpaid_transaction", 422);
  }
  const gross = minor(totals.grand_total), tax = minor(totals.tax), total = minor(totals.total);
  if (gross !== total || minor(totals.subtotal) - minor(totals.discount) + tax !== total || tax > gross || gross === tax) {
    throw new PaddleError("paddle_transaction_amount_mismatch", 422);
  }
  const captured = list(data.payments).filter(v => v.status === "captured"), paymentIds: string[] = [], times: string[] = [];
  let paid = 0n;
  for (const payment of captured) {
    if (typeof payment.payment_attempt_id !== "string" || !/^[a-f0-9-]{36}$/.test(payment.payment_attempt_id)) {
      throw new PaddleError("paddle_invalid_payment_identity", 422);
    }
    paymentIds.push(payment.payment_attempt_id); paid += minor(payment.amount); times.push(timestamp(payment.captured_at));
  }
  if (new Set(paymentIds).size !== paymentIds.length || paid !== gross || !times.length) {
    throw new PaddleError("paddle_captured_cash_mismatch", 422);
  }
  return { resource_id: transactionId, transaction_id: transactionId, subscription_id: subscriptionId,
    product_id: [...products][0], kind: "subscription_receipt", action: "payment", amount_minor: (gross - tax).toString(),
    gross_minor: gross.toString(), tax_minor: tax.toString(), currency: data.currency_code,
    occurred_at: times.sort().at(-1)!, price_ids: [...new Set(priceIds)].sort(), payment_ids: paymentIds.sort() };
}
export async function readPaddleEffects(event: PaddleEvent, config: PaddleConnection): Promise<PaddleEffect[]> {
  if (event.event_type === "transaction.completed") return [receipt(await native(config, "transactions", event.entity_id), config)];
  if (!["adjustment.created", "adjustment.updated"].includes(event.event_type)) return [];
  const adjustment = await native(config, "adjustments", event.entity_id);
  if (["pending_approval", "rejected"].includes(String(adjustment.status))) return [];
  if (adjustment.status !== "approved" || !["refund", "chargeback"].includes(String(adjustment.action))) {
    throw new PaddleError("paddle_unsupported_adjustment", 422);
  }
  const original = receipt(await native(config, "transactions", identifier(adjustment.transaction_id, "txn")), config);
  match(adjustment.subscription_id, original.subscription_id); match(adjustment.currency_code, original.currency);
  const totals = object(adjustment.totals); match(totals.currency_code, original.currency);
  const gross = minor(totals.total), tax = minor(totals.tax), amount = minor(totals.subtotal);
  if (gross !== amount + tax || gross > BigInt(original.gross_minor) || tax > BigInt(original.tax_minor) || amount <= 0n) {
    throw new PaddleError("paddle_adjustment_amount_mismatch", 422);
  }
  return [original, { ...original, resource_id: identifier(adjustment.id, "adj"), kind: "subscription_refund",
    action: adjustment.action as "refund" | "chargeback", amount_minor: amount.toString(),
    gross_minor: gross.toString(), tax_minor: tax.toString(), occurred_at: timestamp(adjustment.updated_at) }];
}
