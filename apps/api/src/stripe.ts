/** Stripe authentication and GET-only source evidence. Never creates a payment. */
export const STRIPE_VERSION = "2026-07-29.dahlia";
export type StripeMode = "live" | "sandbox";
export type StripeObject = Record<string, unknown>;
export interface StripeSettings {
  STRIPE_LIVE_CONNECTION?: string;
  STRIPE_SANDBOX_CONNECTION?: string;
  STRIPE_LIVE_API_KEY?: string;
  STRIPE_SANDBOX_API_KEY?: string;
  STRIPE_LIVE_WEBHOOK_SECRET?: string;
  STRIPE_SANDBOX_WEBHOOK_SECRET?: string;
}
export interface StripeConnection {
  mode: StripeMode;
  account_id: string;
  api_key: string;
  webhook_secret: string;
  prices: Record<string, { product_id: string; stripe_product_id: string }>;
}
export interface StripeEvent {
  id: string; type: string; object_id: string; created: number; livemode: boolean;
}
export class StripeError extends Error {
  constructor(readonly code: string, readonly status = 422, readonly retryable = false,
    readonly request_id: string | null = null) { super(code); }
}
export function stripeObject(value: unknown): StripeObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StripeError("stripe_invalid_source", 502, true);
  }
  return value as StripeObject;
}
export function stripeId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp("^" + prefix + "_[A-Za-z0-9]{1,96}$").test(value)) {
    throw new StripeError("stripe_invalid_identity", 502, true);
  }
  return value;
}
/** Products may have merchant-defined IDs, unlike generated payment-resource IDs. */
export function stripeProductId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    throw new StripeError("stripe_invalid_product_identity", 502, true);
  }
  return value;
}
export function stripeMoney(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new StripeError("stripe_invalid_money", 502, true);
  }
  return BigInt(value);
}
export function stripeTime(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 253402300799) {
    throw new StripeError("stripe_invalid_timestamp", 502, true);
  }
  return new Date(value * 1000).toISOString();
}
export function productId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) &&
    value !== "." && value !== "..";
}
export function stripeConnection(env: StripeSettings, mode: StripeMode): StripeConnection {
  const raw = mode === "live" ? env.STRIPE_LIVE_CONNECTION : env.STRIPE_SANDBOX_CONNECTION;
  if (!raw) throw new StripeError("stripe_not_configured", 503, true);
  try {
    const value = stripeObject(JSON.parse(raw));
    if (Object.keys(value).some(k => !["account_id", "api_key", "webhook_secret", "prices"].includes(k))) {
      throw new Error("unknown_configuration");
    }
    const apiKey = mode === "live" ? env.STRIPE_LIVE_API_KEY : env.STRIPE_SANDBOX_API_KEY;
    const webhookSecret = mode === "live" ? env.STRIPE_LIVE_WEBHOOK_SECRET : env.STRIPE_SANDBOX_WEBHOOK_SECRET;
    if ((apiKey !== undefined && Object.hasOwn(value, "api_key")) ||
        (webhookSecret !== undefined && Object.hasOwn(value, "webhook_secret"))) {
      throw new Error("ambiguous_credentials");
    }
    if (apiKey !== undefined) value.api_key = apiKey;
    if (webhookSecret !== undefined) value.webhook_secret = webhookSecret;
    const account = stripeId(value.account_id, "acct");
    if (typeof value.api_key !== "string" ||
        !new RegExp("^[sr]k_" + (mode === "live" ? "live" : "test") + "_[A-Za-z0-9]+$").test(value.api_key) ||
        typeof value.webhook_secret !== "string" || !/^whsec_[A-Za-z0-9]+$/.test(value.webhook_secret)) {
      throw new Error("invalid_credentials");
    }
    const prices: StripeConnection["prices"] = {};
    const entries = Object.entries(stripeObject(value.prices));
    if (entries.length < 1 || entries.length > 100) throw new Error("invalid_price_map");
    for (const [id, mapping] of entries) {
      stripeId(id, "price");
      const item = stripeObject(mapping);
      if (!productId(item.product_id) ||
          Object.keys(item).some(k => !["product_id", "stripe_product_id"].includes(k))) {
        throw new Error("invalid_product_mapping");
      }
      prices[id] = { product_id: item.product_id, stripe_product_id: stripeProductId(item.stripe_product_id) };
    }
    return { mode, account_id: account, api_key: value.api_key, webhook_secret: value.webhook_secret, prices };
  } catch {
    throw new StripeError("stripe_invalid_configuration", 503, true);
  }
}
export function stripeEvent(value: unknown, mode: StripeMode): StripeEvent {
  const event = stripeObject(value);
  if (event.object !== "event" || typeof event.type !== "string" ||
      !/^[a-z_.]{1,100}$/.test(event.type) || event.livemode !== (mode === "live") ||
      event.account != null || event.context != null) {
    throw new StripeError("stripe_event_scope_mismatch", 400);
  }
  stripeTime(event.created);
  const resource = stripeObject(stripeObject(event.data).object);
  if (typeof resource.id !== "string" || !/^[A-Za-z0-9_]{1,128}$/.test(resource.id)) {
    throw new StripeError("stripe_invalid_event_resource", 400);
  }
  return { id: stripeId(event.id, "evt"), type: event.type, object_id: resource.id,
    created: event.created as number, livemode: event.livemode as boolean };
}
export async function boundedBytes(response: Request | Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get("Content-Length")) > limit) {
    throw new StripeError("stripe_payload_too_large", 413);
  }
  if (!response.body) throw new StripeError("stripe_empty_body", 400);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new StripeError("stripe_payload_too_large", 413);
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
export async function stripeDigest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function verifyStripeWebhook(request: Request, config: StripeConnection): Promise<{
  event: StripeEvent; payload_hash: string;
}> {
  const signature = request.headers.get("Stripe-Signature");
  if (!signature || signature.length > 2048) throw new StripeError("stripe_invalid_signature", 400);
  const parts = signature.split(",").map(v => v.trim());
  const times = parts.filter(v => v.startsWith("t="));
  const signatures = parts.filter(v => /^v1=[a-f0-9]{64}$/.test(v)).map(v => v.slice(3));
  if (times.length !== 1 || !/^t=[0-9]{1,12}$/.test(times[0]) || !signatures.length ||
      Math.abs(Date.now() / 1000 - Number(times[0].slice(2))) > 300) {
    throw new StripeError("stripe_invalid_signature", 400);
  }
  const body = await boundedBytes(request, 262144);
  const prefix = new TextEncoder().encode(times[0].slice(2) + ".");
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix); signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.webhook_secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  for (const hex of signatures) {
    const sig = Uint8Array.from(hex.match(/../g)!.map(x => parseInt(x, 16)));
    if (await crypto.subtle.verify("HMAC", key, sig, signed)) valid = true;
  }
  if (!valid) throw new StripeError("stripe_invalid_signature", 400);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)); }
  catch { throw new StripeError("stripe_invalid_json", 400); }
  return { event: stripeEvent(parsed, config.mode), payload_hash: await stripeDigest(body) };
}
/** One bounded source read; redirects never receive credentials and no HTTP writes exist. */
export class StripeReader {
  readonly request_ids: string[] = [];
  private calls = 0;
  private readonly started = Date.now();
  constructor(readonly config: StripeConnection) {}
  async get(path: string, params: Record<string, string> = {}): Promise<StripeObject> {
    if (!/^\/(account|events|invoices|invoice_payments|payment_intents|charges|refunds|prices|disputes)(?:\/[A-Za-z0-9_]+)*(?:\/lines)?$/.test(path)) {
      throw new StripeError("stripe_invalid_api_path", 500);
    }
    if (++this.calls > 40 || Date.now() - this.started > 20000) {
      throw new StripeError("stripe_source_read_limit", 503, true);
    }
    const url = new URL("https://api.stripe.com/v1" + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let reply: Response;
    try {
      reply = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000),
        headers: { Authorization: "Bearer " + this.config.api_key, "Stripe-Version": STRIPE_VERSION } });
    } catch { throw new StripeError("stripe_transport_unavailable", 503, true); }
    const nativeId = reply.headers.get("request-id");
    const id = nativeId && /^req_[A-Za-z0-9]{1,128}$/.test(nativeId) ? nativeId : null;
    if (id) this.request_ids.push(id);
    if (!reply.ok) {
      throw new StripeError(reply.status === 401 || reply.status === 403 ? "stripe_access_denied" :
        reply.status === 429 ? "stripe_rate_limited" : "stripe_source_unavailable", 503, true, id);
    }
    try {
      const raw = await boundedBytes(reply, 2_000_000);
      const result = stripeObject(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw)));
      if (result.error) throw new Error("error_response");
      return result;
    } catch { throw new StripeError("stripe_invalid_source", 502, true, id); }
  }
  async account(): Promise<void> {
    const account = await this.get("/account");
    if (account.id !== this.config.account_id || account.object !== "account") {
      throw new StripeError("stripe_account_mismatch", 503, true);
    }
  }
  async resource(path: string, id: string, objectType: string, params: Record<string, string> = {}): Promise<StripeObject> {
    const value = await this.get(path + "/" + id, params);
    if (value.id !== id || value.object !== objectType || value.livemode !== (this.config.mode === "live")) {
      throw new StripeError("stripe_resource_scope_mismatch", 502, true);
    }
    return value;
  }
  async list(path: string, params: Record<string, string> = {}): Promise<StripeObject[]> {
    const rows: StripeObject[] = [];
    const seen = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 10; page++) {
      const value = await this.get(path, { ...params, limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
      if (value.object !== "list" || !Array.isArray(value.data) || typeof value.has_more !== "boolean") {
        throw new StripeError("stripe_invalid_page", 502, true);
      }
      for (const raw of value.data) {
        const row = stripeObject(raw);
        if (typeof row.id !== "string" || !/^[A-Za-z0-9_]{1,128}$/.test(row.id) || seen.has(row.id)) {
          throw new StripeError("stripe_repeated_source_identity", 502, true);
        }
        seen.add(row.id); rows.push(row); cursor = row.id;
      }
      if (!value.has_more) return rows;
      if (!value.data.length) throw new StripeError("stripe_incomplete_page", 502, true);
    }
    throw new StripeError("stripe_page_limit", 503, true);
  }
}
