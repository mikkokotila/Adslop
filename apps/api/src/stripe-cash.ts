/** Interpret native Stripe subscription cash, not checkout state or earned revenue. */
import { StripeError, StripeReader, stripeEvent, stripeId, stripeMoney, stripeObject,
  stripeTime, type StripeEvent, type StripeObject } from "./stripe";

export interface StripeCashEffect {
  resource_id: string;
  product_id: string;
  invoice_id: string;
  subscription_id: string;
  invoice_payment_id: string;
  payment_intent_id: string;
  charge_id: string;
  kind: "subscription_receipt" | "subscription_refund";
  amount_minor: string;
  currency: string;
  occurred_at: string;
  time_basis: "invoice_payment_paid_at" | "successful_refund_created_at";
  cash_basis: "customer_cash_including_tax_before_fees";
  invoice_tax_minor: string;
  refund_tax_minor: null;
  service_periods: { line_id: string; price_id: string; stripe_product_id: string; from: string; to: string }[];
}
export interface StripeCashBatch {
  effects: StripeCashEffect[];
  invoice_id: string | null;
  reason: string | null;
  pending_refunds: string[];
}
export interface StripeResolution {
  invoice_id: string | null; charge_id: string | null; product_id?: string; currency?: string;
}
function scope(value: StripeObject, client: StripeReader, kind: string): void {
  if (value.object !== kind || value.livemode !== (client.config.mode === "live")) {
    throw new StripeError("stripe_resource_scope_mismatch", 502, true);
  }
}
function currency(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{3}$/.test(value)) {
    throw new StripeError("stripe_invalid_currency", 502, true);
  }
  // Stripe's legacy two-decimal wire units differ from the ledger currency scale here.
  if (value === "isk" || value === "ugx") throw new StripeError("stripe_currency_units_unsupported");
  return value.toUpperCase();
}
async function invoiceForIntent(client: StripeReader, intentId: string): Promise<string> {
  const payments = await client.list("/invoice_payments", {
    "payment[type]": "payment_intent", "payment[payment_intent]": intentId, status: "paid",
  });
  if (!payments.length) throw new StripeError("stripe_invoice_payment_pending", 503, true);
  if (payments.length !== 1) throw new StripeError("stripe_ambiguous_invoice_allocation");
  scope(payments[0], client, "invoice_payment");
  const payment = stripeObject(payments[0].payment);
  if (payment.type !== "payment_intent" || payment.payment_intent !== intentId || payments[0].status !== "paid") {
    throw new StripeError("stripe_payment_identity_mismatch", 502, true);
  }
  return stripeId(payments[0].invoice, "in");
}
/** Re-read the complete invoice, paid allocation and all refunds on the charge. */
export async function collectStripeInvoice(client: StripeReader, invoiceId: string,
  resolution: StripeResolution = { invoice_id: null, charge_id: null }): Promise<StripeCashBatch> {
  stripeId(invoiceId, "in");
  const invoice = await client.resource("/invoices", invoiceId, "invoice", { "expand[]": "amount_paid_off_stripe" });
  resolution.invoice_id = invoiceId;
  if (invoice.parent === null) throw new StripeError("stripe_not_subscription_invoice");
  const parent = stripeObject(invoice.parent);
  if (parent.type !== "subscription_details") throw new StripeError("stripe_not_subscription_invoice");
  const subscription = stripeId(stripeObject(parent.subscription_details).subscription, "sub");
  const lines = await client.list("/invoices/" + invoiceId + "/lines");
  if (!lines.length) throw new StripeError("stripe_missing_invoice_lines", 502, true);
  const products = new Set<string>();
  const service: StripeCashEffect["service_periods"] = [];
  const checkedPrices = new Set<string>();
  const unit = currency(invoice.currency);
  for (const line of lines) {
    scope(line, client, "line_item");
    const lineParent = stripeObject(line.parent);
    if (lineParent.type !== "subscription_item_details" ||
        stripeObject(lineParent.subscription_item_details).subscription !== subscription) {
      throw new StripeError("stripe_nonrecurring_invoice_line");
    }
    const pricing = stripeObject(line.pricing);
    if (pricing.type !== "price_details") throw new StripeError("stripe_unsupported_pricing");
    const details = stripeObject(pricing.price_details);
    const priceId = stripeId(details.price, "price");
    const product = stripeId(details.product, "prod");
    const mapped = client.config.prices[priceId];
    if (!mapped || mapped.stripe_product_id !== product) throw new StripeError("stripe_unmapped_price");
    products.add(mapped.product_id);
    if (currency(line.currency) !== unit) throw new StripeError("stripe_currency_mismatch");
    if (!checkedPrices.has(priceId)) {
      const price = await client.resource("/prices", priceId, "price");
      if (price.type !== "recurring" || price.product !== product || currency(price.currency) !== unit) {
        throw new StripeError("stripe_price_contract_mismatch");
      }
      checkedPrices.add(priceId);
    }
    const period = stripeObject(line.period);
    const from = stripeTime(period.start), to = stripeTime(period.end);
    if (from > to) throw new StripeError("stripe_invalid_service_period", 502, true);
    service.push({ line_id: stripeId(line.id, "il"), price_id: priceId, stripe_product_id: product, from, to });
  }
  if (products.size !== 1) throw new StripeError("stripe_mixed_product_invoice");
  resolution.product_id = [...products][0];
  resolution.currency = unit;
  const product = [...products][0];
  service.sort((a, b) => a.line_id.localeCompare(b.line_id));
  if (invoice.status !== "paid") {
    if (stripeMoney(invoice.amount_paid) > 0n) throw new StripeError("stripe_non_cash_or_partial_invoice");
    if (!["draft", "open", "void", "uncollectible"].includes(String(invoice.status))) {
      throw new StripeError("stripe_unknown_invoice_status", 502, true);
    }
    return { effects: [], invoice_id: invoiceId, reason: "invoice_not_paid", pending_refunds: [] };
  }
  const total = stripeMoney(invoice.total);
  if (total === 0n && stripeMoney(invoice.amount_paid) === 0n) {
    return { effects: [], invoice_id: invoiceId, reason: "zero_cash_invoice", pending_refunds: [] };
  }
  // A paid flag can represent credit or an out-of-band payment. Require full native cash equality.
  if (total <= 0n || stripeMoney(invoice.amount_paid) !== total || stripeMoney(invoice.amount_due) !== total ||
      stripeMoney(invoice.amount_remaining) !== 0n || stripeMoney(invoice.amount_overpaid) !== 0n || invoice.starting_balance !== 0 ||
      invoice.ending_balance !== 0 || stripeMoney(invoice.amount_paid_off_stripe) !== 0n ||
      stripeMoney(invoice.pre_payment_credit_notes_amount) !== 0n) {
    throw new StripeError("stripe_non_cash_or_partial_invoice");
  }
  const taxes = invoice.total_taxes;
  if (taxes !== null && !Array.isArray(taxes)) throw new StripeError("stripe_missing_tax_evidence", 502, true);
  const tax = (taxes ?? []).reduce((sum: bigint, raw: unknown) => sum + stripeMoney(stripeObject(raw).amount), 0n);
  if (tax > total) throw new StripeError("stripe_tax_exceeds_payment");
  const payments = await client.list("/invoice_payments", { invoice: invoiceId, status: "paid" });
  if (!payments.length) throw new StripeError("stripe_invoice_payment_pending", 503, true);
  if (payments.length !== 1) throw new StripeError("stripe_ambiguous_invoice_allocation");
  const paid = payments[0];
  scope(paid, client, "invoice_payment");
  const payment = stripeObject(paid.payment);
  if (paid.invoice !== invoiceId || paid.status !== "paid" || stripeMoney(paid.amount_paid) !== total ||
      currency(paid.currency) !== unit || payment.type !== "payment_intent") {
    throw new StripeError("stripe_non_cash_or_partial_invoice");
  }
  const intentId = stripeId(payment.payment_intent, "pi");
  const intent = await client.resource("/payment_intents", intentId, "payment_intent");
  if (intent.status !== "succeeded" || stripeMoney(intent.amount_received) !== total || currency(intent.currency) !== unit) {
    throw new StripeError("stripe_payment_not_captured");
  }
  const chargeId = stripeId(intent.latest_charge, "ch");
  const charge = await client.resource("/charges", chargeId, "charge");
  resolution.charge_id = chargeId;
  if (charge.payment_intent !== intentId || charge.status !== "succeeded" || charge.paid !== true ||
      charge.captured !== true || stripeMoney(charge.amount_captured) !== total || currency(charge.currency) !== unit ||
      charge.transfer_data != null || charge.on_behalf_of != null) {
    throw new StripeError("stripe_charge_contract_mismatch");
  }
  if (charge.disputed !== false) throw new StripeError("stripe_dispute_requires_reconciliation");
  const common = { product_id: product, invoice_id: invoiceId, subscription_id: subscription,
    invoice_payment_id: stripeId(paid.id, "inpay"), payment_intent_id: intentId, charge_id: chargeId,
    currency: unit, cash_basis: "customer_cash_including_tax_before_fees" as const,
    invoice_tax_minor: tax.toString(), refund_tax_minor: null, service_periods: service };
  const effects: StripeCashEffect[] = [{ ...common, resource_id: chargeId, kind: "subscription_receipt",
    amount_minor: total.toString(), occurred_at: stripeTime(stripeObject(paid.status_transitions).paid_at),
    time_basis: "invoice_payment_paid_at" }];
  const refunds = await client.list("/refunds", { charge: chargeId });
  const pending: string[] = [];
  let refunded = 0n;
  for (const refund of refunds) {
    // Stripe Refund objects have no livemode; mode/account are bound through their charge.
    const id = stripeId(refund.id, "re");
    if (refund.object !== "refund" || refund.charge !== chargeId || refund.payment_intent !== intentId ||
        currency(refund.currency) !== unit) throw new StripeError("stripe_refund_identity_mismatch", 502, true);
    if (refund.status === "failed" || refund.status === "canceled") continue;
    if (refund.status === "pending" || refund.status === "requires_action") { pending.push(id); continue; }
    if (refund.status !== "succeeded") throw new StripeError("stripe_unknown_refund_state", 502, true);
    const amount = stripeMoney(refund.amount);
    if (amount <= 0n) throw new StripeError("stripe_invalid_refund_amount", 502, true);
    refunded += amount;
    effects.push({ ...common, resource_id: id, kind: "subscription_refund", amount_minor: amount.toString(),
      occurred_at: stripeTime(refund.created), time_basis: "successful_refund_created_at" });
  }
  if (refunded > total || refunded !== stripeMoney(charge.amount_refunded)) {
    throw new StripeError("stripe_refund_total_mismatch", 503, true);
  }
  return { effects, invoice_id: invoiceId, reason: null, pending_refunds: pending.sort() };
}
export async function collectStripeEvent(client: StripeReader, eventId: string,
  expected?: StripeEvent, resolution: StripeResolution = { invoice_id: null, charge_id: null }):
  Promise<{ event: StripeEvent; batch: StripeCashBatch }> {
  const event = stripeEvent(await client.get("/events/" + stripeId(eventId, "evt")), client.config.mode);
  if (event.id !== eventId || (expected && JSON.stringify(expected) !== JSON.stringify(event))) {
    throw new StripeError("stripe_event_identity_mismatch", 400);
  }
  let invoiceId: string;
  if (["invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed"].includes(event.type)) {
    invoiceId = stripeId(event.object_id, "in");
    resolution.invoice_id = invoiceId;
  } else if (["refund.created", "refund.updated", "refund.failed", "charge.refunded"].includes(event.type)) {
    let intentId: string;
    if (event.type === "charge.refunded") {
      const charge = await client.resource("/charges", stripeId(event.object_id, "ch"), "charge");
      resolution.charge_id = stripeId(charge.id, "ch");
      intentId = stripeId(charge.payment_intent, "pi");
    } else {
      const refund = await client.get("/refunds/" + stripeId(event.object_id, "re"));
      if (refund.id !== event.object_id || refund.object !== "refund") {
        throw new StripeError("stripe_refund_identity_mismatch", 502, true);
      }
      resolution.charge_id = stripeId(refund.charge, "ch");
      intentId = stripeId(refund.payment_intent, "pi");
    }
    invoiceId = await invoiceForIntent(client, intentId);
  } else if (event.type.startsWith("charge.dispute.")) {
    const dispute = await client.resource("/disputes", stripeId(event.object_id, "du"), "dispute");
    resolution.charge_id = stripeId(dispute.charge, "ch");
    const charge = await client.resource("/charges", resolution.charge_id, "charge");
    resolution.invoice_id = await invoiceForIntent(client, stripeId(charge.payment_intent, "pi"));
    throw new StripeError("stripe_dispute_requires_reconciliation");
  } else {
    return { event, batch: { effects: [], invoice_id: null, reason: "event_not_cash_evidence", pending_refunds: [] } };
  }
  resolution.invoice_id = invoiceId;
  return { event, batch: await collectStripeInvoice(client, invoiceId, resolution) };
}
