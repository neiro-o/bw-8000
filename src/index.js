import { resolveBrowserExecutableOrThrow } from './chromePath.js';
import { config, detailUrl } from './config.js';
import { resetStats } from './storage.js';
import { runConfirmOrderPage } from './pages/confirmOrderPage.js';
import { ensureDetailApiHook, runDetailPage } from './pages/detailPage.js';
import { runPaymentPage } from './pages/paymentPage.js';
import { sleep } from './utils.js';
import { closeFeishu, sendExitNotice, sendText } from './feishu/index.js';

const args = new Set(process.argv.slice(2));

let exiting = false;
async function shutdown(reason, exitCode = 0) {
  if (exiting) return;
  exiting = true;
  console.log(`[app] exiting: ${reason}`);
  await Promise.race([
    sendExitNotice(reason),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]).catch(error => console.error(`[feishu] exit notice failed: ${error.message}`));
  await Promise.race([
    closeFeishu(),
    new Promise(resolve => setTimeout(resolve, 1000)),
  ]).catch(() => {});
  process.exit(exitCode);
}

process.once('SIGINT', () => void shutdown('收到 SIGINT', 130));
process.once('SIGTERM', () => void shutdown('收到 SIGTERM', 143));
process.once('SIGHUP', () => void shutdown('收到 SIGHUP', 129));
process.once('beforeExit', code => void shutdown(`事件循环结束（code=${code}）`, code));
process.once('uncaughtException', error => {
  console.error(error);
  void shutdown(`未捕获异常：${error.message}`, 1);
});
process.once('unhandledRejection', reason => {
  console.error(reason);
  const message = reason instanceof Error ? reason.message : String(reason);
  void shutdown(`未处理的 Promise：${message}`, 1);
});

void sendText('✅ BW 抢票应用已启动');

if (args.has('--reset-stats')) {
  await resetStats();
  console.log('stats reset');
  await shutdown('统计数据已重置');
}

const { chromium } = await import('playwright');

const { executable, browser } = resolveBrowserExecutableOrThrow(config.browserExecutable || undefined);
const userDataDir = browser === 'edge' ? config.edgeProfile : config.chromeProfile;
console.log(`[browser] using ${browser} at ${executable}`);
console.log(`[browser] profile: ${userDataDir}`);

const isLoginMode = args.has('--login');
const useFullscreen = isLoginMode || config.browserFullscreen;

if (!useFullscreen) {
  console.log(`[browser] size: ${config.browserWidth}x${config.browserHeight}`);
}

const contextOptions = {
  executablePath: executable,
  headless: config.headless,
  ignoreDefaultArgs: ['--no-sandbox'],
};

if (!useFullscreen) {
  contextOptions.viewport = {
    width: config.browserWidth,
    height: config.browserHeight
  };
  contextOptions.args = [`--window-size=${config.browserWidth},${config.browserHeight}`];
} else {
  contextOptions.args = ['--start-maximized'];
  console.log('[browser] using fullscreen mode');
}
if (config.userAgent) {
  contextOptions.userAgent = config.userAgent;
  console.log(`[browser] userAgent: ${config.userAgent}`);
}
if (config.acceptLanguage) {
  contextOptions.locale = config.acceptLanguage;
  console.log(`[browser] acceptLanguage: ${config.acceptLanguage}`);
}

const context = await chromium.launchPersistentContext(userDataDir, contextOptions);

if (config.hideWebdriver) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  });
  console.log('[browser] webdriver fingerprint hidden');
}

context.on('close', () => {
  console.log('[browser] browser closed, exiting.');
  void shutdown('浏览器已关闭');
});

if (args.has('--login')) {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
  console.log(`login mode: finish login in the opened ${browser} window, then close this process manually.`);
  while (true) await sleep(1000);
}

async function gotoDetailPage(page) {
  await ensureDetailApiHook(page);
  await page.goto(detailUrl(config.projectId), { waitUntil: 'domcontentloaded' });
}

async function runAutomation(page, instanceId) {
  const label = `[instance:${instanceId + 1}]`;
  page.on('pageerror', error => {
    console.error(`${label} [browser:error] ${error.message}`);
  });
  page.on('close', () => console.log(`${label} tab closed`));

  console.log(`${label} automation started`);
  await gotoDetailPage(page);

  while (!page.isClosed()) {
    const url = page.url();

    if (url.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
      const current = new URL(url);
      if (current.searchParams.get('id') === String(config.projectId)) {
        await runDetailPage(page, context);
      } else {
        console.warn(`${label} [router] current detail page project does not match ${config.projectId}: ${url}`);
        await gotoDetailPage(page);
      }
    } else if (url.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
      await runConfirmOrderPage(page, context);
    } else if (url.startsWith('https://pay.bilibili.com')) {
      await runPaymentPage(page);
    } else if (
      url.startsWith('https://mall.bilibili.com') ||
      url.startsWith('https://pay.bilibili.com')
    ) {
      console.log(`${label} [router] unhandled bilibili page, waiting: ${url}`);
    } else {
      console.log(`${label} [router] unhandled page, returning to detail page: ${url}`);
      await gotoDetailPage(page);
    }

    await sleep(250);
  }
}

const existingPages = context.pages();
const pages = [];
for (let index = 0; index < config.instances; index += 1) {
  pages.push(existingPages[index] ?? await context.newPage());
}

console.log(`[browser] running ${pages.length} automation tab(s)`);
await Promise.all(pages.map((page, index) =>
  runAutomation(page, index).catch(error => {
    console.error(`[instance:${index + 1}] automation stopped: ${error.stack ?? error.message}`);
  })
));
