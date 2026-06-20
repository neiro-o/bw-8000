import { config } from '../config.js';
import { selectors } from '../selectors.js';
import { isClickableButton, isVisible, nowText, sleep } from '../utils.js';
import { recordEnter } from '../storage.js';
import { waitUntilAutomationStartTime } from '../automationStartTime.js';
import { waitForRapidDetailPageEntries } from '../detailPageThrottle.js';
import { sendText, sendTextOnce } from '../feishu/index.js';

async function dispatchVisibilityChange(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

async function clickDetailRequestLimitButton(page) {
  const button = page.locator(selectors.detailRequestLimitButton).first();
  if (!(await isClickableButton(button))) return;

  await button.click({ timeout: 2000 }).catch(error => {
    console.warn(`[detail] request-limit button click failed: ${error.message}`);
  });
  console.log('[detail] clicked request-limit button');
}

async function runDetailRequestLimitLoop(page) {
  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
    await clickDetailRequestLimitButton(page).catch(error => {
      console.warn(`[detail] request-limit button click failed: ${error.message}`);
    });
    await sleep(100);
  }
}

function forcePresaleStatus(body) {
  const presale = { number: 2, display_name: '预售中' };

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayDateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const todayMidnightStr = `${todayDateStr} 00:00:00`;
  const todayMidnightSec = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
  // Negative: sale start appears to be today's midnight (already passed)
  const countDown = todayMidnightSec - Math.floor(Date.now() / 1000);

  // 1. Top-level project fields
  if (body?.data) {
    const d = body.data;
    d.sale_flag_number = presale.number;
    d.sale_flag = presale.display_name;
    d.canClick = true;
    d.pre_sale = 0;
    d.count_down = countDown;
    d.bs_countDown = countDown;
    if (Array.isArray(d.sales_dates)) {
      d.sales_dates = d.sales_dates.map(item => ({ date: item.date }));
    }
  }

  const screenList = body?.data?.screen_list;
  if (!Array.isArray(screenList)) return body;

  for (const screen of screenList) {
    // 2. Screen-level fields
    screen.saleFlag = { ...presale };
    screen.sale_flag = { ...presale };
    screen.sale_flag_number = presale.number;
    screen.show_date = todayDateStr;
    screen.clickable = true;

    if (!Array.isArray(screen.ticket_list)) continue;
    for (const ticket of screen.ticket_list) {
      // Original 永久有票 logic preserved
      ticket.saleFlag = { ...presale };
      ticket.sale_flag = { ...presale };
      ticket.sale_flag_number = presale.number;
      ticket.clickable = true;
      // saleStart → today midnight; saleEnd unchanged
      ticket.saleStart = todayMidnightStr;
      ticket.sale_start = todayMidnightStr;

      // 3. Additional ticket fields per analysis
      ticket.is_sale = 1;
      ticket.num = 4;
      ticket.num_type = 2;
      ticket.less_vt = -1;
      ticket.less_lv = -1;
    }
  }

  return body;
}

async function installDetailApiHook(context) {
  const pattern = '**/api/ticket/project/getV2?**';
  const handler = async route => {
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
      // Wait, then dispatch visibilitychange so the page re-issues the API call and the hook gets another chance.
      await sleep(400);
      const detailPage = route.request().frame().page();
      if (detailPage) {
        await detailPage.evaluate(() =>
          document.dispatchEvent(new Event('visibilitychange'))
        ).catch(() => {});
        console.log('[detail] dispatched visibilitychange after hook failure to retry');
      }
    }
  };

  await context.route(pattern, handler);
  return { pattern, handler };
}

export async function ensureDetailApiHook(pageOrContext) {
  const context = typeof pageOrContext.context === 'function'
    ? pageOrContext.context()
    : pageOrContext;

  // Install once on the browser context so repeated detail getV2 calls keep being intercepted.
  if (!context.__bwDetailApiHookPromise) {
    context.__bwDetailApiHookPromise = installDetailApiHook(context).catch(error => {
      delete context.__bwDetailApiHookPromise;
      throw error;
    });
  }
  return context.__bwDetailApiHookPromise;
}



async function clickIndexedRadio(page, groupSelector, index, label) {
  // Step B: Locate the radio group from the detail-page modal structure.
  const radioGroup = page.locator(groupSelector).first();
  if (!(await radioGroup.count())) {
    console.warn(`[detail] ${label} radio group not found`);
    return false;
  }

  // Step C: Resolve the target index. When the configured index is out of range (e.g. the ticket
  // list shrank), warn and fall back to the last available option instead of failing.
  const children = radioGroup.locator(':scope > *');
  const count = await children.count();
  if (count <= 0) {
    console.warn(`[detail] ${label} has no options`);
    return false;
  }

  let targetIndex = index;
  if (targetIndex < 0) {
    console.warn(`[detail] ${label} index ${index} < 0, falling back to first option`);
    targetIndex = 0;
  } else if (targetIndex >= count) {
    targetIndex = count - 1;
    console.warn(`[detail] ${label} index ${index} out of range (total ${count}), falling back to last option ${targetIndex}`);
  }

  // Step D: Click the resolved option only when the page says it is usable.
  const option = children.nth(targetIndex);
  const state = await option.evaluate(el => ({
    text: el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    className: el.className ?? '',
    ariaDisabled: el.getAttribute('aria-disabled'),
    disabled: Boolean(el.disabled),
  })).catch(() => null);

  if (!state) {
    console.warn(`[detail] ${label} index ${targetIndex} disappeared before click`);
    return false;
  }

  const classTokens = String(state.className).split(/\s+/).filter(Boolean);
  const hasDisabledClass = classTokens.includes('disabled') || classTokens.includes('is-disabled');
  const disabled = state.disabled ||
    state.ariaDisabled === 'true' ||
    hasDisabledClass;
  if (disabled || !(await option.isEnabled().catch(() => false))) {
    const suffix = state.text ? ` (${state.text})` : '';
    console.warn(`[detail] ${label} index ${targetIndex}${suffix} is disabled, skip this attempt`);
    return false;
  }

  try {
    await option.click({ timeout: 1000 });
    return true;
  } catch (error) {
    console.warn(`[detail] ${label} index ${targetIndex} click failed: ${error.message}`);
    return false;
  }
}

async function setTicketQuantity(page) {
  if (config.ticketQuantity === 1) return true;

  const quantitySelect = page.locator(selectors.detailQuantitySelect).first();
  try {
    await quantitySelect.locator('.number').waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    console.warn('[detail] quantity selector did not appear after ticket selection');
    return false;
  }

  // Re-read the displayed number after every click: the site may enforce a per-ticket limit.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const number = Number.parseInt(
      (await quantitySelect.locator('.number').textContent().catch(() => ''))?.trim() ?? '',
      10
    );
    if (!Number.isInteger(number)) {
      console.warn('[detail] could not read the selected ticket quantity');
      return false;
    }
    if (number === config.ticketQuantity) {
      console.info(`[detail] ticket quantity set to ${number}`);
      return true;
    }

    const direction = number < config.ticketQuantity ? 'plus' : 'minus';
    const button = quantitySelect.locator(`.button.${direction}`).first();
    const className = await button.getAttribute('class').catch(() => '');
    if (!(await button.count()) || className?.split(/\s+/).includes('disable')) {
      console.warn(`[detail] cannot change ticket quantity from ${number} to ${config.ticketQuantity}: ${direction} button is disabled`);
      return false;
    }

    try {
      await button.click({ timeout: 1000 });
    } catch (error) {
      console.warn(`[detail] ${direction} quantity click failed: ${error.message}`);
      return false;
    }
    await sleep(45);
  }

  console.warn(`[detail] failed to set ticket quantity to ${config.ticketQuantity}`);
  return false;
}

async function openPage2(page) {
  // Step 2.1: Select the target screen by BW_DAY_FLAG.
  if (!(await clickIndexedRadio(page, selectors.screenRadioGroup, config.dayFlag, 'screen'))) return false;

  // Step 2.2: Let the ticket list update after the screen selection.
  await sleep(45);

  // Step 2.3: Select the target ticket category by BW_TICKET_INDEX.
  if (!(await clickIndexedRadio(page, selectors.ticketRadioGroups, config.ticketIndex, 'ticket'))) return false;

  // Step 2.4: Ticket quantity controls only appear after a ticket category is selected.
  // Run this on every selection so a reopened/reset modal is calibrated again.
  if (!(await setTicketQuantity(page))) return false;

  // Step 2.5: Confirm the bottom action button exists before the click loop handles submission.
  const bottomButton = page.locator(selectors.detailBottomButton).first();
  if (await bottomButton.count()) return true;

  console.info('[detail] bottom button not found yet');
  return false;
}

async function clickDetailPopupSelectButton(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const popup = page.locator(selectors.detailPopupContainer).first();
    if (await isVisible(popup)) {
      const selectButton = page.locator(selectors.detailPopupSelectButton).first();
      if (await isClickableButton(selectButton)) {
        await selectButton.click({ timeout: 2000 }).catch(error => {
          console.warn(`[detail] popup select button click failed: ${error.message}`);
        });
        console.log('[detail] clicked popup select button');
        await sleep(45);
        return true;
      }

      console.info('[detail] popup select button is not clickable yet');
      return false;
    }

    await sleep(50);
  }

  return true;
}

async function closeTicketModal(page) {
  await page.locator(selectors.detailModalClose).first().click({ timeout: 2000 }).catch(() => {});
}

async function isBottomButtonDisabled(button) {
  const className = await button.getAttribute('class').catch(() => '');
  return className?.includes('is-disabled') ?? false;
}

function hasLeftDetailPage(page, previousUrl) {
  const currentUrl = page.url();
  return currentUrl !== previousUrl && !currentUrl.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html');
}

// How long the submit button may stay disabled (after ticket selection) before we give up and
// close the modal to start fresh.
const BOTTOM_BUTTON_MAX_DISABLED_MS = 6000;

async function runPurchaseAttemptLoop(page) {
  const detailPrefix = 'https://mall.bilibili.com/neul-next/ticket/detail.html';

  // Track whether we have already selected screen+ticket in the current modal session so we
  // don't re-click the radio buttons while waiting for the server to process the submission.
  let ticketSelected = false;
  let disabledSince = null;

  while (page.url().startsWith(detailPrefix)) {
    const previousUrl = page.url();

    // --- Branch A: ticket selection modal is open ---
    const bottomButton = page.locator(selectors.detailBottomButton).first();
    const modalOpen =
      await isVisible(page.locator('.ticket-modal-container').first()) ||
      await isVisible(bottomButton);

    if (modalOpen) {
      // A1: Handle the intermediate venue-select popup if it appears.
      if (!(await clickDetailPopupSelectButton(page))) {
        await sleep(100);
        continue;
      }

      // A2: Submit button enabled → click it.
      if (!(await isBottomButtonDisabled(bottomButton))) {
        disabledSince = null;
        await bottomButton.click({ timeout: 2000 }).catch(error => {
          console.warn(`[detail] bottom button click failed: ${error.message}`);
        });
        await recordEnter(nowText());
        if (hasLeftDetailPage(page, previousUrl)) return true;
        await sleep(500 + Math.floor(Math.random() * 501));
        continue;
      }

      // A3: Submit button disabled.
      if (!disabledSince) disabledSince = Date.now();

      if (Date.now() - disabledSince >= BOTTOM_BUTTON_MAX_DISABLED_MS) {
        // Gave up waiting — close modal and start over.
        console.warn('[detail] submit button disabled too long, closing modal and retrying');
        disabledSince = null;
        ticketSelected = false;
        await closeTicketModal(page);
        await sleep(300);
        continue;
      }

      // A4: Not yet timed out — try selecting screen+ticket if not done yet.
      if (!ticketSelected) {
        const ok = await openPage2(page);
        if (ok) {
          ticketSelected = true;
          console.info('[detail] screen and ticket selected, waiting for submit button to enable');
        }
      }

      await sleep(100);
      continue;
    }

    // Modal closed/not open → reset per-modal state.
    ticketSelected = false;
    disabledSince = null;

    // --- Branch B: try to open the modal via the outer buy button ---
    const buyButton = page.locator(selectors.detailBuyButton).first();
    if (await isClickableButton(buyButton)) {
      await buyButton.click({ timeout: 2000 }).catch(error => {
        console.warn(`[detail] buy button click failed: ${error.message}`);
      });
      await sleep(100);
      continue;
    }

    // --- Branch C: outer button not clickable → refresh page state via visibilitychange ---
    console.info('[detail] buy button not clickable, refreshing via visibilitychange');
    await dispatchVisibilityChange(page);
    await sleep(300);
  }

  return true;
}

export async function runDetailPage(page, context) {
  void sendText(`🔎 进入 detailPage\n${page.url()}`);
  console.log(`[detail] watching project ${config.projectId}, day flag ${config.dayFlag}`);
  await waitForRapidDetailPageEntries(page);
  if (!page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) return;
  // Keep the detail API hook installed at all times; detail getV2 may fire before this page runner starts.
  await ensureDetailApiHook(page);
  console.log('[detail] installed detail-page ticket API hook');

  const stillOnDetailPage = await waitUntilAutomationStartTime(
    'detail',
    () => page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')
  );
  if (!stillOnDetailPage) return;
  void sendTextOnce('ticketing-started', `🚀 抢票开始\n项目 ID：${config.projectId}`);

  void runDetailRequestLimitLoop(page);

  // Step 4/5: Do a direct purchase-attempt flow; no detail-page polling loop here.
  await runPurchaseAttemptLoop(page);
}
