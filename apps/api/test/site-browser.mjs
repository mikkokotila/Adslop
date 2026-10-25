/** Real Chromium/WebKit collection and cross-origin transport against an isolated local Worker. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, webkit } from '../../../docs-site/node_modules/playwright/index.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('one tag connects two differently configured sites through real browser CORS', { timeout: 120000 }, async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'adslop-site-browser-'));
  const portHolder = createServer();
  const api = await listen(portHolder);
  await new Promise(resolve => portHolder.close(resolve));
  let apiProcess, first, second;
  try {
    const config = { name: 'adslop-site-browser', main: path.resolve(directory, '../src/index.ts'), compatibility_date: '2026-10-09',
      vars: { API_TOKEN: 'isolated-browser-fixture' }, durable_objects: { bindings: [{ name: 'MONEY', class_name: 'MoneyLedger' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['MoneyLedger'] }] };
    const configPath = path.join(temporary, 'wrangler.json');
    await writeFile(configPath, JSON.stringify(config));
    apiProcess = spawn(process.execPath, [path.resolve(directory, '../node_modules/wrangler/bin/wrangler.js'), 'dev',
      '--config', configPath, '--local', '--port', new URL(api).port, '--persist-to', path.join(temporary, 'state')],
    { cwd: temporary, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    apiProcess.stdout.on('data', data => process.stdout.write(data));
    apiProcess.stderr.on('data', data => process.stderr.write(data));
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (apiProcess.exitCode !== null) throw new Error('Isolated Worker exited before readiness');
      try { const response = await fetch(api); ready = response.status === 401; }
      catch (error) { if (!(error instanceof TypeError)) throw error; }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'local Worker must start');
    const setup = async (product, origins) => {
      const response = await fetch(`${api}/v1/sites/${product}/sandbox`, { method: 'PUT', headers: {
        Authorization: 'Bearer isolated-browser-fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ origins,
        attribution_window_days: 7, max_visits_per_minute: 1000,
        campaigns: { search: { provider: 'google', account_id: '1234567890', campaign_id: '123' } } }) });
      assert.equal(response.status, 200); return response.json();
    };
    const count = async product => (await (await fetch(`${api}/v1/sites/${product}/sandbox`, {
      headers: { Authorization: 'Bearer isolated-browser-fixture' } })).json()).collected_visits;
    let secondOrigin;
    const serve = (request, response) => {
      const product = new URL(request.url, 'http://local').pathname.startsWith('/another') ? 'another' : 'store';
      const destination = request.headers.host === new URL(secondOrigin).host ? firstOrigin : secondOrigin;
      response.setHeader('Content-Type', 'text/html');
      const base = request.url.startsWith('/with-base') ? `<base href="${secondOrigin}/base/">` : '';
      response.end(`<html><head>${base}<script src="${api}/v1/sites/${product}/sandbox/tag.js"></script></head><body>
        <a id="next" href="${destination}/purchase">Continue</a><a id="outside" href="https://example.org/">Outside</a>
        <a id="fragment" href="#pricing">Pricing</a><div id="pricing">Pricing</div><a id="relative" href="?tab=details">Details</a>
        <a id="protocol-relative" href="${destination.replace('http:', '')}/purchase">Other origin</a>
        <a id="new-tab" href="/purchase" target="_blank" rel="noopener">New tab</a><a id="base-relative" href="purchase">Base relative</a></body></html>`);
    };
    first = createServer(serve); second = createServer(serve);
    const firstOrigin = await listen(first); secondOrigin = await listen(second);
    await setup('store', [firstOrigin, secondOrigin]);
    await setup('another', [secondOrigin]);
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(firstOrigin + '/?adslop_campaign=search&private_form=not-collected');
        const before = await count('store');
        assert.equal(await page.evaluate(() => window.adslop.reference()), null);
        await page.waitForTimeout(100);
        assert.equal(await count('store'), before, 'loading the script does not collect');
        const reference = await page.evaluate(() => window.adslop.start());
        assert.match(reference, /^[0-9a-f-]{36}$/);
        assert.equal(await page.evaluate(() => window.adslop.start()), reference);
        assert.equal(await count('store'), before + 1, 'start is idempotent');
        assert.equal(new URL(page.url()).searchParams.has('adslop_campaign'), false);
        assert.equal(await page.evaluate(() => window.adslop.decorate('https://example.org/')), 'https://example.org/');
        await page.evaluate(() => { window.sameDocumentMarker = 'kept'; });
        await page.click('#fragment');
        assert.equal(await page.evaluate(() => window.sameDocumentMarker), 'kept', 'fragment navigation retains document state');
        assert.equal(await page.locator('#fragment').getAttribute('href'), '#pricing');
        await page.evaluate(() => {
          document.querySelector('#relative').addEventListener('click', event => event.preventDefault(), { once: true });
          document.querySelector('#relative').click();
          history.pushState({ view: 'route' }, '', '/changed-route');
        });
        assert.equal(await page.locator('#relative').getAttribute('href'), '?tab=details');
        assert.equal(await page.locator('#relative').evaluate(anchor => new URL(anchor.href).pathname), '/changed-route');
        await page.click('#next');
        await page.waitForLoadState();
        assert.equal(new URL(page.url()).searchParams.get('adslop_reference'), reference);
        assert.equal(await page.evaluate(() => window.adslop.start()), reference);
        assert.equal(new URL(page.url()).searchParams.has('adslop_reference'), false);
        await page.reload();
        assert.equal(await page.evaluate(() => window.adslop.start()), reference);
        assert.equal(await count('store'), before + 1);
        await page.evaluate(() => {
          const anchor = document.querySelector('#next');
          anchor.addEventListener('click', event => { event.preventDefault(); window.adslop.stop(); }, { once: true });
          anchor.click();
        });
        assert.equal(new URL(await page.locator('#next').getAttribute('href')).searchParams.has('adslop_reference'), false,
          'withdrawing consent restores a link before another click');
        assert.equal(await page.evaluate(() => window.adslop.reference()), null);
        const protocolReference = await page.evaluate(() => window.adslop.start());
        await page.evaluate(() => {
          const anchor = document.querySelector('#protocol-relative');
          window.rawOriginalHref = anchor.getAttribute('href');
          anchor.addEventListener('click', event => {
            window.decoratedProtocolHref = anchor.href;
            event.preventDefault(); window.adslop.stop();
          }, { once: true });
          anchor.click();
        });
        assert.equal(new URL(await page.evaluate(() => window.decoratedProtocolHref)).searchParams.get('adslop_reference'), protocolReference);
        assert.equal(await page.locator('#protocol-relative').getAttribute('href'), await page.evaluate(() => window.rawOriginalHref));
        const fresh = await page.evaluate(() => window.adslop.start());
        await page.evaluate(() => {
          window.middleDestination = null;
          document.addEventListener('mouseup', event => {
            if (event.button === 1) { window.middleDestination = event.target.closest('a')?.href; event.preventDefault(); }
          }, { once: true });
          document.addEventListener('auxclick', event => event.preventDefault(), { once: true });
        });
        const bounds = await page.locator('#next').boundingBox();
        assert.ok(bounds);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down({ button: 'middle' });
        await page.mouse.up({ button: 'middle' });
        const middleDestination = await page.evaluate(() => window.middleDestination);
        assert.equal(new URL(middleDestination).searchParams.get('adslop_reference'), fresh,
          'the native middle-button activation sees the decorated destination');
        const beforeTab = await count('store');
        const [newTab] = await Promise.all([page.context().waitForEvent('page'), page.click('#new-tab')]);
        await newTab.waitForURL(url => url.origin === secondOrigin && url.pathname === '/purchase', { waitUntil: 'load' });
        assert.equal(await newTab.evaluate(() => window.opener === null), true);
        assert.equal(new URL(newTab.url()).searchParams.get('adslop_reference'), fresh);
        assert.equal(await newTab.evaluate(() => window.adslop.start()), fresh);
        assert.equal(await count('store'), beforeTab, 'noopener new tabs resume instead of becoming organic visits');
        await newTab.close();
        await page.goto(secondOrigin + '/another');
        const other = await page.evaluate(() => window.adslop.start());
        assert.notEqual(other, reference);
        const foreign = await fetch(`${api}/v1/sites/another/sandbox/visits`, { method: 'POST', headers: {
          Origin: secondOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ reference }) });
        assert.equal(foreign.status, 404);
        await page.evaluate(() => window.adslop.stop());
        assert.equal(await page.evaluate(() => window.adslop.reference()), null);
        assert.equal(await page.evaluate(() => sessionStorage.length), 1, 'only the other product context remains');
        let release, reached;
        const arrived = new Promise(resolve => { reached = resolve; });
        const hold = new Promise(resolve => { release = resolve; });
        await page.route('**/v1/sites/another/sandbox/visits', async route => { reached(); await hold; await route.continue(); });
        await page.evaluate(() => { window.pendingStart = window.adslop.start(); });
        await arrived;
        await page.evaluate(() => window.adslop.stop());
        release();
        assert.equal(await page.evaluate(() => window.pendingStart), null);
        assert.equal(await page.evaluate(() => window.adslop.reference()), null, 'late responses do not restore tracking');
        await page.unroute('**/v1/sites/another/sandbox/visits');
        let releaseNavigation, navigationReached;
        const navigationArrived = new Promise(resolve => { navigationReached = resolve; });
        const navigationHold = new Promise(resolve => { releaseNavigation = resolve; });
        await page.route('**/v1/sites/another/sandbox/visits', async route => { navigationReached(); await navigationHold; await route.continue(); });
        await page.evaluate(() => {
          history.replaceState({ view: 'original' }, '', '/another?adslop_campaign=search');
          window.pendingStart = window.adslop.start();
        });
        await navigationArrived;
        await page.evaluate(() => history.pushState({ view: 'changed' }, '', '/another/changed?keep=1'));
        releaseNavigation();
        await page.evaluate(() => window.pendingStart);
        assert.equal(new URL(page.url()).pathname, '/another/changed');
        assert.equal(new URL(page.url()).search, '?keep=1');
        assert.deepEqual(await page.evaluate(() => history.state), { view: 'changed' });
        await page.evaluate(() => window.adslop.stop());
        await page.unroute('**/v1/sites/another/sandbox/visits');
        await page.route('**/v1/sites/another/sandbox/visits', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture_unavailable"}' }));
        const failure = await page.evaluate(async () => {
          let message = null;
          window.addEventListener('adslop:error', event => { message = event.detail.message; }, { once: true });
          try { await window.adslop.start(); return false; } catch (error) { return message === error.message; }
        });
        assert.equal(failure, true, 'collection failure is observable');
        const basePage = await browser.newPage();
        await basePage.goto(firstOrigin + '/with-base?adslop_campaign=search');
        const baseReference = await basePage.evaluate(() => window.adslop.start());
        await basePage.click('#base-relative');
        await basePage.waitForURL(url => url.origin === secondOrigin && url.pathname === '/base/purchase', { waitUntil: 'load' });
        assert.equal(new URL(basePage.url()).searchParams.get('adslop_reference'), baseReference);
        assert.equal(await basePage.evaluate(() => window.adslop.start()), baseReference);
        await basePage.close();
        await page.close();
      } finally { await browser.close(); }
    }
  } finally {
    if (apiProcess && apiProcess.exitCode === null) { apiProcess.kill('SIGTERM'); await once(apiProcess, 'exit'); }
    for (const server of [first, second]) if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});
