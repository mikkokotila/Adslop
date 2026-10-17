/** PAUSED-only native actions; durable checkpoints distinguish intent from observation. */
import { GoogleAdsClient, GoogleAdsError } from "./google";
import { metaGraph, MetaCampaignError } from "./meta-campaigns";
import type { Env } from "./index";

export type CampaignPauseProvider = "google-ads" | "meta";
type Obj = Record<string, unknown>;
type Native = { account_id: string; campaign_id: string; entity_type: "campaign"; status: string;
  observed_at: string; objective?: string; buying_type?: string };
type Checkpoint = { phase: string; at: string } & Obj;
type Attempt = {
  operation_id: string; provider: CampaignPauseProvider; account_id: string;
  campaign_id: string; requested_at: string; status: string;
  checkpoints: Checkpoint[]; paid_delivery_authorized: false;
};
class PauseError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code); }
}
function safeRequestId(value: string | null): string | null {
  return value !== null && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PauseError("campaign_pause_invalid_native_response");
  }
  return value as Obj;
}
function identity(provider: CampaignPauseProvider, account: string, campaign: string): void {
  if (!(provider === "google-ads" ? /^[0-9]{10}$/.test(account) : /^[1-9][0-9]{0,31}$/.test(account)) ||
      !/^[1-9][0-9]{0,31}$/.test(campaign)) {
    throw new PauseError("campaign_pause_invalid_identity", 400);
  }
}
function observed(account: string, campaign: string, status: unknown, allowed: string[]): Native {
  if (typeof status !== "string" || !allowed.includes(status)) {
    throw new PauseError("campaign_pause_unsupported_native_status", 409);
  }
  return { account_id: account, campaign_id: campaign, entity_type: "campaign", status, observed_at: new Date().toISOString() };
}
async function nativeAdapter(provider: CampaignPauseProvider, account: string, campaign: string, env: Env) {
  if (provider === "google-ads") {
    const client = await GoogleAdsClient.connect(env);
    const source = await client.account(account);
    if (source.id !== account || source.manager) throw new PauseError("campaign_pause_account_mismatch", 409);
    const resource = "customers/" + account + "/campaigns/" + campaign;
    return {
      requestId: () => safeRequestId(client.responseRequestId),
      read: async (): Promise<Native> => {
        const rows = await client.search(account,
          "SELECT campaign.id, campaign.resource_name, campaign.status FROM campaign WHERE campaign.id = " + campaign,
          source.login_customer_id);
        if (rows.length !== 1) throw new PauseError("campaign_pause_campaign_not_found", 404);
        const native = object(rows[0].campaign);
        if (native.id !== campaign || native.resourceName !== resource) {
          throw new PauseError("campaign_pause_account_mismatch", 409);
        }
        return observed(account, campaign, native.status, ["ENABLED", "PAUSED"]);
      },
      write: async () => {
        const reply = object(await client.request("/customers/" + account + "/googleAds:mutate", {
          partialFailure: false, mutateOperations: [{ campaignOperation: {
            update: { resourceName: resource, status: "PAUSED" }, updateMask: "status",
          } }],
        }, source.login_customer_id));
        if (reply.partialFailureError !== undefined || !Array.isArray(reply.mutateOperationResponses) ||
            reply.mutateOperationResponses.length !== 1 ||
            object(object(reply.mutateOperationResponses[0]).campaignResult).resourceName !== resource) {
          throw new PauseError("campaign_pause_invalid_acknowledgment");
        }
      },
    };
  }
  const token = env.META_ACCESS_TOKEN;
  if (!token) throw new PauseError("meta_not_configured", 503);
  return {
    requestId: (): string | null => null,
    read: async (): Promise<Native> => {
      const native = await metaGraph("GET", campaign, token, { fields: "id,account_id,status,objective,buying_type" });
      if (native.id !== campaign || native.account_id !== account) {
        throw new PauseError("campaign_pause_account_mismatch", 409);
      }
      // Child ads/ad sets also expose id/account_id/status. Require campaign-only fields.
      if (typeof native.objective !== "string" || !/^[A-Z_]{2,64}$/.test(native.objective) ||
          typeof native.buying_type !== "string" || !/^[A-Z_]{2,64}$/.test(native.buying_type)) {
        throw new PauseError("campaign_pause_campaign_identity_unverified", 409);
      }
      return { ...observed(account, campaign, native.status, ["ACTIVE", "PAUSED"]),
        objective: native.objective, buying_type: native.buying_type };
    },
    write: async () => {
      const reply = await metaGraph("POST", campaign, token, { status: "PAUSED" });
      if (reply.success !== true) throw new PauseError("campaign_pause_invalid_acknowledgment");
    },
  };
}
function failure(error: unknown): { code: string; status: number; source: Obj; rejected: boolean } {
  if (error instanceof GoogleAdsError) return {
    code: error.code, status: error.status,
    source: { request_id: safeRequestId(error.requestId), native_http_status: error.responseStatus },
    rejected: error.responseStatus !== null && error.responseStatus >= 400 && error.responseStatus < 500,
  };
  if (error instanceof MetaCampaignError) return {
    code: error.code, status: error.status, source: error.source,
    rejected: !error.uncertain && ["meta_access_denied", "meta_upstream_rejected", "meta_rate_limited"].includes(error.code),
  };
  if (error instanceof PauseError) return { code: error.code, status: error.status, source: {}, rejected: false };
  return { code: "campaign_pause_execution_interrupted", status: 502, source: {}, rejected: false };
}

/** Each POST is a new explicit operator attempt. This function never retries a native write. */
export async function pauseCampaign(
  provider: CampaignPauseProvider, accountId: string, campaignId: string, env: Env, sql: SqlStorage,
): Promise<{ status: number; body: Record<string, unknown> }> {
  identity(provider, accountId, campaignId);
  const attempt: Attempt = {
    operation_id: crypto.randomUUID(), provider, account_id: accountId, campaign_id: campaignId,
    requested_at: new Date().toISOString(), status: "incomplete", checkpoints: [], paid_delivery_authorized: false,
  };
  attempt.checkpoints.push({ phase: "requested", at: attempt.requested_at });
  const id = sql.exec<{ id: number }>(
    "INSERT INTO campaign_pause_attempts (provider, account_id, campaign_id, operation_id, requested_at, body) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    provider, accountId, campaignId, attempt.operation_id, attempt.requested_at, JSON.stringify(attempt),
  ).one().id;
  const remember = (phase: string, details: Obj = {}) => {
    attempt.checkpoints.push({ phase, at: new Date().toISOString(), ...details });
    sql.exec("UPDATE campaign_pause_attempts SET body=? WHERE id=?", JSON.stringify(attempt), id);
  };
  let writeRequested = false, acknowledged = false;
  try {
    const native = await nativeAdapter(provider, accountId, campaignId, env);
    const before = await native.read();
    remember("native_observed_before", { native: before, request_id: native.requestId() });
    if (before.status !== "PAUSED") {
      writeRequested = true;
      attempt.status = "write_unverified";
      remember("write_requested", { requested_status: "PAUSED" });
      await native.write();
      acknowledged = true;
      remember("native_acknowledged", { request_id: native.requestId() });
    }
    const after = await native.read();
    remember("native_observed_after", { native: after, request_id: native.requestId() });
    if (after.status !== "PAUSED") throw new PauseError("campaign_pause_readback_mismatch", 409);
    attempt.status = "verified_paused";
    remember("complete", { native_write_requested: writeRequested });
    return { status: 200, body: { ...attempt, native: after, native_write_requested: writeRequested } };
  } catch (error) {
    const detail = failure(error);
    attempt.status = !writeRequested ? "failed_before_write" : detail.rejected && !acknowledged
      ? "write_rejected" : "write_unverified";
    remember("failed", { error: detail.code, ...detail.source });
    return { status: detail.status, body: { ...attempt, error: detail.code, ...detail.source } };
  }
}

/** Last 100 attempts, including incomplete checkpoints; history never refreshes or replays native state. */
export function pauseHistory(
  provider: CampaignPauseProvider, accountId: string, campaignId: string, sql: SqlStorage,
): Record<string, unknown> {
  identity(provider, accountId, campaignId);
  const rows = sql.exec<{ body: string }>(
    "SELECT body FROM campaign_pause_attempts WHERE provider=? AND account_id=? AND campaign_id=? ORDER BY id DESC LIMIT 101",
    provider, accountId, campaignId,
  ).toArray();
  return { provider, account_id: accountId, campaign_id: campaignId, limit: 100, truncated: rows.length > 100,
    attempts: rows.slice(0, 100).map(row => JSON.parse(row.body)), native_state_refreshed: false,
    paid_delivery_authorized: false };
}
