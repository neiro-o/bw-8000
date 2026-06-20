import { config, detailUrl } from '../config.js';
import { selectors } from '../selectors.js';
import { isClickableButton, isVisible, jitter, nowText, sleep } from '../utils.js';
import { readStats, recordLimitClick, updateStats } from '../storage.js';
import { waitUntilAutomationStartTime } from '../automationStartTime.js';
import { sendText } from '../feishu/index.js';

async function dispatchVisibilityChange(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

async function checkAndClickLimit(page) {
  const messageIconVisible = await page.evaluate(() => {
    const el = document.querySelector('.bili-message-icon');
    return el ? window.getComputedStyle(el).display !== 'none' : false;
  }).catch(() => false);
  if (messageIconVisible) {
    console.warn('[confirm] visible message icon detected, returning to detail page');
    await page.goto(detailUrl(config.projectId), { waitUntil: 'domcontentloaded' });
    return;
  }

  const limit = page.locator(selectors.requestLimit).first();
  if (!(await isVisible(limit))) return;

  const button = page.locator(selectors.requestLimitButton).first();
  if (await isClickableButton(button)) {
    await button.click({ timeout: 2000 }).catch(error => {
      console.warn(`[confirm] request-limit dialog button click failed: ${error.message}`);
    });
    await recordLimitClick(nowText());
    console.log('[confirm] clicked request-limit dialog button');
  }
}

async function simulateClick(page) {
  const limit = page.locator(selectors.requestLimit).first();
  if (await isVisible(limit)) {
    console.log('[confirm] request-limit dialog is visible, skipping submit');
    return false;
  }

  const button = page.locator(selectors.orderButton).first();
  if (await isClickableButton(button)) {
    await button.click({ timeout: 2000 }).catch(error => {
      console.warn(`[confirm] submit order button click failed: ${error.message}`);
    });
    console.log('[confirm] clicked submit order button');
    return true;
  }

  console.error('[confirm] submit order button not found or disabled');
  return false;
}

async function updateBuyerInfoOverlay(page) {
  const stats = await readStats();

  if (config.ticketQuantity < 2) {
    await page.locator(selectors.buyerTagName).evaluateAll(elements => {
      for (const element of elements) {
        element.textContent = '已匿名';
      }
    }).catch(() => {});
  }

  await page.locator(selectors.buyerDetailContent).evaluateAll((elements, displayStats) => {
    for (const element of elements) {
      const [name, phone] = Array.from(element.children);
      if (name) name.textContent = `限流点击：${displayStats.countClick}`;
      if (phone) phone.textContent = `进入提交：${displayStats.countEnter}`;
    }
  }, {
    countClick: stats.countClick,
    countEnter: stats.countEnter
  }).catch(() => {});

  await page.locator(selectors.personalId).evaluateAll(elements => {
    for (const element of elements) {
      element.style.display = 'none';
    }
  }).catch(() => {});
}

async function ensureBuyersSelected(page) {
  const buyerTags = page.locator(selectors.buyerTag);
  const count = await buyerTags.count();
  if (count < config.ticketQuantity) {
    console.warn(`[confirm] only ${count} buyer tags found, but ${config.ticketQuantity} are required`);
    return false;
  }

  for (let index = 0; index < config.ticketQuantity; index += 1) {
    const buyerTag = buyerTags.nth(index);
    const selected = await buyerTag.evaluate(element =>
      element.classList.contains('selected')
    ).catch(() => false);
    if (!selected) {
      try {
        await buyerTag.click({ timeout: 2000 });
        await buyerTag.waitFor({ state: 'visible', timeout: 2000 });
        await page.waitForFunction(
          ({ selector, targetIndex }) =>
            document.querySelectorAll(selector)[targetIndex]?.classList.contains('selected') === true,
          { selector: selectors.buyerTag, targetIndex: index },
          { timeout: 2000 }
        );
      } catch (error) {
        console.warn(`[confirm] buyer tag ${index + 1} was not selected: ${error.message}`);
        return false;
      }
    }
  }

  console.log(`[confirm] first ${config.ticketQuantity} buyer tag(s) selected`);
  return true;
}

async function selectBuyer(page) {
  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
    const buyerTag = page.locator(selectors.buyerTag).first();
    if (await isVisible(buyerTag)) {
      if (!(await ensureBuyersSelected(page))) {
        await sleep(100);
        continue;
      }
      await dispatchVisibilityChange(page);
      await sleep(47);
      await updateBuyerInfoOverlay(page);
      await simulateClick(page);
      return;
    }

    await sleep(60);
  }
}

async function updateBuyerInfoOverlayLoop(page) {
  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
    await updateBuyerInfoOverlay(page);
    await sleep(500);
  }
}

function getSubmitLoopState(enteredAt) {
  const elapsedMs = Date.now() - enteredAt;
  const afterInitialWindow = elapsedMs >= 30000;

  return {
    shouldClick: !afterInitialWindow || Math.random() < 0.6,
    intervalMs: afterInitialWindow ? config.checkTicketIntervalMs * 2 : config.checkTicketIntervalMs
  };
}

export async function runConfirmOrderPage(page) {
  void sendText(`📝 进入 confirmPage\n${page.url()}`);
  void updateBuyerInfoOverlayLoop(page);
  const stillOnConfirmPage = await waitUntilAutomationStartTime(
    'confirm',
    () => page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')
  );
  if (!stillOnConfirmPage) return;
  console.log('[confirm] running confirm-order automation');
  await updateStats(stats => ({ ...stats, lastConfirmPage: page.url() }));

  const enteredAt = Date.now();
  void selectBuyer(page);
  const limitLoop = (async () => {
    while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
      await checkAndClickLimit(page);
      await sleep(Math.max(80, jitter(config.clickLimitIntervalMs, 65)));
    }
  })();

  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
    const submitLoopState = getSubmitLoopState(enteredAt);
    if (submitLoopState.shouldClick) await simulateClick(page);
    await sleep(Math.max(80, jitter(submitLoopState.intervalMs, 65)));
  }

  await limitLoop.catch(error => {
    console.error(`[confirm] request-limit loop failed: ${error.message}`);
  });
}
