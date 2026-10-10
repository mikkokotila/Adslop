/**
 * Append-only, source-period Google advertising cost journal.
 * Only latest campaign/day observations affect money-out; prior revisions stay queryable.
 */

export interface GoogleSpendReport {
  customer_id: string;
  currency: string;
  time_zone: string;
  period: { from: string; to: string; basis: string };
  authority: string;
  account_spend_micros: string;
  view: string;
  breakdown_spend_micros: string;
  undistributed_micros: string;
  complete: boolean;
  rows: Record<string, unknown>[];
}

interface Revision {
  [key: string]: string | number;
  customer_id: string;
  campaign_id: string;
  local_date: string;
  revision: number;
  product_id: string;
  currency: string;
  time_zone: string;
  cost_micros: string;
  observed_at: string;
}

export class GoogleJournalError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GoogleJournalError('google_ads_invalid_report', 502);
  }
  return value as Record<string, unknown>;
}

function positiveMicros(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new GoogleJournalError('google_ads_invalid_micros', 502);
  }
  return BigInt(value);
}

function campaignDate(row: Record<string, unknown>): string {
  const date = record(row.segments).date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new GoogleJournalError('google_ads_invalid_source_date', 502);
  }
  const parsed = new Date(date + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new GoogleJournalError('google_ads_invalid_source_date', 502);
  }
  return date;
}

function campaignId(row: Record<string, unknown>): string {
  const id = record(row.campaign).id;
  if (typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) {
    throw new GoogleJournalError('google_ads_invalid_campaign_id', 502);
  }
  return id;
}

function reportEntries(report: GoogleSpendReport): {
  entries: Map<string, { campaign: string; date: string; micros: bigint }>;
  sourceTotal: bigint;
} {
  if (!report.complete || report.view !== 'campaign' ||
      report.authority !== 'google_ads_customer_metrics_cost_micros' ||
      report.period.basis !== 'google_ads_customer_local_date' ||
      !/^\d{10}$/.test(report.customer_id) ||
      !/^[A-Z]{3}$/.test(report.currency) || !report.time_zone ||
      !Array.isArray(report.rows)) {
    throw new GoogleJournalError('google_ads_incomplete_source_report', 502);
  }
  const accountTotal = positiveMicros(report.account_spend_micros);
  const declaredTotal = positiveMicros(report.breakdown_spend_micros);
  const entries = new Map<string, { campaign: string; date: string; micros: bigint }>();
  let total = 0n;
  for (const row of report.rows) {
    const campaign = campaignId(row);
    const date = campaignDate(row);
    if (date < report.period.from || date > report.period.to) {
      throw new GoogleJournalError('google_ads_source_period_mismatch', 502);
    }
    const micros = positiveMicros(record(row.metrics).costMicros);
    const key = campaign + ':' + date;
    if (entries.has(key)) throw new GoogleJournalError('google_ads_duplicate_cost_row', 502);
    entries.set(key, { campaign, date, micros });
    total += micros;
  }
  if (declaredTotal !== total || accountTotal !== total) {
    throw new GoogleJournalError('google_ads_account_campaign_cost_break', 409);
  }
  return { entries, sourceTotal: accountTotal };
}

/** Strictly separated from business receipt and refund observations. */
export class GoogleCostJournal {
  constructor(private readonly sql: SqlStorage) {}

  create(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS google_cost_revisions (
        customer_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        revision INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        cost_micros TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY(customer_id, campaign_id, local_date, revision)
      )
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS google_cost_product
      ON google_cost_revisions(product_id, currency)
    `);
  }

  hasImportedSpend(product: string, currency: string): boolean {
    return this.sql.exec<{ present: number }>(
      'SELECT 1 AS present FROM google_cost_revisions ' +
      'WHERE product_id=? AND currency=? LIMIT 1', product, currency,
    ).toArray().length > 0;
  }

  latest(product: string, currency: string): Revision[] {
    return this.sql.exec<Revision>(
      'SELECT r.* FROM google_cost_revisions r WHERE r.product_id=? AND r.currency=? ' +
      'AND r.revision=(SELECT MAX(h.revision) FROM google_cost_revisions h ' +
      'WHERE h.customer_id=r.customer_id AND h.campaign_id=r.campaign_id ' +
      'AND h.local_date=r.local_date)',
      product, currency,
    ).toArray();
  }

  history(customer: string): Revision[] {
    return this.sql.exec<Revision>(
      'SELECT * FROM google_cost_revisions WHERE customer_id=? ' +
      'ORDER BY campaign_id, local_date, revision', customer,
    ).toArray();
  }

  apply(product: string, report: GoogleSpendReport, requested: string[]): object {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(product) || product === '.' || product === '..' ||
        !Array.isArray(requested) || !requested.length ||
        requested.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) ||
        new Set(requested).size !== requested.length) {
      throw new GoogleJournalError('google_ads_invalid_product_campaign_mapping', 400);
    }
    const { entries, sourceTotal } = reportEntries(report);
    const overlap = this.sql.exec<{ present: number }>(
      "SELECT 1 AS present FROM observations WHERE product_id=? AND currency=? " +
      "AND kind IN ('ad_spend', 'ad_credit') AND channel='google' LIMIT 1", product, report.currency,
    ).toArray()[0];
    if (overlap) throw new GoogleJournalError('google_ads_manual_spend_overlap', 409);
    const selected = new Set(requested);
    let inserted = 0, corrected = 0, duplicates = 0;
    let selectedMicros = 0n;
    const observedAt = new Date().toISOString();
    for (const item of entries.values()) {
      if (!selected.has(item.campaign)) continue;
      selectedMicros += item.micros;
      const original = this.sql.exec<Revision>(
        'SELECT * FROM google_cost_revisions WHERE customer_id=? ' +
        'AND campaign_id=? AND local_date=? ORDER BY revision DESC LIMIT 1',
        report.customer_id, item.campaign, item.date,
      ).toArray()[0];
      if (original && (original.product_id !== product || original.currency !== report.currency ||
                       original.time_zone !== report.time_zone)) {
        throw new GoogleJournalError('google_ads_source_identity_conflict', 409);
      }
      if (original?.cost_micros === item.micros.toString()) {
        duplicates++;
        continue;
      }
      const revision = (original?.revision ?? 0) + 1;
      this.sql.exec(
        'INSERT INTO google_cost_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        report.customer_id, item.campaign, item.date, revision, product,
        report.currency, report.time_zone, item.micros.toString(), observedAt,
      );
      if (original) corrected++;
      else inserted++;
    }

    // A formerly observed campaign/day must not vanish from a revised report
    // without an explicit source record; omission is not proof of zero spend.
    const history = this.history(report.customer_id);
    for (const previous of history) {
      if (selected.has(previous.campaign_id) &&
          previous.local_date >= report.period.from && previous.local_date <= report.period.to &&
          !entries.has(previous.campaign_id + ':' + previous.local_date)) {
        throw new GoogleJournalError('google_ads_missing_prior_source_row', 409);
      }
    }
    if (inserted + corrected + duplicates === 0) {
      throw new GoogleJournalError('google_ads_no_selected_campaign_cost_rows', 409);
    }
    return {
      customer_id: report.customer_id, product_id: product,
      currency: report.currency, time_zone: report.time_zone,
      period: report.period, source_account_spend_micros: sourceTotal.toString(),
      selected_campaign_spend_micros: selectedMicros.toString(),
      campaigns: requested, created: inserted, corrected, duplicate: duplicates,
      status: corrected ? 'corrected' : inserted ? 'created' : 'duplicate',
    };
  }
}
