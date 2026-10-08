const fs = require('node:fs');
const path = require('node:path');
const {test, expect} = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const docsMap = require('../docs-map.json');
const productDocs = require('../product-docs.json');

const contractDocument = docsMap.documents.find(
  (document) => document.source === 'docs/Developer/Documentation-System.md'
);
const contractSource = fs.readFileSync(
  path.resolve(__dirname, '..', '..', contractDocument.source),
  'utf8'
);
const contractTitle = contractSource.match(/^# (.+)$/m)[1];
const contractRoute = contractDocument.slug.replace(/^\//, '');

test('desktop documentation surface matches the shared contract', async ({page}) => {
  await page.goto(`${contractRoute}?docusaurus-theme=light`);
  await expect(page.locator('h1')).toHaveText(contractTitle);
  await expect(page.locator('.navbar__link')).toHaveText([
    'Home',
    'Overview',
    'Guides',
    'Reference',
    'Developer',
    'Packages',
    'GitHub',
  ]);
  await expect(page.locator('a', {hasText: 'Edit this page'})).toHaveAttribute(
    'href',
    `${productDocs.sourceRepoUrl}/edit/main/${contractDocument.source}`
  );
  const geometry = await page.locator('.theme-doc-markdown').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    font: getComputedStyle(element).fontFamily,
    size: getComputedStyle(element).fontSize,
    navbar: document.querySelector('.navbar').getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(geometry.width).toBeLessThanOrEqual(680);
  expect(geometry.font).toContain('IBM Plex Sans');
  expect(geometry.size).toBe('17px');
  expect(geometry.navbar).toBeGreaterThanOrEqual(55);
  expect(geometry.navbar).toBeLessThanOrEqual(57);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('search and mobile behavior remain functional', async ({page}) => {
  await page.goto('?docusaurus-theme=light');
  await page.locator('input[aria-label="Search"]').fill(contractTitle);
  await expect(page.locator('[role="listbox"]')).toBeVisible();
  await expect(page.locator('[role="listbox"]')).toContainText(contractTitle);

  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${contractRoute}?docusaurus-theme=dark`);
  await expect(page.locator('.navbar__toggle')).toBeVisible();
  await expect(page.locator('.theme-doc-sidebar-container')).toBeHidden();
  const mobile = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(mobile.theme).toBe('dark');
  expect(mobile.overflow).toBeLessThanOrEqual(1);
});
