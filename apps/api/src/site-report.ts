/** Attribution joins annotate existing native cash; they never create a receipt. */
import { SiteError } from "./site-connection";
import { StripeJournal } from "./stripe-ledger";
import type { StripeMode } from "./stripe";

interface CashGroup { campaign: string | null; native_campaign: unknown; reason: string;
  receipts_minor: bigint; refunds_minor: bigint; effects: Record<string, unknown>[] }

export function siteReport(sql: SqlStorage, product: string, mode: StripeMode, url: URL): Record<string, unknown> {
  const query = url.searchParams, from = query.get("from"), to = query.get("to"), currency = query.get("currency");
  if (query.size !== 3 || new Set(query.keys()).size !== 3 || !currency || !/^[A-Z]{3}$/.test(currency) ||
      !from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) ||
      new Date(from).toISOString() !== from || new Date(to).toISOString() !== to ||
      from >= to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new SiteError("site_invalid_report_period");
  const rows = sql.exec<{ resource_id: string; account_id: string; invoice_id: string; kind: string; amount_minor: string;
    occurred_at: string; reference: string | null; conflict: number | null; campaign: string | null; campaign_body: string | null;
    created_at: string | null; expires_at: string | null; receipt_at: string | null }>(
    `SELECT e.resource_id,e.account_id,e.invoice_id,e.kind,e.amount_minor,e.occurred_at,
      l.reference,l.conflict,v.campaign,v.campaign_body,v.created_at,v.expires_at,
      json_extract(r.body,'$.occurred_at') AS receipt_at
     FROM stripe_effects e LEFT JOIN (SELECT mode,account_id,invoice_id,product_id,
       min(reference) AS reference,count(*)>1 AS conflict FROM site_invoice_references
       GROUP BY mode,account_id,invoice_id,product_id) l
       ON l.mode=e.mode AND l.account_id=e.account_id AND l.invoice_id=e.invoice_id AND l.product_id=e.product_id
     LEFT JOIN site_visits v ON v.reference=l.reference AND v.product_id=e.product_id AND v.mode=e.mode
     LEFT JOIN stripe_effects r ON r.mode=e.mode AND r.account_id=e.account_id
       AND r.resource_id=json_extract(e.body,'$.charge_id') AND r.kind='subscription_receipt'
     WHERE e.product_id=? AND e.mode=? AND e.currency=? AND e.occurred_at>=? AND e.occurred_at<?
     ORDER BY e.occurred_at,e.resource_id LIMIT 10001`, product, mode, currency, from, to).toArray();
  if (rows.length > 10000) throw new SiteError("site_report_limit", 422);
  const groups = new Map<string, CashGroup>();
  let receipts = 0n, refunds = 0n;
  for (const row of rows) {
    const reason = row.conflict ? "reference_conflict" : row.reference === "invalid" ? "invalid_reference" :
      !row.reference || row.reference === "absent" ? "no_reference" : !row.created_at ? "unknown_reference" :
      !row.receipt_at || Date.parse(row.receipt_at) + 1000 <= Date.parse(row.created_at) ||
        Date.parse(row.receipt_at) >= Date.parse(row.expires_at!) ? "outside_visit_window" :
      !row.campaign ? "organic" : "linked";
    const linked = reason === "linked", native = linked ? JSON.parse(row.campaign_body!) : null;
    const key = JSON.stringify([linked ? row.campaign : null, native, reason]);
    const group: CashGroup = groups.get(key) ?? { campaign: linked ? row.campaign : null, native_campaign: native,
      reason, receipts_minor: 0n, refunds_minor: 0n, effects: [] };
    const amount = BigInt(row.amount_minor);
    if (row.kind === "subscription_receipt") { receipts += amount; group.receipts_minor += amount; }
    else { refunds += amount; group.refunds_minor += amount; }
    group.effects.push({ resource_id: row.resource_id, invoice_id: row.invoice_id, account_id: row.account_id,
      kind: row.kind, amount_minor: row.amount_minor, occurred_at: row.occurred_at, reference: row.reference });
    groups.set(key, group);
  }
  const breaks = new StripeJournal(sql).reconciliationBreaks(product, currency, mode);
  return { product_id: product, mode, currency, period: { from, to, basis: "UTC_inclusive_from_exclusive_to" },
    attribution_rule: "native_invoice_reference_and_receipt_second_overlaps_visit_window_v1",
    confidence: "browser_campaign_parameter_linked_to_verified_native_cash", incremental_lift: "unproven",
    observed_receipts_minor: receipts.toString(), observed_refunds_minor: refunds.toString(),
    observed_net_receipts_minor: breaks.length || !rows.length ? null : (receipts - refunds).toString(),
    cash_status: breaks.length ? "reconciliation_required" : rows.length ? "observed_incomplete" : "no_observations",
    reconciliation_breaks: breaks, coverage: "not_verified",
    groups: [...groups.values()].map(group => ({ ...group, receipts_minor: group.receipts_minor.toString(),
      refunds_minor: group.refunds_minor.toString(), net_receipts_minor: breaks.length ? null : (group.receipts_minor - group.refunds_minor).toString() })) };
}
