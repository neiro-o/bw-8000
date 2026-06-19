import { config } from '../config.js';
import { selectors } from '../selectors.js';
import { fetchTicketStatus } from '../ticketApi.js';
import { isClickableButton, isVisible, nowText, sleep } from '../utils.js';
import { recordEnter, recordFound } from '../storage.js';
import { waitUntilAutomationStartTime } from '../automationStartTime.js';

async function dispatchVisibilityChange(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
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
      ticket.num_type = 2;
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
  if (!context.__bwDetailApiHook) {
    context.__bwDetailApiHook = await installDetailApiHook(context);
  }
  return context.__bwDetailApiHook;
}

async function updateVenueStatus(page, timeText, allSold) {
  await page.locator(selectors.venueName).evaluate((venue, text) => {
    const firstChild = venue.firstElementChild;
    if (firstChild) firstChild.textContent = text;
  }, `[${timeText}] ${config.dayFlag + 1}日 ${allSold ? '已售罄' : '暂时售罄'}`).catch(() => {});
}

async function runTicketStatusCheck(page, context) {
  // Step A: Keep the former polling body as a reusable single-check helper.
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
}

async function clickIndexedRadio(page, groupSelector, index, label) {
  // Step B: Locate the radio group from the detail-page modal structure.
  const radioGroup = page.locator(groupSelector).first();
  if (!(await radioGroup.count())) {
    console.warn(`[detail] ${label} radio group not found`);
    return false;
  }

  // Step C: Treat the configured index as hard targeting; out of range fails fast.
  const children = radioGroup.locator(':scope > *');
  const count = await children.count();
  if (index < 0 || index >= count) {
    console.warn(`[detail] ${label} index ${index} out of range, total ${count}`);
    return false;
  }

  // Step D: Click the exact configured option only when the page says it is usable.
  const option = children.nth(index);
  const state = await option.evaluate(el => ({
    text: el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    className: el.className ?? '',
    ariaDisabled: el.getAttribute('aria-disabled'),
    disabled: Boolean(el.disabled),
  })).catch(() => null);

  if (!state) {
    console.warn(`[detail] ${label} index ${index} disappeared before click`);
    return false;
  }

  const disabled = state.disabled ||
    state.ariaDisabled === 'true' ||
    /\b(is-)?disabled\b/.test(String(state.className));
  if (disabled || !(await option.isEnabled().catch(() => false))) {
    const suffix = state.text ? ` (${state.text})` : '';
    console.warn(`[detail] ${label} index ${index}${suffix} is disabled, skip this attempt`);
    return false;
  }

  try {
    await option.click({ timeout: 1000 });
    return true;
  } catch (error) {
    console.warn(`[detail] ${label} index ${index} click failed: ${error.message}`);
    return false;
  }
}

async function openPage2(page) {
  // Step 2.1: Select the target screen by BW_DAY_FLAG.
  if (!(await clickIndexedRadio(page, selectors.screenRadioGroup, config.dayFlag, 'screen'))) return false;

  // Step 2.2: Let the ticket list update after the screen selection.
  await sleep(45);

  // Step 2.3: Select the target ticket category by BW_TICKET_INDEX.
  if (!(await clickIndexedRadio(page, selectors.ticketRadioGroups, config.ticketIndex, 'ticket'))) return false;

  // Step 2.4: Confirm the bottom action button exists before the click loop handles submission.
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
        await selectButton.click();
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

async function openPurchasePage(page) {
  // Step 5.1: Reuse an already-open ticket modal when the previous attempt left it visible.
  const modalAlreadyOpen = await page.locator('.ticket-modal-container').isVisible().catch(() => false);
  if (!modalAlreadyOpen) {
    // Step 5.2: Open the ticket modal from the detail-page buy button.
    const button = page.locator(selectors.detailBuyButton).first();
    if (!(await isClickableButton(button))) {
      console.info('[detail] buy button is not clickable yet');
      return false;
    }
    await button.click();
  } else {
    console.info('[detail] ticket modal already open, skipping buy button click');
  }

  // Step 5.3: Handle the intermediate popup before selecting screen and ticket category.
  if (!(await clickDetailPopupSelectButton(page))) return false;

  // Step 5.4: Select screen, ticket category, and click the modal submit button.
  return openPage2(page);
}

async function closeTicketModal(page) {
  // Step 3.1: Close the modal before restarting from visibilitychange.
  await page.locator(selectors.detailModalClose).first().click().catch(() => {});
}

async function isBottomButtonDisabled(button) {
  // Step 3.2: Use the button class as the restart signal requested by the page markup.
  const className = await button.getAttribute('class').catch(() => '');
  return className?.includes('is-disabled') ?? false;
}

function hasLeftDetailPage(page, previousUrl) {
  const currentUrl = page.url();
  return currentUrl !== previousUrl && !currentUrl.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html');
}

async function waitForOriginalRestartWindow(page, previousUrl) {
  // Step 3.3: Preserve the old 1.5s observation only after the button reports is-disabled.
  await sleep(1500);
  return hasLeftDetailPage(page, previousUrl);
}

async function clickBottomButtonUntilNavigationOrDisabled(page, previousUrl) {
  const bottomButton = page.locator(selectors.detailBottomButton).first();

  if (!(await bottomButton.count())) {
    console.info('[detail] bottom button not found, restarting selection flow');
    return false;
  }

  // Step 3.4: Click once first, then inspect whether the button turned disabled.
  await bottomButton.click().catch(error => {
    console.warn(`[detail] first bottom button click failed: ${error.message}`);
  });
  await recordEnter(nowText());

  if (hasLeftDetailPage(page, previousUrl)) return true;

  if (await isBottomButtonDisabled(bottomButton)) {
    console.info('[detail] bottom button disabled after first click, waiting original 1.5s window');
    return waitForOriginalRestartWindow(page, previousUrl);
  }

  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
    // Step 3.5: If the submit button becomes disabled later, use the same original 1.5s window.
    if (!(await bottomButton.count()) || await isBottomButtonDisabled(bottomButton)) {
      console.info('[detail] bottom button is disabled, waiting original 1.5s window');
      return waitForOriginalRestartWindow(page, previousUrl);
    }

    // Step 3.6: While enabled, keep clicking the submit button at a random 0.5-1.0s interval.
    await bottomButton.click().catch(error => {
      console.warn(`[detail] bottom button click failed: ${error.message}`);
    });

    await sleep(500 + Math.floor(Math.random() * 501));

    if (hasLeftDetailPage(page, previousUrl)) return true;
  }

  return true;
}

async function runPurchaseAttemptLoop(page) {
  while (page.url().startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
    // Step 4: At start time, wake detail-page logic by dispatching visibilitychange instead of reloading.
    await dispatchVisibilityChange(page);
    await sleep(100);

    const beforeSubmitUrl = page.url();
    const submitted = await openPurchasePage(page);
    if (!submitted) {
      console.info('[detail] purchase modal is not ready, retrying without exiting');
      await closeTicketModal(page);
      await sleep(500 + Math.floor(Math.random() * 501));
      continue;
    }

    if (await clickBottomButtonUntilNavigationOrDisabled(page, beforeSubmitUrl)) return true;

    console.warn('[detail] restarting after disabled bottom button');
    await closeTicketModal(page);
  }

  return true;
}

export async function runDetailPage(page, context) {
  console.log(`[detail] watching project ${config.projectId}, day flag ${config.dayFlag}`);
  // Keep the detail API hook installed at all times; detail getV2 may fire before this page runner starts.
  await ensureDetailApiHook(page);
  console.log('[detail] installed detail-page ticket API hook');

  await waitUntilAutomationStartTime('detail');
  // Step 4/5: Do a direct purchase-attempt flow; no detail-page polling loop here.
  await runPurchaseAttemptLoop(page);
}
