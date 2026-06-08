import { resolveBrowserExecutableOrThrow } from './chromePath.js';
import { config, detailUrl } from './config.js';
import { resetStats } from './storage.js';
import { runConfirmOrderPage } from './pages/confirmOrderPage.js';
import { runDetailPage } from './pages/detailPage.js';
import { runPaymentPage } from './pages/paymentPage.js';
import { sleep } from './utils.js';

const args = new Set(process.argv.slice(2));

if (args.has('--reset-stats')) {
  await resetStats();
  console.log('stats reset');
  process.exit(0);
}

const { chromium } = await import('playwright');

const { executable, browser } = resolveBrowserExecutableOrThrow(config.browserExecutable || undefined);
const userDataDir = browser === 'edge' ? config.edgeProfile : config.chromeProfile;
console.log(`[browser] using ${browser} at ${executable}`);
console.log(`[browser] profile: ${userDataDir}`);

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: executable,
  headless: config.headless,
  viewport: null,
  args: ['--start-maximized']
});

const page = context.pages()[0] ?? await context.newPage();

const BROWSER_LOG_IGNORE = [
  /Refused to get unsafe header/,
  /This is not supported in browser version of superagent/,
];

page.on('console', message => {
  const text = message.text();
  if (text && !BROWSER_LOG_IGNORE.some(p => p.test(text))) {
    console.log(`[browser:${message.type()}] ${text}`);
  }
});

page.on('pageerror', error => {
  console.error(`[browser:error] ${error.message}`);
});

if (args.has('--login')) {
  await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
  console.log(`login mode: finish login in the opened ${browser} window, then close this process manually.`);
  while (true) await sleep(1000);
}

await page.goto(detailUrl(config.projectId), { waitUntil: 'domcontentloaded' });

while (true) {
  const url = page.url();

  if (url.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
    const current = new URL(url);
    if (current.searchParams.get('id') === String(config.projectId)) {
      await runDetailPage(page, context);
    } else {
      console.warn(`[router] current detail page project does not match ${config.projectId}: ${url}`);
      await page.goto(detailUrl(config.projectId), { waitUntil: 'domcontentloaded' });
    }
  } else if (url.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
    await runConfirmOrderPage(page, context);
  } else if (url.startsWith('https://pay.bilibili.com')) {
    await runPaymentPage(page);
  } else {
    console.log(`[router] unhandled page, returning to detail page: ${url}`);
    await page.goto(detailUrl(config.projectId), { waitUntil: 'domcontentloaded' });
  }

  await sleep(250);
}
