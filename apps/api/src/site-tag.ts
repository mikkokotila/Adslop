/** The same browser tag for every product; start is controlled by the site's consent flow. */
import type { SiteConfiguration } from "./site-connection";

export function siteTag(config: SiteConfiguration, endpoint: string): string {
  return `(() => {
"use strict";
if (window.adslop) throw new Error("Adslop tag already loaded");
const endpoint = ${JSON.stringify(endpoint)}, origins = ${JSON.stringify(config.origins)};
const storageKey = "adslop:" + endpoint;
let active = false, reference = null, pending = null, generation = 0;
const valid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function fail(error) {
  window.dispatchEvent(new CustomEvent("adslop:error", { detail: { message: error.message } }));
  throw error;
}
async function start() {
  if (!origins.includes(location.origin)) throw new Error("Adslop origin not configured");
  if (active) return reference;
  if (pending) return pending;
  const epoch = ++generation;
  pending = (async () => {
    const url = new URL(location.href);
    const campaign = url.searchParams.get("adslop_campaign");
    const forwarded = url.searchParams.get("adslop_reference");
    if (url.searchParams.getAll("adslop_campaign").length > 1 || url.searchParams.getAll("adslop_reference").length > 1) throw new Error("Adslop repeated parameter");
    const saved = sessionStorage.getItem(storageKey);
    const previous = saved ? JSON.parse(saved) : null;
    const ref = forwarded || (previous && Date.parse(previous.expires_at) > Date.now() ? previous.reference : null);
    if (ref && !valid(ref)) throw new Error("Adslop invalid reference");
    const body = campaign ? { campaign } : ref ? { reference: ref } : {};
    const response = await fetch(endpoint, { method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const value = await response.json();
    if (!response.ok || !valid(value.reference) || !Number.isFinite(Date.parse(value.expires_at))) throw new Error("Adslop collection failed: " + (value.error || response.status));
    if (epoch !== generation) return null;
    sessionStorage.setItem(storageKey, JSON.stringify({ reference: value.reference, expires_at: value.expires_at }));
    reference = value.reference; active = true;
    if (forwarded || campaign) {
      url.searchParams.delete("adslop_reference"); url.searchParams.delete("adslop_campaign");
      history.replaceState(history.state, "", url.href);
    }
    window.dispatchEvent(new CustomEvent("adslop:ready", { detail: { reference } }));
    return reference;
  })().catch(fail).finally(() => { if (epoch === generation) pending = null; });
  return pending;
}
function decorate(href) {
  if (!active || !reference) return href;
  const url = new URL(href, location.href);
  if (origins.includes(url.origin)) url.searchParams.set("adslop_reference", reference);
  return url.href;
}
document.addEventListener("click", event => {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (anchor && active && !anchor.hasAttribute("download")) anchor.href = decorate(anchor.href);
}, true);
window.adslop = Object.freeze({ start, reference: () => active ? reference : null, decorate,
  stop: () => { generation++; active = false; reference = null; pending = null; sessionStorage.removeItem(storageKey); } });
})();`;
}
