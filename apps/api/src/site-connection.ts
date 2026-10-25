/** Product-scoped browser context. Browser requests never admit money. */
import { productId, type StripeMode } from "./stripe";
import { siteTag } from "./site-tag";
import { siteReport } from "./site-report";

export interface SiteCampaign { provider: "google" | "meta"; account_id: string; campaign_id: string }
export interface SiteConfiguration {
  origins: string[];
  attribution_window_days: number;
  max_visits_per_minute: number;
  campaigns: Record<string, SiteCampaign>;
}
export interface SiteReply { status: number; body: string; headers: Record<string, string> }
export class SiteError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export const siteReference = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SiteError("site_invalid_object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new SiteError("site_unknown_field");
}
function configuration(raw: unknown): SiteConfiguration {
  const value = object(raw);
  keys(value, ["origins", "campaigns", "attribution_window_days", "max_visits_per_minute"]);
  if (!Array.isArray(value.origins) || !value.origins.length || value.origins.length > 20 ||
      value.origins.some(origin => {
        if (typeof origin !== "string") return true;
        let url: URL;
        try { url = new URL(origin); } catch { return true; }
        return url.origin !== origin || url.username !== "" || url.password !== "" ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
      }) || new Set(value.origins).size !== value.origins.length) throw new SiteError("site_invalid_origins");
  const window = value.attribution_window_days, rate = value.max_visits_per_minute;
  if (!Number.isInteger(window) || Number(window) < 1 || Number(window) > 90 ||
      !Number.isInteger(rate) || Number(rate) < 1 || Number(rate) > 10000) throw new SiteError("site_invalid_limits");
  const campaigns: Record<string, SiteCampaign> = {};
  const entries = Object.entries(object(value.campaigns));
  if (entries.length > 100) throw new SiteError("site_too_many_campaigns");
  for (const [name, rawCampaign] of entries) {
    const campaign = object(rawCampaign);
    keys(campaign, ["provider", "account_id", "campaign_id"]);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name) || !["google", "meta"].includes(String(campaign.provider)) ||
        typeof campaign.account_id !== "string" || !(campaign.provider === "google" ? /^[0-9]{10}$/ : /^[1-9][0-9]{0,31}$/).test(campaign.account_id) ||
        typeof campaign.campaign_id !== "string" || !/^[1-9][0-9]{0,31}$/.test(campaign.campaign_id)) throw new SiteError("site_invalid_campaign");
    campaigns[name] = { provider: campaign.provider as "google" | "meta", account_id: campaign.account_id, campaign_id: campaign.campaign_id };
  }
  return { origins: [...value.origins].sort(), attribution_window_days: Number(window), max_visits_per_minute: Number(rate), campaigns };
}

export class SiteJournal {
  constructor(private readonly sql: SqlStorage) {}
  create(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS site_configurations (
      revision INTEGER PRIMARY KEY, product_id TEXT NOT NULL, mode TEXT NOT NULL,
      body TEXT NOT NULL, observed_at TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS site_config_product ON site_configurations(product_id,mode,revision)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS site_visits (
      reference TEXT PRIMARY KEY, product_id TEXT NOT NULL, mode TEXT NOT NULL,
      revision INTEGER NOT NULL, origin TEXT NOT NULL, campaign TEXT, campaign_body TEXT,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS site_visit_product ON site_visits(product_id,mode,created_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS site_collection_limits (
      product_id TEXT NOT NULL, mode TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY(product_id,mode))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS site_invoice_references (
      mode TEXT NOT NULL, account_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
      product_id TEXT NOT NULL, reference TEXT NOT NULL, conflict INTEGER NOT NULL,
      observed_at TEXT NOT NULL, PRIMARY KEY(mode,account_id,invoice_id))`);
  }
  invoice(mode: StripeMode, account: string, invoice: string, product: string, reference: string): void {
    const old = this.sql.exec<{ reference: string; product_id: string }>(
      "SELECT reference,product_id FROM site_invoice_references WHERE mode=? AND account_id=? AND invoice_id=?",
      mode, account, invoice).toArray()[0];
    if (!old) this.sql.exec("INSERT INTO site_invoice_references VALUES (?,?,?,?,?,0,?)",
      mode, account, invoice, product, reference, new Date().toISOString());
    else if (old.reference !== reference || old.product_id !== product) this.sql.exec(
      "UPDATE site_invoice_references SET conflict=1 WHERE mode=? AND account_id=? AND invoice_id=?", mode, account, invoice);
  }
  handle(product: string, mode: StripeMode, operation: string, method: string, raw: string,
    origin: string | null, apiOrigin: string, search: string): SiteReply {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", Vary: "Origin" };
    const reply = (value: unknown, status = 200): SiteReply => ({ status, body: JSON.stringify(value), headers });
    try {
      if (!productId(product)) throw new SiteError("site_invalid_product");
      if (search && operation !== "report") throw new SiteError("site_invalid_query");
      if (operation === "configuration" && method === "PUT") {
        const config = configuration(JSON.parse(raw));
        const previous = this.current(product, mode);
        if (!previous || JSON.stringify(config) !== previous.body) this.sql.exec(
          "INSERT INTO site_configurations(product_id,mode,body,observed_at) VALUES (?,?,?,?)",
          product, mode, JSON.stringify(config), new Date().toISOString());
      }
      const stored = this.current(product, mode);
      if (!stored) throw new SiteError("site_not_configured", 404);
      const config = JSON.parse(stored.body) as SiteConfiguration;
      if (operation === "configuration" && ["GET", "PUT"].includes(method)) {
        const visits = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM site_visits WHERE product_id=? AND mode=?", product, mode).toArray()[0].n;
        return reply({ product_id: product, mode, revision: stored.revision, configuration: config, collected_visits: visits,
          tag_url: `${apiOrigin}/v1/sites/${encodeURIComponent(product)}/${mode}/tag.js`,
          checkout_metadata_field: "subscription_data[metadata][adslop_reference]", coverage: "not_verified" });
      }
      if (operation === "tag.js" && method === "GET") return { status: 200,
        body: siteTag(config, `${apiOrigin}/v1/sites/${encodeURIComponent(product)}/${mode}/visits`),
        headers: { ...headers, "Content-Type": "application/javascript; charset=utf-8", "Referrer-Policy": "no-referrer" } };
      if (operation === "report" && method === "GET") return reply(siteReport(this.sql, product, mode, new URL(apiOrigin + "/" + search)));
      if (operation !== "visits" || !["POST", "OPTIONS"].includes(method)) throw new SiteError("site_method_not_allowed", 405);
      if (!origin || !config.origins.includes(origin)) throw new SiteError("site_origin_refused", 403);
      headers["Access-Control-Allow-Origin"] = origin;
      if (method === "OPTIONS") return { status: 204, body: "", headers: { ...headers,
        "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } };
      const minute = Math.floor(Date.now() / 60000);
      this.sql.exec(`INSERT INTO site_collection_limits VALUES (?,?,?,1) ON CONFLICT(product_id,mode)
        DO UPDATE SET minute=excluded.minute,count=CASE WHEN minute=excluded.minute THEN count+1 ELSE 1 END`, product, mode, minute);
      const count = this.sql.exec<{ count: number }>("SELECT count FROM site_collection_limits WHERE product_id=? AND mode=?", product, mode).toArray()[0].count;
      if (count > config.max_visits_per_minute) throw new SiteError("site_collection_rate_limit", 429);
      const input = object(JSON.parse(raw));
      keys(input, ["reference", "campaign"]);
      if (input.reference !== undefined && !siteReference(input.reference)) throw new SiteError("site_invalid_reference");
      if (input.campaign !== undefined && (typeof input.campaign !== "string" || !Object.hasOwn(config.campaigns, input.campaign))) throw new SiteError("site_unknown_campaign");
      if (input.reference !== undefined && input.campaign !== undefined) throw new SiteError("site_ambiguous_visit");
      if (input.reference) {
        const visit = this.sql.exec<{ created_at: string; expires_at: string }>(
          "SELECT created_at,expires_at FROM site_visits WHERE reference=? AND product_id=? AND mode=?", String(input.reference), product, mode).toArray()[0];
        if (!visit) throw new SiteError("site_reference_not_found", 404);
        if (Date.parse(visit.expires_at) <= Date.now()) throw new SiteError("site_reference_expired", 410);
        return reply({ reference: input.reference, ...visit, reused: true, confidence: "browser_context" });
      }
      const reference = crypto.randomUUID(), created = new Date(), expires = new Date(created.getTime() + config.attribution_window_days * 86400000);
      const campaign = typeof input.campaign === "string" ? input.campaign : null;
      this.sql.exec("INSERT INTO site_visits VALUES (?,?,?,?,?,?,?,?,?)", reference, product, mode,
        stored.revision, origin, campaign, campaign ? JSON.stringify(config.campaigns[campaign]) : null, created.toISOString(), expires.toISOString());
      return reply({ reference, created_at: created.toISOString(), expires_at: expires.toISOString(), reused: false, confidence: "browser_context" }, 201);
    } catch (error) {
      if (error instanceof SyntaxError) return reply({ error: "site_invalid_json" }, 400);
      if (error instanceof SiteError) return reply({ error: error.code }, error.status);
      throw error;
    }
  }
  private current(product: string, mode: StripeMode): { revision: number; body: string } | undefined {
    return this.sql.exec<{ revision: number; body: string }>(
      "SELECT revision,body FROM site_configurations WHERE product_id=? AND mode=? ORDER BY revision DESC LIMIT 1", product, mode).toArray()[0];
  }
}
