/** Stripe wire-contract fixtures in an isolated Worker database; not commercial or live-account evidence. */
import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { StripeReader, STRIPE_VERSION, stripeProductId, stripeConnection, type StripeConnection, type StripeMode, type StripeObject } from "../src/stripe";

const root = "https://adslop.test/v1/stripe";
const operator = { Authorization: "Bearer test-only-economic-ledger" };
const account = "acct_ContractFixture";
const price = "price_ContractFixture";
const product = "prod_ContractFixture";
const second = Date.parse("2026-10-07T12:00:00.000Z") / 1000;
beforeEach(async () => { await reset(); });
afterEach(() => vi.unstubAllGlobals());

function fixture(mode: StripeMode = "sandbox") {
  const live = mode === "live";
  const config: StripeConnection = { mode, account_id: account, api_key: live ? "rk_live_contractfixture" : "rk_test_contractfixture",
    webhook_secret: "whsec_contractfixture", prices: { [price]: { product_id: "stripe-test", stripe_product_id: product } } };
  const runtime = { ...env, [live ? "STRIPE_LIVE_CONNECTION" : "STRIPE_SANDBOX_CONNECTION"]: JSON.stringify({
    account_id: config.account_id, api_key: config.api_key, webhook_secret: config.webhook_secret, prices: config.prices,
  }) } as Env;
  const invoice: StripeObject = { id: "in_ContractFixture", object: "invoice", livemode: live,
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_ContractFixture" } },
    status: "paid", currency: "eur", total: 1255, amount_paid: 1255, amount_due: 1255, amount_remaining: 0,
    amount_overpaid: 0, starting_balance: 0, ending_balance: 0, amount_paid_off_stripe: 0,
    pre_payment_credit_notes_amount: 0, total_taxes: [{ amount: 255 }] };
  const line: StripeObject = { id: "il_ContractFixture", object: "line_item", livemode: live, currency: "eur",
    parent: { type: "subscription_item_details", subscription_item_details: { subscription: "sub_ContractFixture" } },
    pricing: { type: "price_details", price_details: { price, product } }, period: { start: second, end: second + 86400 * 30 } };
  const paid: StripeObject = { id: "inpay_ContractFixture", object: "invoice_payment", livemode: live,
    invoice: invoice.id, status: "paid", amount_paid: 1255, currency: "eur",
    payment: { type: "payment_intent", payment_intent: "pi_ContractFixture" }, status_transitions: { paid_at: second } };
  const intent: StripeObject = { id: "pi_ContractFixture", object: "payment_intent", livemode: live,
    status: "succeeded", amount_received: 1255, currency: "eur", latest_charge: "ch_ContractFixture" };
  const charge: StripeObject = { id: "ch_ContractFixture", object: "charge", livemode: live,
    payment_intent: intent.id, status: "succeeded", paid: true, captured: true, amount_captured: 1255,
    currency: "eur", amount_refunded: 0, disputed: false, transfer_data: null, on_behalf_of: null };
  const nativePrice: StripeObject = { id: price, object: "price", livemode: live, type: "recurring", product, currency: "eur" };
  const nativeAccount: StripeObject = { id: account, object: "account" };
  const refunds: StripeObject[] = [];
  const lines: StripeObject[] = [line];
  const payments: StripeObject[] = [paid];
  const events = new Map<string, StripeObject>();
  const disputes = new Map<string, StripeObject>();
  const calls: URL[] = [];
  let linePageSize = 100;
  function event(id: string, type = "invoice.paid", objectId = String(invoice.id)): StripeObject {
    const value = { id, object: "event", type, created: second, livemode: live, data: { object: { id: objectId } } };
    events.set(id, value); return value;
  }
  function refund(id: string, amount: number, status = "succeeded") {
    const value = { id, object: "refund", charge: charge.id, payment_intent: intent.id, currency: "eur",
      amount, created: second + 86400, status };
    refunds.push(value);
    charge.amount_refunded = refunds.filter(r => r.status === "succeeded").reduce((sum, r) => sum + Number(r.amount), 0);
    return value;
  }
  const list = (data: StripeObject[], has_more = false) => ({ object: "list", data, has_more });
  const transport = vi.fn(async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(resource)); calls.push(url);
    expect(url.origin).toBe("https://api.stripe.com");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer " + config.api_key);
    expect(new Headers(init?.headers).get("Stripe-Version")).toBe(STRIPE_VERSION);
    expect(url.searchParams.has("api_key")).toBe(false);
    let response: object | undefined;
    const id = url.pathname.split("/").at(-1)!;
    if (url.pathname === "/v1/account") response = nativeAccount;
    else if (url.pathname.startsWith("/v1/events/")) response = events.get(id);
    else if (url.pathname.endsWith("/lines")) {
      const cursor = url.searchParams.get("starting_after");
      const at = cursor ? lines.findIndex(row => row.id === cursor) + 1 : 0;
      response = list(lines.slice(at, at + linePageSize), at + linePageSize < lines.length);
    } else if (url.pathname === "/v1/invoices/" + invoice.id) {
      // amount_paid_off_stripe is an includable field; callers must explicitly request it.
      expect(url.searchParams.get("expand[]")).toBe("amount_paid_off_stripe"); response = invoice;
    } else if (url.pathname === "/v1/invoice_payments") response = list(payments);
    else if (url.pathname === "/v1/payment_intents/" + intent.id) response = intent;
    else if (url.pathname === "/v1/charges/" + charge.id) response = charge;
    else if (url.pathname === "/v1/prices/" + price) response = nativePrice;
    else if (url.pathname === "/v1/refunds") response = list(refunds);
    else if (url.pathname.startsWith("/v1/refunds/")) response = refunds.find(r => r.id === id);
    else if (url.pathname.startsWith("/v1/disputes/")) response = disputes.get(id);
    if (!response) throw new Error("Unrecognised contract-fixture source path " + url.pathname);
    return Response.json(response, { headers: { "request-id": "req_ContractFixture" } });
  });
  vi.stubGlobal("fetch", transport);
  return { config, runtime, invoice, line, paid, intent, charge, nativePrice, nativeAccount,
    refunds, lines, payments, events, disputes, calls, transport, event, refund,
    paginateLines(size: number) { linePageSize = size; } };
}
async function api(path: string, runtime = env as Env, body?: object) {
  return worker.fetch(new Request(root + path, { method: body ? "POST" : "GET", headers: operator,
    ...(body ? { body: JSON.stringify(body) } : {}) }), runtime);
}
async function economics(runtime: Env) {
  return worker.fetch(new Request("https://adslop.test/v1/economics?product_id=stripe-test&currency=EUR", {
    headers: operator }), runtime);
}
async function signed(event: object, config: StripeConnection, runtime: Env,
  timestamp = Math.floor(Date.now() / 1000), changedBody?: string) {
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.webhook_secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + body)));
  const hex = [...digest].map(v => v.toString(16).padStart(2, "0")).join("");
  return worker.fetch(new Request(root + "/" + config.mode + "/webhook", { method: "POST",
    headers: { "Stripe-Signature": "t=" + timestamp + ",v1=" + hex }, body: changedBody ?? body }), runtime);
}

it("keeps operator routes private and rejects unsigned webhooks", async () => {
  const f = fixture();
  for (const path of ["/live/status", "/sandbox/status", "/sandbox/effects?product_id=stripe-test"]) {
    expect((await worker.fetch(new Request(root + path), f.runtime)).status).toBe(401);
  }
  const response = await worker.fetch(new Request(root + "/sandbox/webhook", { method: "POST", body: "{}" }), f.runtime);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "stripe_invalid_signature", request_id: null });
  expect(f.transport).not.toHaveBeenCalled();
});
it("reports absent or malformed configuration without exposing credentials", async () => {
  vi.stubGlobal("fetch", vi.fn());
  expect((await api("/sandbox/status")).status).toBe(503);
  const response = await api("/sandbox/status", { ...env, STRIPE_SANDBOX_CONNECTION: "malformed" } as Env);
  expect(await response.json()).toEqual({ error: "stripe_invalid_configuration", request_id: null });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects tampered, expired and wrong-mode signed messages before monetary source reads", async () => {
  const f = fixture(); const event = f.event("evt_Authenticity");
  for (const response of [await signed(event, f.config, f.runtime, Math.floor(Date.now() / 1000), JSON.stringify({ ...event, type: "refund.created" })),
    await signed(event, f.config, f.runtime, Math.floor(Date.now() / 1000) - 301),
    await signed({ ...event, livemode: true }, f.config, f.runtime),
    await signed({ ...event, account: "acct_Other" }, f.config, f.runtime)]) {
    expect(response.status).toBe(400);
  }
  expect(f.transport).not.toHaveBeenCalled();
});
it("admits a verified subscription charge once across distinct events", async () => {
  const f = fixture("live");
  const first = await signed(f.event("evt_Paid"), f.config, f.runtime);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ status: "admitted", created: 1, effect_ids: ["ch_ContractFixture"] });
  const retry = await signed(f.event("evt_SecondNotification", "invoice.payment_succeeded"), f.config, f.runtime);
  expect(await retry.json()).toMatchObject({ status: "duplicate", created: 0, duplicate: 1 });
  expect(await (await api("/live/import", f.runtime, { invoice_id: f.invoice.id })).json())
    .toMatchObject({ status: "duplicate", created: 0 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1255,
    difference_minor: 1255, evidence: "admitted_observations_and_stripe_verified_cash" });
  const evidence = await (await api("/live/effects?product_id=stripe-test", f.runtime)).json();
  expect(evidence).toMatchObject({ effects: [{ resource_id: "ch_ContractFixture", amount_minor: "1255",
    invoice_tax_minor: "255", cash_basis: "customer_cash_including_tax_before_fees", time_basis: "invoice_payment_paid_at" }] });
  expect(JSON.stringify(evidence)).not.toContain(f.config.api_key);
  expect(JSON.stringify(evidence)).not.toContain(f.config.webhook_secret);
});
it("keeps native sandbox activity out of live financial totals", async () => {
  const f = fixture();
  expect(await (await signed(f.event("evt_Sandbox"), f.config, f.runtime)).json()).toMatchObject({ created: 1 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 0 });
  expect(await (await api("/sandbox/effects?product_id=stripe-test", env as Env)).json()).toMatchObject({ effects: [{ amount_minor: "1255" }] });
  expect(await (await api("/live/effects?product_id=stripe-test", env as Env)).json()).toMatchObject({ effects: [] });
});
it("admits a successful partial refund before its receipt notification without duplication", async () => {
  const f = fixture("live"); f.refund("re_Partial", 255);
  const response = await signed(f.event("evt_RefundFirst", "refund.created", "re_Partial"), f.config, f.runtime);
  expect(await response.json()).toMatchObject({ status: "admitted", created: 2 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1000 });
  expect(await (await signed(f.event("evt_ReceiptLater"), f.config, f.runtime)).json())
    .toMatchObject({ status: "duplicate", duplicate: 2 });
  f.refund("re_Remainder", 1000);
  expect(await (await signed(f.event("evt_SecondRefund", "refund.updated", "re_Remainder"), f.config, f.runtime)).json())
    .toMatchObject({ created: 1, duplicate: 2 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 0 });
});
it("does not count a pending or failed refund as returned cash", async () => {
  const f = fixture("live"); const pending = f.refund("re_Pending", 255, "pending");
  f.refund("re_Failed", 10, "failed");
  expect(await (await api("/live/import", f.runtime, { invoice_id: f.invoice.id })).json())
    .toMatchObject({ created: 1, pending_refunds: ["re_Pending"] });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1255 });
  pending.status = "succeeded"; f.charge.amount_refunded = 255;
  expect(await (await api("/live/import", f.runtime, { invoice_id: f.invoice.id })).json()).toMatchObject({ created: 1 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1000 });
});
it("quarantines partly paid open invoices rather than claiming no cash", async () => {
  const f = fixture(); f.invoice.status = "open"; f.invoice.amount_paid = 300;
  const response = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ status: "quarantined", error: "stripe_non_cash_or_partial_invoice" });
  expect(await (await api("/sandbox/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({ effects: [] });
});
it("leaves failed payments and subscription creation out of receipts", async () => {
  const f = fixture(); f.invoice.status = "open"; f.invoice.amount_paid = 0;
  expect(await (await signed(f.event("evt_Failed", "invoice.payment_failed"), f.config, f.runtime)).json())
    .toMatchObject({ status: "no_cash", reason: "invoice_not_paid" });
  expect(await (await signed(f.event("evt_Created", "customer.subscription.created", "sub_ContractFixture"), f.config, f.runtime)).json())
    .toMatchObject({ status: "no_cash", reason: "event_not_cash_evidence" });
  expect(await (await api("/sandbox/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({ effects: [] });
});
it("retries an empty native allocation listing and exposes invoice-import history", async () => {
  const f = fixture(); f.payments.splice(0);
  const first = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
  expect(first.status).toBe(503);
  expect(await first.json()).toMatchObject({ status: "retryable", error: "stripe_invoice_payment_pending" });
  f.payments.push(f.paid);
  expect(await (await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id })).json()).toMatchObject({ status: "admitted" });
  expect(await (await api("/sandbox/events/" + f.invoice.id, env as Env)).json()).toMatchObject({
    attempts: [{ status: "admitted" }, { status: "retryable" }], latest: { status: "admitted" },
  });
});
it("retries empty allocations when resolving a refund's invoice", async () => {
  const f = fixture(); f.refund("re_Early", 20); f.payments.splice(0);
  const response = await signed(f.event("evt_EarlyRefund", "refund.created", "re_Early"), f.config, f.runtime);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: "stripe_invoice_payment_pending" });
});
it("withholds a previously admitted disputed receipt from the cash headline", async () => {
  const f = fixture("live");
  await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  f.charge.disputed = true;
  f.disputes.set("du_Lost", { id: "du_Lost", object: "dispute", livemode: true,
    charge: f.charge.id, status: "lost", amount: 1255, currency: "eur" });
  const response = await signed(f.event("evt_Disputed", "charge.dispute.closed", "du_Lost"), f.config, f.runtime);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "quarantined", invoice_id: f.invoice.id,
    error: "stripe_dispute_requires_reconciliation" });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: null,
    difference_minor: null, difference_micros: null, cash_status: "reconciliation_required",
    observed_subscription_subtotal_minor: "1255", stripe_reconciliation_breaks: [{ invoice_id: f.invoice.id }] });
  expect(await (await api("/live/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({
    effects: [{ kind: "subscription_receipt", amount_minor: "1255" }],
  });
});
it("detects missing refunds and restores comparability only after a complete native refresh", async () => {
  const f = fixture("live"); await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  f.charge.amount_refunded = 255;
  const gap = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(gap.status).toBe(503);
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: null });
  f.refund("re_Arrived", 255);
  expect(await (await api("/live/import", f.runtime, { invoice_id: f.invoice.id })).json()).toMatchObject({ created: 1 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1000 });
});
it("paginates source lines and rejects repeated native identities", async () => {
  const f = fixture(); f.lines.push({ ...f.line, id: "il_Second" }); f.paginateLines(1);
  expect(await (await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id })).json()).toMatchObject({ created: 1 });
  expect(f.calls.some(u => u.searchParams.get("starting_after") === f.line.id)).toBe(true);
  f.lines[1].id = f.line.id;
  expect((await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id })).status).toBe(503);
});
it("requires native account, currency, product and captured-cash equality", async () => {
  const f = fixture();
  for (const [record, key, bad, expected] of [
    [f.nativeAccount, "id", "acct_Other", "stripe_account_mismatch"],
    [f.nativePrice, "product", "prod_Other", "stripe_price_contract_mismatch"],
    [f.charge, "captured", false, "stripe_charge_contract_mismatch"],
    [f.intent, "currency", "usd", "stripe_payment_not_captured"],
    [f.invoice, "amount_paid_off_stripe", 1255, "stripe_non_cash_or_partial_invoice"],
    [f.invoice, "starting_balance", -100, "stripe_non_cash_or_partial_invoice"],
  ] as const) {
    const before = record[key]; record[key] = bad;
    const response = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
    expect(await response.json()).toMatchObject({ error: expected }); record[key] = before;
  }
  expect(await (await api("/sandbox/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({ effects: [] });
});
it("never overwrites conflicting admitted cash and atomically preserves all earlier effects", async () => {
  const f = fixture("live"); f.refund("re_Original", 200);
  await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  f.refunds[0].amount = 100; f.charge.amount_refunded = 100;
  const result = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(result.status).toBe(422);
  expect(await result.json()).toMatchObject({ error: "stripe_conflicting_source_effect" });
  expect(await (await api("/live/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({ effects: [
    { amount_minor: "1255" }, { resource_id: "re_Original", amount_minor: "200" },
  ] });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: null });
});
it("keeps all effect records accessible beyond one thousand rows", async () => {
  const money = (env as Env).MONEY;
  await runInDurableObject(money.get(money.idFromName("private-operator")), async (_instance, state) => {
    state.storage.sql.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1001)
      INSERT INTO stripe_effects SELECT 'sandbox','acct_Fixture','ch_'||i,'stripe-test','in_'||i,
        'subscription_receipt','1','EUR','2026-10-07T12:00:00.000Z',json_object('resource_id','ch_'||i),
        '2026-10-07T13:00:00.000Z' FROM n`);
  });
  const first = await api("/sandbox/effects?product_id=stripe-test&limit=1000");
  expect(first.status).toBe(200);
  const a = await first.json() as { effects: { resource_id: string }[]; has_more: boolean; next_cursor: string };
  expect(a.effects).toHaveLength(1000); expect(a.has_more).toBe(true);
  const secondPage = await api("/sandbox/effects?product_id=stripe-test&limit=1000&after=" + a.next_cursor);
  const b = await secondPage.json() as { effects: { resource_id: string }[]; has_more: boolean };
  expect(b.effects).toHaveLength(1); expect(b.has_more).toBe(false);
  expect(new Set([...a.effects, ...b.effects].map(r => r.resource_id)).size).toBe(1001);
});
it("does not send operator input or upstream redirects to another host", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302,
    headers: { Location: "https://example.invalid/", "request-id": "unsafe header" } })));
  const result = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
  expect(result.status).toBe(503);
  expect(JSON.stringify(await result.json())).not.toContain("unsafe header");
  expect(fetch).toHaveBeenCalledTimes(1);
  const reader = new StripeReader(f.config);
  await expect(reader.get("https://example.invalid")).rejects.toThrow("stripe_invalid_api_path");
});
it("rejects malformed imports and pagination before source calls", async () => {
  const f = fixture();
  for (const path of ["/sandbox/effects?product_id=stripe-test&limit=1001",
    "/sandbox/effects?product_id=stripe-test&after=-1", "/sandbox/effects?product_id=stripe-test&limit=1&limit=2"]) {
    expect((await api(path, f.runtime)).status).toBe(400);
  }
  expect((await api("/sandbox/import", f.runtime, { invoice_id: "in_Fixture", extra: 1 })).status).toBe(400);
  expect((await api("/sandbox/import", f.runtime)).status).toBe(405);
  expect(f.transport).not.toHaveBeenCalled();
});

it("counts a renewal as a new underlying charge, not another notification of the first payment", async () => {
  const f = fixture("live");
  await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  f.invoice.id = "in_Renewal"; f.paid.invoice = f.invoice.id; f.paid.id = "inpay_Renewal";
  f.intent.id = "pi_Renewal"; f.intent.latest_charge = "ch_Renewal";
  f.paid.payment = { type: "payment_intent", payment_intent: f.intent.id };
  f.paid.status_transitions = { paid_at: second + 30 * 86400 };
  f.charge.id = "ch_Renewal"; f.charge.payment_intent = f.intent.id;
  f.line.id = "il_Renewal"; f.line.period = { start: second + 30 * 86400, end: second + 60 * 86400 };
  expect(await (await signed(f.event("evt_Renewal"), f.config, f.runtime)).json()).toMatchObject({ created: 1 });
  expect(await (await signed(f.event("evt_RenewalRetry"), f.config, f.runtime)).json()).toMatchObject({ duplicate: 1 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 2510 });
});
it("waits for one source refresh to finish before allowing the next import", async () => {
  const f = fixture();
  let entered = false, released = false;
  const original = f.transport;
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith("/account") && !entered) {
      entered = true;
      const deadline = Date.now() + 2000;
      // Keep timer/stream promises in the acquiring Durable Object's I/O context.
      while (!released) {
        if (Date.now() >= deadline) throw new Error("fixture was not released");
        await new Promise<void>(resolve => setTimeout(resolve, 1));
      }
    }
    return original(url, init);
  }));
  const first = api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
  let completed: Response;
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    const concurrent = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
    expect(concurrent.status).toBe(503);
    expect(await concurrent.json()).toMatchObject({ error: "stripe_import_busy" });
  } finally {
    released = true;
    completed = await first;
  }
  expect(await completed.json()).toMatchObject({ created: 1 });
  expect(await (await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id })).json()).toMatchObject({ duplicate: 1 });
});
it("does not trust posted event identities when Stripe returns different native evidence", async () => {
  const f = fixture(); const posted = f.event("evt_Mismatched");
  f.events.set("evt_Mismatched", { ...posted, type: "invoice.payment_failed" });
  const response = await signed(posted, f.config, f.runtime);
  expect(await response.json()).toMatchObject({ status: "quarantined", error: "stripe_event_identity_mismatch" });
  expect(await (await api("/sandbox/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({ effects: [] });
});
it("rejects pagination cycles, empty continuation pages and unbounded payloads", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ object: "list", has_more: true, data: [] })));
  await expect(new StripeReader(f.config).list("/refunds")).rejects.toThrow("stripe_incomplete_page");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ object: "list", has_more: true, data: [{ id: "re_Duplicate" }] })));
  await expect(new StripeReader(f.config).list("/refunds")).rejects.toThrow("stripe_repeated_source_identity");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Length": "2000001" } })));
  await expect(new StripeReader(f.config).get("/account")).rejects.toThrow("stripe_invalid_source");
});

async function periodReport(runtime: Env, from = "2026-10-05", to = "2026-10-11", currency = "EUR") {
  return worker.fetch(new Request("https://adslop.test/v1/economics/period?product_id=stripe-test&currency=" +
    currency + "&from=" + from + "&to=" + to + "&time_zone=Europe%2FHelsinki", { headers: operator }), runtime);
}
it("compares native live Stripe cash and advertising in the same dated read snapshot", async () => {
  const sandbox = fixture();
  await api("/sandbox/import", sandbox.runtime, { invoice_id: sandbox.invoice.id });
  const f = fixture("live"); f.refund("re_Dated", 255);
  await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  const money = f.runtime.MONEY;
  await runInDurableObject(money.get(money.idFromName("private-operator")), async (_instance, state) => {
    state.storage.sql.exec("INSERT INTO google_cost_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "1234567890", "123", "2026-10-07", 1, "stripe-test", "EUR", "Europe/Helsinki", "2000001",
      "2026-10-08T12:00:00.000Z");
  });
  const result = await periodReport(f.runtime);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    money_in: { observed_receipts_minor: "1255", observed_refunds_minor: "255", observed_net_receipts_minor: "1000",
      observations: [
        { source: "stripe", event_id: "ch_ContractFixture", invoice_tax_minor: "255", time_basis: "invoice_payment_paid_at" },
        { source: "stripe", event_id: "re_Dated", refund_tax_minor: null, time_basis: "successful_refund_created_at" },
      ] }, money_out: { observed_spend_micros: "2000001" }, observed_difference_micros: "7999999",
    coverage: { complete: false, verified_zero: false },
  });
  expect(await (await periodReport(f.runtime, "2026-10-07", "2026-10-07")).json()).toMatchObject({
    money_in: { observed_receipts_minor: "1255", observed_refunds_minor: "0" },
  });
  expect(await (await periodReport(f.runtime, "2026-10-08", "2026-10-08")).json()).toMatchObject({
    money_in: { observed_receipts_minor: "0", observed_refunds_minor: "255", observed_net_receipts_minor: "-255" },
  });
  expect(await (await periodReport(f.runtime, "2026-10-05", "2026-10-11", "USD")).json()).toMatchObject({
    money_in: { status: "no_observations" }, observed_difference_micros: null,
  });
});
it("retains unresolved Stripe source breaks in dated reports rather than displaying a cash difference", async () => {
  const f = fixture("live");
  await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  f.charge.disputed = true;
  await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  const result = await periodReport(f.runtime);
  expect(await result.json()).toMatchObject({
    money_in: { status: "reconciliation_required", observed_net_receipts_minor: "1255",
      stripe_reconciliation_breaks: [{ invoice_id: f.invoice.id, error: "stripe_dispute_requires_reconciliation" }] },
    observed_difference_micros: null,
    coverage: { reasons: expect.arrayContaining(["stripe_cash_reconciliation_required"]) },
  });
});

it("does not display newly quarantined partial customer cash as a verified zero", async () => {
  const f = fixture("live"); f.invoice.status = "open"; f.invoice.amount_paid = 300;
  const rejected = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(rejected.status).toBe(422);
  expect(await (await economics(f.runtime)).json()).toMatchObject({
    subscription_revenue_minor: null, difference_minor: null, cash_status: "reconciliation_required",
  });
  expect(await (await periodReport(f.runtime)).json()).toMatchObject({
    money_in: { status: "reconciliation_required" }, observed_difference_micros: null,
    coverage: { complete: false, verified_zero: false },
  });
  f.transport.mockImplementationOnce(async () => Response.json({ error: "unavailable" }, { status: 503 }));
  expect((await api("/live/import", f.runtime, { invoice_id: f.invoice.id })).status).toBe(503);
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: null });
  f.invoice.status = "paid"; f.invoice.amount_paid = 1255;
  expect(await (await api("/live/import", f.runtime, { invoice_id: f.invoice.id })).json()).toMatchObject({ created: 1 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1255 });
});
it("does not mistake special Stripe currency wire units for ledger minor units", async () => {
  const f = fixture();
  for (const currency of ["isk", "ugx"]) {
    f.invoice.currency = currency;
    const response = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "stripe_currency_units_unsupported", status: "quarantined" });
  }
  expect(await (await api("/sandbox/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({ effects: [] });
});

it("binds fresh signed invoice events to admitted cash even if native account or event reads fail", async () => {
  const f = fixture("live");
  await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  for (const stage of ["account", "events"]) {
    if (stage === "events") {
      f.transport.mockImplementationOnce(async () => Response.json(f.nativeAccount));
    }
    f.transport.mockImplementationOnce(async () => Response.json({ error: "temporarily_unavailable" }, { status: 503 }));
    const retry = await signed(f.event("evt_Fresh" + stage), f.config, f.runtime);
    expect(retry.status).toBe(503);
    expect(await retry.json()).toMatchObject({ status: "retryable", invoice_id: f.invoice.id });
    expect(await (await economics(f.runtime)).json()).toMatchObject({
      subscription_revenue_minor: null, difference_micros: null, cash_status: "reconciliation_required",
    });
    expect(await (await periodReport(f.runtime)).json()).toMatchObject({
      money_in: { status: "reconciliation_required" }, observed_difference_micros: null,
    });
    await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
    expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1255 });
  }
});

it("admits an exactly mapped merchant-defined Stripe Product ID", async () => {
  const f = fixture();
  const custom = "contract_basic";
  const configuration = JSON.parse(f.runtime.STRIPE_SANDBOX_CONNECTION!);
  configuration.prices[price].stripe_product_id = custom;
  f.runtime.STRIPE_SANDBOX_CONNECTION = JSON.stringify(configuration);
  f.nativePrice.product = custom;
  f.line.pricing = { type: "price_details", price_details: { price, product: custom } };
  const response = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "admitted", created: 1 });
  expect(await (await api("/sandbox/effects?product_id=stripe-test", f.runtime)).json())
    .toMatchObject({ effects: [{ service_periods: [{ stripe_product_id: custom }] }] });
  f.nativePrice.product = "contract_other";
  const mismatch = await api("/sandbox/import", f.runtime, { invoice_id: f.invoice.id });
  expect(mismatch.status).toBe(422);
  expect(await mismatch.json()).toMatchObject({ error: "stripe_price_contract_mismatch" });
});
it("bounds custom Product IDs without relaxing other Stripe resource identities", () => {
  expect(stripeProductId("prod_ContractFixture")).toBe("prod_ContractFixture");
  expect(stripeProductId("contract_basic")).toBe("contract_basic");
  for (const invalid of ["", ".", "..", "../product", "product?other=1", "product\n", "x".repeat(129), null, {}]) {
    expect(() => stripeProductId(invalid)).toThrow("stripe_invalid_product_identity");
  }
  const f = fixture();
  const value = JSON.parse(f.runtime.STRIPE_SANDBOX_CONNECTION!);
  value.account_id = "merchant_account";
  expect(() => stripeConnection({ STRIPE_SANDBOX_CONNECTION: JSON.stringify(value) }, "sandbox"))
    .toThrow("stripe_invalid_configuration");
});

it.each(["account", "events"])("preserves known pending-refund identity when native %s reads fail", async (stage) => {
  const f = fixture("live");
  const refund = f.refund("re_KnownPending", 255, "pending");
  const initial = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(await initial.json()).toMatchObject({ created: 1, pending_refunds: ["re_KnownPending"] });
  refund.status = "succeeded";
  f.charge.amount_refunded = 255;
  if (stage === "events") f.transport.mockImplementationOnce(async () => Response.json(f.nativeAccount));
  f.transport.mockImplementationOnce(async () => Response.json({ error: "unavailable" }, { status: 503 }));
  const changed = await signed(f.event("evt_ResolvedRefund" + stage, "refund.updated", "re_KnownPending"), f.config, f.runtime);
  expect(changed.status).toBe(503);
  expect(await changed.json()).toMatchObject({ status: "retryable", invoice_id: f.invoice.id });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: null,
    difference_minor: null, difference_micros: null, cash_status: "reconciliation_required" });
  expect(await (await periodReport(f.runtime)).json()).toMatchObject({
    money_in: { status: "reconciliation_required" }, observed_difference_micros: null });
  const recovered = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(await recovered.json()).toMatchObject({ created: 1, duplicate: 1 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1000 });
  const replay = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(await replay.json()).toMatchObject({ created: 0, duplicate: 2 });
});

it.each(["account", "events"])("retains an unpaid invoice's product scope across later %s outages", async (stage) => {
  const f = fixture("live");
  f.invoice.status = "open"; f.invoice.amount_paid = 0;
  const initial = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(await initial.json()).toMatchObject({ status: "no_cash", reason: "invoice_not_paid",
    product_id: "stripe-test", currency: "EUR", created: 0 });
  expect(await (await api("/live/events/" + f.invoice.id, f.runtime)).json()).toMatchObject({
    latest: { status: "no_cash", product_id: "stripe-test", currency: "EUR" },
  });
  f.invoice.status = "paid"; f.invoice.amount_paid = 1255;
  if (stage === "events") f.transport.mockImplementationOnce(async () => Response.json(f.nativeAccount));
  f.transport.mockImplementationOnce(async () => Response.json({ error: "unavailable" }, { status: 503 }));
  const paid = await signed(f.event("evt_FirstPayment" + stage), f.config, f.runtime);
  expect(paid.status).toBe(503);
  expect(await paid.json()).toMatchObject({ status: "retryable", invoice_id: f.invoice.id });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: null,
    difference_minor: null, difference_micros: null, cash_status: "reconciliation_required" });
  expect(await (await periodReport(f.runtime)).json()).toMatchObject({
    money_in: { status: "reconciliation_required" }, observed_difference_micros: null });
  expect(await (await api("/live/effects?product_id=stripe-test", f.runtime)).json()).toMatchObject({ effects: [] });
  const recovered = await api("/live/import", f.runtime, { invoice_id: f.invoice.id });
  expect(await recovered.json()).toMatchObject({ status: "admitted", created: 1, duplicate: 0 });
  expect(await (await economics(f.runtime)).json()).toMatchObject({ subscription_revenue_minor: 1255 });
  expect(await (await periodReport(f.runtime)).json()).toMatchObject({
    money_in: { status: "observed_incomplete", observed_receipts_minor: "1255" } });
  const replay = await signed(f.event("evt_FirstPaymentReplay" + stage), f.config, f.runtime);
  expect(await replay.json()).toMatchObject({ status: "duplicate", created: 0, duplicate: 1 });
});


it.each(["live", "sandbox"] as const)("accepts separate Worker secrets for %s without exposing credentials", async mode => {
  const f = fixture(mode);
  const prefix = mode === "live" ? "STRIPE_LIVE" : "STRIPE_SANDBOX";
  const runtime: Env = { ...f.runtime,
    [prefix + "_CONNECTION"]: JSON.stringify({ account_id: account, prices: f.config.prices }),
    [prefix + "_API_KEY"]: f.config.api_key,
    [prefix + "_WEBHOOK_SECRET"]: f.config.webhook_secret };
  const status = await api("/" + mode + "/status", runtime);
  expect(status.status).toBe(200);
  const body = await status.json();
  expect(body).toMatchObject({ status: "connected", mode, account_id: account });
  expect(JSON.stringify(body)).not.toContain(f.config.api_key);
  expect(JSON.stringify(body)).not.toContain(f.config.webhook_secret);
  const admitted = await signed(f.event("evt_Separate"), f.config, runtime);
  expect(await admitted.json()).toMatchObject({ created: 1, status: "admitted" });
  const repeated = await api("/" + mode + "/import", runtime, { invoice_id: f.invoice.id });
  expect(await repeated.json()).toMatchObject({ created: 0, duplicate: 1 });
  expect(await (await economics(runtime)).json()).toMatchObject({ subscription_revenue_minor: mode === "live" ? 1255 : 0 });
  const unsigned = await worker.fetch(new Request(root + "/" + mode + "/webhook", { method: "POST", body: "{}" }), runtime);
  expect(unsigned.status).toBe(400);
});
it("rejects ambiguous or incomplete separate credentials before source reads", async () => {
  const f = fixture();
  const metadata = { account_id: account, prices: f.config.prices };
  const separate: Env = { ...f.runtime, STRIPE_SANDBOX_CONNECTION: JSON.stringify(metadata),
    STRIPE_SANDBOX_API_KEY: f.config.api_key, STRIPE_SANDBOX_WEBHOOK_SECRET: f.config.webhook_secret };
  const invalid: Partial<Env>[] = [
    { STRIPE_SANDBOX_API_KEY: undefined }, { STRIPE_SANDBOX_WEBHOOK_SECRET: undefined },
    { STRIPE_SANDBOX_API_KEY: "" }, { STRIPE_SANDBOX_API_KEY: "rk_live_wrongmode" },
    { STRIPE_SANDBOX_WEBHOOK_SECRET: "" }, { STRIPE_SANDBOX_WEBHOOK_SECRET: "invalid" },
    { STRIPE_SANDBOX_API_KEY: undefined, STRIPE_LIVE_API_KEY: f.config.api_key },
    { STRIPE_SANDBOX_WEBHOOK_SECRET: undefined, STRIPE_LIVE_WEBHOOK_SECRET: f.config.webhook_secret },
    { STRIPE_SANDBOX_CONNECTION: JSON.stringify({ ...metadata, api_key: f.config.api_key }) },
    { STRIPE_SANDBOX_CONNECTION: JSON.stringify({ ...metadata, webhook_secret: f.config.webhook_secret }) },
    { STRIPE_SANDBOX_CONNECTION: JSON.stringify({ ...metadata, api_key: null }) },
  ];
  for (const patch of invalid) {
    const runtime = { ...separate, ...patch };
    const response = await api("/sandbox/status", runtime);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "stripe_invalid_configuration", request_id: null });
    const webhook = await signed(f.event("evt_InvalidSeparate"), f.config, runtime);
    expect(webhook.status).toBe(503);
  }
  expect((await api("/live/status", separate)).status).toBe(503);
  expect(f.transport).not.toHaveBeenCalled();
});
it("supports moving one credential at a time without changing the legacy connection", () => {
  const f = fixture();
  const full = JSON.parse(f.runtime.STRIPE_SANDBOX_CONNECTION!);
  const { api_key, ...keyless } = full;
  const { webhook_secret, ...signingless } = full;
  expect(stripeConnection({ STRIPE_SANDBOX_CONNECTION: JSON.stringify(keyless), STRIPE_SANDBOX_API_KEY: api_key }, "sandbox"))
    .toEqual(f.config);
  expect(stripeConnection({ STRIPE_SANDBOX_CONNECTION: JSON.stringify(signingless), STRIPE_SANDBOX_WEBHOOK_SECRET: webhook_secret }, "sandbox"))
    .toEqual(f.config);
  expect(stripeConnection(f.runtime, "sandbox")).toEqual(f.config);
});
