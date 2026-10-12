/**
 * Source-period Meta Insights journal. Only the latest revision of each
 * campaign/day contributes to money-out; earlier observations remain auditable.
 */
import type { MetaSpendReport } from "./meta";

export interface MetaRevision {
  [key: string]: string | number;
  account_id: string;
  campaign_id: string;
  local_date: string;
  revision: number;
  product_id: string;
  currency: string;
  timezone_name: string;
  spend_minor: string;
  observed_at: string;
}

export class MetaJournalError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function minorAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new MetaJournalError("meta_invalid_source_amount", 502);
  }
  return BigInt(value);
}

function identity(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{1,32}$/.test(value)) {
    throw new MetaJournalError("meta_invalid_source_identity", 502);
  }
  return value;
}

export class MetaCostJournal {
  constructor(private readonly sql: SqlStorage) {}

  create(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta_cost_revisions (
        account_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        revision INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        timezone_name TEXT NOT NULL,
        spend_minor TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (account_id, campaign_id, local_date, revision)
      )
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS meta_cost_product
      ON meta_cost_revisions (product_id, currency)
    `);
  }

  hasImportedSpend(product: string, currency: string): boolean {
    return this.sql.exec<{ present: number }>(
      "SELECT 1 AS present FROM meta_cost_revisions " +
      "WHERE product_id=? AND currency=? LIMIT 1",
      product, currency
    ).toArray().length > 0;
  }

  latest(product: string, currency: string): MetaRevision[] {
    return this.sql.exec<MetaRevision>(
      "SELECT r.* FROM meta_cost_revisions r " +
      "WHERE r.product_id=? AND r.currency=? " +
      "AND r.revision=(SELECT MAX(h.revision) FROM meta_cost_revisions h " +
      "WHERE h.account_id=r.account_id AND h.campaign_id=r.campaign_id " +
      "AND h.local_date=r.local_date)",
      product, currency
    ).toArray();
  }

  history(account: string): MetaRevision[] {
    return this.sql.exec<MetaRevision>(
      "SELECT * FROM meta_cost_revisions WHERE account_id=? " +
      "ORDER BY campaign_id, local_date, revision", account
    ).toArray();
  }

  apply(product: string, report: MetaSpendReport, requested: string[]): object {
    if (typeof product !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(product) ||
        product === "." || product === ".." ||
        !Array.isArray(requested) || !requested.length ||
        requested.some((id) => typeof id !== "string" ||
          !/^[0-9]{1,32}$/.test(id)) ||
        new Set(requested).size !== requested.length) {
      throw new MetaJournalError("meta_invalid_product_campaign_mapping", 400);
    }
    if (!report || report.source !== "meta_insights" ||
        report.imported_to_ledger !== false ||
        report.reporting !== "platform_reported_not_billing_settlement" ||
        report.complete !== true || report.level !== "campaign" ||
        !/^[A-Z]{3}$/.test(report.account.currency) ||
        !report.account.timezone_name ||
        !Array.isArray(report.account_rows) ||
        !Array.isArray(report.rows)) {
      throw new MetaJournalError("meta_incomplete_source_report", 502);
    }
    const account = identity(report.account.account_id);
    const accountTotal = minorAmount(report.account_spend_minor);
    const sourceByDay = new Map<string, bigint>();
    for (const row of report.account_rows) {
      if (identity(row.entity_id) !== account ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.date_start) ||
          row.date_start !== row.date_stop ||
          row.date_start < report.since || row.date_start > report.until ||
          sourceByDay.has(row.date_start)) {
        throw new MetaJournalError("meta_invalid_account_day", 502);
      }
      sourceByDay.set(row.date_start, minorAmount(row.spend_minor));
    }
    const sourceSum = [...sourceByDay.values()].reduce((sum, n) => sum + n, 0n);
    if (sourceSum !== accountTotal) {
      throw new MetaJournalError("meta_account_daily_spend_break", 502);
    }
    const entries = new Map<string, { campaign: string; date: string; amount: bigint }>();
    const campaignsByDay = new Map<string, bigint>();
    let allCampaigns = 0n;
    for (const row of report.rows) {
      const campaign = identity(row.entity_id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date_start) ||
          row.date_start !== row.date_stop ||
          row.date_start < report.since || row.date_start > report.until) {
        throw new MetaJournalError("meta_source_period_mismatch", 502);
      }
      const key = campaign + ":" + row.date_start;
      if (entries.has(key)) throw new MetaJournalError("meta_duplicate_source_day", 502);
      const amount = minorAmount(row.spend_minor);
      entries.set(key, { campaign, date: row.date_start, amount });
      campaignsByDay.set(
        row.date_start, (campaignsByDay.get(row.date_start) ?? 0n) + amount
      );
      allCampaigns += amount;
    }
    const dates = new Set([...sourceByDay.keys(), ...campaignsByDay.keys()]);
    if (accountTotal !== allCampaigns ||
        [...dates].some((date) =>
          (sourceByDay.get(date) ?? 0n) !== (campaignsByDay.get(date) ?? 0n))) {
      throw new MetaJournalError("meta_account_campaign_spend_break", 409);
    }
    const existingManual = this.sql.exec<{ present: number }>(
      "SELECT 1 AS present FROM observations WHERE product_id=? AND currency=? " +
      "AND kind IN ('ad_spend', 'ad_credit') AND channel='meta' LIMIT 1",
      product, report.account.currency
    ).toArray()[0];
    if (existingManual) throw new MetaJournalError("meta_manual_spend_overlap", 409);

    const chosen = new Set(requested);
    const present = new Set<string>();
    let inserted = 0, corrected = 0, duplicate = 0, selectedMinor = 0n;
    const observedAt = new Date().toISOString();
    for (const row of entries.values()) {
      if (!chosen.has(row.campaign)) continue;
      present.add(row.campaign);
      selectedMinor += row.amount;
      const existing = this.sql.exec<MetaRevision>(
        "SELECT * FROM meta_cost_revisions WHERE account_id=? AND campaign_id=? " +
        "ORDER BY local_date DESC, revision DESC LIMIT 1",
        account, row.campaign
      ).toArray()[0];
      if (existing && (
        existing.product_id !== product ||
        existing.currency !== report.account.currency ||
        existing.timezone_name !== report.account.timezone_name
      )) {
        throw new MetaJournalError("meta_source_identity_conflict", 409);
      }
      const latest = this.sql.exec<MetaRevision>(
        "SELECT * FROM meta_cost_revisions WHERE account_id=? AND campaign_id=? " +
        "AND local_date=? ORDER BY revision DESC LIMIT 1",
        account, row.campaign, row.date
      ).toArray()[0];
      if (latest?.spend_minor === row.amount.toString()) {
        duplicate++;
        continue;
      }
      const revision = (latest?.revision ?? 0) + 1;
      this.sql.exec(
        "INSERT INTO meta_cost_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        account, row.campaign, row.date, revision, product, report.account.currency,
        report.account.timezone_name, row.amount.toString(), observedAt
      );
      if (latest) corrected++;
      else inserted++;
    }
    if ([...chosen].some((campaign) => !present.has(campaign))) {
      throw new MetaJournalError("meta_missing_selected_campaign", 409);
    }
    // A previously imported date cannot disappear without an explicit
    // source correction. Import failure rolls the entire SQL transaction back.
    for (const previous of this.history(account)) {
      if (chosen.has(previous.campaign_id) &&
          previous.local_date >= report.since && previous.local_date <= report.until &&
          !entries.has(previous.campaign_id + ":" + previous.local_date)) {
        throw new MetaJournalError("meta_missing_prior_source_day", 409);
      }
    }
    return {
      account_id: account, product_id: product,
      currency: report.account.currency, timezone_name: report.account.timezone_name,
      since: report.since, until: report.until,
      source_account_spend_minor: accountTotal.toString(),
      selected_campaign_spend_minor: selectedMinor.toString(),
      campaign_ids: requested,
      created: inserted, corrected, duplicate,
      status: corrected ? "corrected" : inserted ? "created" : "duplicate",
    };
  }
}
