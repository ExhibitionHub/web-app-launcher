const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://127.0.0.1:4173';
const SHOTS_DIR = __dirname;

test.use({
  browserName: 'chromium',
  channel: 'msedge',
  viewport: { width: 1920, height: 1080 }
});

async function saveShot(page, name) {
  const filePath = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

async function waitForResultOverlay(page) {
  await expect(page.locator('.choice-panel.has-result-overlay')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.choice-panel.has-result-overlay');
    return Boolean(panel && panel.dataset.resultOverlayState === 'visible');
  }, null, { timeout: 12000 });
}

async function waitForFinalPanel(page) {
  await expect(page.locator('.final-panel')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.final-panel');
    return Boolean(panel && panel.dataset.finalPanelState === 'visible');
  }, null, { timeout: 12000 });
}

test('VG-board full visual smoke flow', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message || String(error));
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await expect(page.locator('.start-button')).toBeVisible();
  await saveShot(page, '01-home');

  await page.locator('.start-button').click();
  await expect(page.locator('.choice-panel .option-card').first()).toBeVisible({ timeout: 10000 });
  await saveShot(page, '02-step-start');

  let stepIndex = 0;
  while (stepIndex < 12) {
    const categoryCount = await page.locator('.category-option-card').count();
    if (categoryCount > 0) {
      break;
    }

    await expect(page.locator('.choice-panel .option-card').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.choice-panel .option-card').first().click();
    await waitForResultOverlay(page);

    if (stepIndex === 0) {
      await page.waitForTimeout(450);
      await saveShot(page, '03-first-result');
    }

    if (stepIndex === 6) {
      await page.waitForTimeout(450);
      await saveShot(page, '04-last-result');
    }

    await page.locator('[data-action="next"]').click();
    stepIndex += 1;

    await Promise.race([
      page.locator('.choice-panel .option-card').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
      page.locator('.category-option-card').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => null)
    ]);
  }

  expect(stepIndex, 'Expected to reach category choice within the available steps').toBeGreaterThanOrEqual(7);
  await expect(page.locator('.category-option-card').first()).toBeVisible({ timeout: 10000 });
  await saveShot(page, '05-category');

  await page.locator('.category-option-card').first().click();
  await waitForFinalPanel(page);
  await page.waitForTimeout(200);
  await saveShot(page, '06-final-intro');
  await page.waitForTimeout(2200);
  await saveShot(page, '07-final-settled');

  if (pageErrors.length) {
    fs.writeFileSync(path.join(SHOTS_DIR, 'page-errors.log'), `${pageErrors.join('\n')}\n`, 'utf8');
  }

  if (consoleErrors.length) {
    fs.writeFileSync(path.join(SHOTS_DIR, 'console-errors.log'), `${consoleErrors.join('\n')}\n`, 'utf8');
  }

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
