const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_URL = 'http://127.0.0.1:4173';
const SHOTS_DIR = __dirname;

function writeLog(name, lines) {
  if (!lines.length) {
    return;
  }

  fs.writeFileSync(path.join(SHOTS_DIR, name), `${lines.join('\n')}\n`, 'utf8');
}

async function saveShot(page, name) {
  const filePath = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

async function waitForResultOverlay(page) {
  await page.locator('.choice-panel.has-result-overlay').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.choice-panel.has-result-overlay');
    return Boolean(panel && panel.dataset.resultOverlayState === 'visible');
  }, null, { timeout: 12000 });
}

async function waitForFinalPanel(page) {
  await page.locator('.final-panel').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.final-panel');
    return Boolean(panel && panel.dataset.finalPanelState === 'visible');
  }, null, { timeout: 12000 });
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const pageErrors = [];
  const consoleErrors = [];
  const screenshots = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message || String(error));
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  try {
    console.log('goto');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('.start-button').waitFor({ state: 'visible', timeout: 10000 });
    screenshots.push(await saveShot(page, '01-home'));

    console.log('start');
    await page.locator('.start-button').click({ force: true });
    console.log('start-clicked');
    await page.locator('.choice-panel .option-card').first().waitFor({ state: 'visible', timeout: 10000 });
    screenshots.push(await saveShot(page, '02-step-start'));

    let stepIndex = 0;
    while (stepIndex < 12) {
      console.log(`step-loop:${stepIndex}`);
      const categoryCount = await page.locator('.category-option-card').count();
      if (categoryCount > 0) {
        break;
      }

      await page.locator('.choice-panel .option-card').first().waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('.choice-panel .option-card').first().click({ force: true });
      await waitForResultOverlay(page);
      console.log(`result-visible:${stepIndex}`);

      if (stepIndex === 0) {
        await page.waitForTimeout(450);
        screenshots.push(await saveShot(page, '03-first-result'));
      }

      if (stepIndex === 6) {
        await page.waitForTimeout(450);
        screenshots.push(await saveShot(page, '04-last-result'));
      }

      await page.locator('[data-action="next"]').click({ force: true });
      stepIndex += 1;

      await Promise.race([
        page.locator('.choice-panel .option-card').first().waitFor({ state: 'visible', timeout: 15000 }),
        page.locator('.category-option-card').first().waitFor({ state: 'visible', timeout: 15000 })
      ]).catch(() => null);
    }

    if (stepIndex < 7) {
      throw new Error(`Expected to reach category choice after the full step flow, reached only ${stepIndex} steps.`);
    }

    console.log('category');
    await page.locator('.category-option-card').first().waitFor({ state: 'visible', timeout: 10000 });
    screenshots.push(await saveShot(page, '05-category'));

    await page.locator('.category-option-card').first().click({ force: true });
    await waitForFinalPanel(page);
    console.log('final-visible');
    await page.waitForTimeout(200);
    screenshots.push(await saveShot(page, '06-final-intro'));
    await page.waitForTimeout(2200);
    screenshots.push(await saveShot(page, '07-final-settled'));

    writeLog('page-errors.log', pageErrors);
    writeLog('console-errors.log', consoleErrors);

    const summary = {
      ok: pageErrors.length === 0 && consoleErrors.length === 0,
      stepsVisited: stepIndex,
      screenshots,
      pageErrors,
      consoleErrors
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
