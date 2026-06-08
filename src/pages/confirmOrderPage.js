import { config, detailUrl } from '../config.js';
import { selectors } from '../selectors.js';
import { fetchTicketStatus } from '../ticketApi.js';
import { isClickableButton, isVisible, jitter, nowText, sleep } from '../utils.js';
import { recordFound, recordLimitClick, updateStats } from '../storage.js';

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
    await button.click();
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
    await button.click();
    console.log('[confirm] clicked submit order button');
    return true;
  }

  console.error('[confirm] submit order button not found or disabled');
  return false;
}

async function selectBuyer(page) {
  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
    const buyerTag = page.locator(selectors.buyerTag).first();
    if (await isVisible(buyerTag)) {
      await buyerTag.click();
      await dispatchVisibilityChange(page);
      await sleep(47);
      await page.locator(selectors.personalId).evaluate(element => {
        element.style.display = 'none';
      }).catch(() => {});
      await simulateClick(page);
      return;
    }

    await sleep(60);
  }
}

async function checkTicketsAndMaybeSubmit(page, context) {
  const timeText = nowText();
  try {
    const status = await fetchTicketStatus(context.request, config.projectId, config.dayFlag);
    if (status.found) {
      console.warn(`[confirm] [${timeText}] available ticket: ${status.available.map(item => item.desc).join(', ')}`);
      await recordFound(timeText);
      await simulateClick(page);
    } else if (Math.random() < config.submitWithoutTicketChance) {
      await simulateClick(page);
    }
  } catch (error) {
    console.error(`[confirm] check ticket failed: ${error.message}`);
  }
}

export async function runConfirmOrderPage(page, context) {
  console.log('[confirm] running confirm-order automation');
  await updateStats(stats => ({ ...stats, lastConfirmPage: page.url() }));

  void selectBuyer(page);
  const limitLoop = (async () => {
    while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
      await checkAndClickLimit(page);
      await sleep(config.clickLimitIntervalMs);
    }
  })();

  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
    await checkTicketsAndMaybeSubmit(page, context);
    await sleep(Math.max(80, jitter(config.checkTicketIntervalMs, 65)));
  }

  await limitLoop.catch(error => {
    console.error(`[confirm] request-limit loop failed: ${error.message}`);
  });
}
