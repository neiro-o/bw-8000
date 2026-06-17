import { config } from '../config.js';
import { selectors } from '../selectors.js';
import { fetchTicketStatus } from '../ticketApi.js';
import { isClickableButton, nowText, sleep } from '../utils.js';
import { recordEnter, recordFound } from '../storage.js';

async function dispatchVisibilityChange(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

async function clickTicketCategory(page) {
  await page.locator(selectors.ticketRadioGroups).evaluateAll(groups => {
    for (const group of groups) {
      const labels = Array.from(group.children);
      const lastActive = [...labels].reverse().find(label => label.classList.contains('active'));
      const target = lastActive ?? labels.find(label => !label.classList.contains('disabled'));
      if (target) target.click();
    }
  });
}

function forcePresaleStatus(body) {
  const presale = { number: 2, display_name: '预售中' };
  const screenList = body?.data?.screen_list;
  if (!Array.isArray(screenList)) return body;

  for (const screen of screenList) {
    screen.saleFlag = { ...presale };
    screen.sale_flag = { ...presale };

    if (!Array.isArray(screen.ticket_list)) continue;
    for (const ticket of screen.ticket_list) {
      ticket.saleFlag = { ...presale };
      ticket.sale_flag = { ...presale };
      ticket.sale_flag_number = presale.number;
      ticket.clickable = true;
      if (ticket.saleStart) ticket.saleStart = '2020-01-01 00:00:00';
      if (ticket.saleEnd) ticket.saleEnd = '2099-01-01 00:00:00';
      if (ticket.sale_start) ticket.sale_start = '2020-01-01 00:00:00';
      if (ticket.sale_end) ticket.sale_end = '2099-01-01 00:00:00';
    }
  }

  return body;
}

async function installDetailApiHook(page) {
  const pattern = '**/api/ticket/project/getV2?**';
  const handler = async route => {
    if (!page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
      await route.continue();
      return;
    }

    const url = new URL(route.request().url());
    const requestProjectId = url.searchParams.get('project_id') ?? url.searchParams.get('id');
    if (requestProjectId !== String(config.projectId)) {
      await route.continue();
      return;
    }

    try {
      const response = await route.fetch();
      const rawBody = await response.json();
      const screenCount = rawBody?.data?.screen_list?.length ?? 0;
      const body = forcePresaleStatus(rawBody);
      const screen0 = body?.data?.screen_list?.[0];
      const hookOk = screen0?.saleFlag?.number === 2 && screen0?.sale_flag?.number === 2;
      const ticketList = screen0?.ticket_list ?? [];
      console.log(`[detail] getV2 hook ${hookOk ? '✓ OK' : '✗ FAILED'} | http ${response.status()} | screens=${screenCount} | tickets=${ticketList.length}`);
      await route.fulfill({ response, json: body });
    } catch (error) {
      console.error(`[detail] API hook failed: ${error.message}`);
      await route.continue();
    }
  };

  await page.route(pattern, handler);
  return { pattern, handler };
}

async function updateVenueStatus(page, timeText, allSold) {
  await page.locator(selectors.venueName).evaluate((venue, text) => {
    const firstChild = venue.firstElementChild;
    if (firstChild) firstChild.textContent = text;
  }, `[${timeText}] ${config.dayFlag + 1}日 ${allSold ? '已售罄' : '暂时售罄'}`).catch(() => {});
}

async function openPage2(page) {
  const radioGroup = page.locator(selectors.screenRadioGroup).first();
  if (!(await radioGroup.count())) return false;

  const children = radioGroup.locator(':scope > *');
  if ((await children.count()) <= config.dayFlag) return false;

  await children.nth(config.dayFlag).click();
  await sleep(45);
  await clickTicketCategory(page);

  const bottomButton = page.locator(selectors.detailBottomButton).first();
  if (await isClickableButton(bottomButton)) {
    await bottomButton.click();
    await recordEnter(nowText());
    return true;
  }

  return false;
}

async function openPurchasePage(page) {
  await dispatchVisibilityChange(page);
  await sleep(100);

  const modalAlreadyOpen = await page.locator('.ticket-modal-container').isVisible().catch(() => false);
  if (!modalAlreadyOpen) {
    const button = page.locator(selectors.detailBuyButton).first();
    if (!(await isClickableButton(button))) {
      console.info('[detail] buy button is not clickable yet');
      return false;
    }
    await button.click();
  } else {
    console.info('[detail] ticket modal already open, skipping buy button click');
  }

  const entered = await Promise.race([
    openPage2(page),
    sleep(config.maxDetailReloadWaitMs).then(async () => {
      console.warn('[detail] selection step timed out, reloading detail page');
      await page.reload({ waitUntil: 'domcontentloaded' });
      return false;
    })
  ]);

  return entered;
}

function parseDetailStartTime(value, now = new Date()) {
  const text = value.trim();
  if (!text) return null;

  const match = text.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;

  const [, hourText, minuteText, secondText, fractionText = ''] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number((fractionText + '000').slice(0, 3));

  if (hour > 23 || minute > 59 || second > 59) return null;

  const target = new Date(now);
  target.setHours(hour, minute, second, millisecond);
  return target;
}

async function waitUntilDetailStartTime() {
  if (!config.detailStartTime.trim()) return;

  const target = parseDetailStartTime(config.detailStartTime);
  if (!target) {
    console.warn(`[detail] invalid BW_DETAIL_START_TIME: ${config.detailStartTime}`);
    return;
  }

  let lastLogAt = 0;
  while (Date.now() < target.getTime()) {
    const remainingMs = target.getTime() - Date.now();
    const now = Date.now();
    if (now - lastLogAt >= 5000 || remainingMs <= 1000) {
      console.log(`[detail] waiting for start time ${config.detailStartTime}, remaining ${(remainingMs / 1000).toFixed(1)}s`);
      lastLogAt = now;
    }
    await sleep(Math.min(100, Math.max(1, remainingMs)));
  }
}

export async function runDetailPage(page, context) {
  console.log(`[detail] watching project ${config.projectId}, day flag ${config.dayFlag}`);
  const hook = await installDetailApiHook(page);
  console.log('[detail] installed detail-page ticket API hook');

  try {
    await waitUntilDetailStartTime();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openPurchasePage(page);

    while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
      const timeText = nowText();
      try {
        const status = await fetchTicketStatus(context.request, config.projectId, config.dayFlag);
        if (status.found) {
          console.warn(`[detail] [${timeText}] available ticket: ${status.available.map(item => item.desc).join(', ')}`);
          await recordFound(timeText);
          await openPurchasePage(page);
        } else {
          await updateVenueStatus(page, timeText, status.allSold);
        }
      } catch (error) {
        console.error(`[detail] check ticket failed: ${error.message}`);
      }

      await sleep(config.checkTicketIntervalMs);
    }
  } finally {
    await page.unroute(hook.pattern, hook.handler).catch(() => {});
    console.log('[detail] removed detail-page ticket API hook');
  }
}
