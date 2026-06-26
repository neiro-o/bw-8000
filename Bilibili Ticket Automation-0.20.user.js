// ==UserScript==
// @name         Bilibili Ticket Automation
// @namespace    http://www.huawei.com/
// @version      0.21
// @description  Automate ticket purchasing process on Bilibili
// @author       You
// @match        https://mall.bilibili.com/neul-next/*
// @match        *://pay.bilibili.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG_KEY = 'bw_config';
    const STATS_KEY = 'bw_stats';
    const MIGRATION_KEY = 'bw_v021_migrated';
    const FIXED_PROJECT_ID = 1001653;
    const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;

    const DEFAULT_CONFIG = {
        projectId: FIXED_PROJECT_ID,
        dayFlag: 0,
        ticketIndex: 8,
        ticketQuantity: 1,
        clickLimitIntervalMs: 200,
        checkTicketIntervalMs: 500,
        detailStartTime: 1782619199000,
        successUrl: 'https://www.bilibili.com/video/BV1sa4y1H7ek'
    };

    const DEFAULT_STATS = {
        countEnter: 0,
        enterLog: [],
        countFound: 0,
        lastFoundTime: 'no',
        countClick: 0,
        lastClickTime: 'no',
        lastConfirmPage: ''
    };

    const selectors = {
        detailBuyButton: '.action-container .bili-button',
        screenRadioGroup: '.screen-container .radio-group',
        ticketRadioGroups: '.ticket-container .radio-group',
        detailQuantitySelect: '.bili-number-select.quantity-select',
        detailBottomButton: '.bottom-bar .bili-button',
        detailModalClose: '.bili-icon-modal-close',
        detailPopupContainer: '.popup-container',
        detailPopupSelectButton: '.popup-container .select-btn',
        detailRequestLimitButton: '[class*="limit"] .bili-button',
        buyerTag: '.buyer-list > .buy-item > .buyer-tag.tag',
        buyerTagName: '.buyer-list > .buy-item > .buyer-tag.tag > .name',
        buyerDetailContent: '.buyer-detail .content',
        personalId: '.personal-id',
        orderButton: '.order-button-area .bili-button',
        requestLimit: '#bili-request-limit',
        requestLimitButton: '.bili-request-limit-container .bili-button',
        messageIcon: '.bili-message-icon'
    };

    migrateLegacyValues();

    // Keep runtime state small: config and stats are the only persistent GM records.
    let config = readConfig();
    registerMenus();
    installTicketApiHook();
    routeCurrentPage();

    function readConfig() {
        return normalizeConfig(GM_getValue(CONFIG_KEY, {}));
    }

    function writeConfig(next) {
        config = normalizeConfig(next);
        GM_setValue(CONFIG_KEY, config);
        return config;
    }

    function readStats() {
        const raw = GM_getValue(STATS_KEY, {});
        return {
            ...DEFAULT_STATS,
            ...(raw && typeof raw === 'object' ? raw : {}),
            enterLog: Array.isArray(raw?.enterLog) ? raw.enterLog : []
        };
    }

    function writeStats(next) {
        GM_setValue(STATS_KEY, {
            ...DEFAULT_STATS,
            ...(next && typeof next === 'object' ? next : {}),
            enterLog: Array.isArray(next?.enterLog) ? next.enterLog.slice(-10) : []
        });
    }

    function updateStats(updater) {
        const current = readStats();
        writeStats(updater({ ...current, enterLog: [...current.enterLog] }));
    }

    function normalizeConfig(raw) {
        const merged = { ...DEFAULT_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
        return {
            // Project ID is intentionally fixed for this script build; old GM values cannot override it.
            projectId: FIXED_PROJECT_ID,
            dayFlag: toInt(merged.dayFlag, DEFAULT_CONFIG.dayFlag, 0),
            ticketIndex: toInt(merged.ticketIndex, DEFAULT_CONFIG.ticketIndex, 0),
            ticketQuantity: toInt(merged.ticketQuantity, DEFAULT_CONFIG.ticketQuantity, 1),
            clickLimitIntervalMs: toInt(merged.clickLimitIntervalMs, DEFAULT_CONFIG.clickLimitIntervalMs, 80),
            checkTicketIntervalMs: toInt(merged.checkTicketIntervalMs, DEFAULT_CONFIG.checkTicketIntervalMs, 350),
            detailStartTime: toInt(merged.detailStartTime, DEFAULT_CONFIG.detailStartTime, 0),
            successUrl: String(merged.successUrl || DEFAULT_CONFIG.successUrl)
        };
    }

    function toInt(value, fallback, min) {
        const number = Number.parseInt(value, 10);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, number);
    }

    function migrateLegacyValues() {
        const existingConfig = GM_getValue(CONFIG_KEY, null);
        const existingStats = GM_getValue(STATS_KEY, null);
        const migrated = GM_getValue(MIGRATION_KEY, false);

        if (!existingConfig) {
            const migratedConfig = { ...DEFAULT_CONFIG };
            const dayFlag = GM_getValue('day_flag', undefined);
            const clickLimit = GM_getValue('CLICK_LIMIT_INTV', undefined);
            const checkTicket = GM_getValue('CHECK_TICKET_INTV', undefined);
            if (dayFlag !== undefined) migratedConfig.dayFlag = dayFlag;
            if (clickLimit !== undefined) migratedConfig.clickLimitIntervalMs = clickLimit;
            if (checkTicket !== undefined) migratedConfig.checkTicketIntervalMs = checkTicket;
            GM_setValue(CONFIG_KEY, normalizeConfig(migratedConfig));
        }

        if (!existingStats) {
            GM_setValue(STATS_KEY, {
                ...DEFAULT_STATS,
                countEnter: toInt(GM_getValue('count_enter', 0), 0, 0),
                enterLog: Array.isArray(GM_getValue('enter_log', [])) ? GM_getValue('enter_log', []).slice(-10) : [],
                countFound: toInt(GM_getValue('count_found', 0), 0, 0),
                lastFoundTime: GM_getValue('last_found_time', 'no'),
                countClick: toInt(GM_getValue('count_click', 0), 0, 0),
                lastClickTime: GM_getValue('last_click_time', 'no'),
                lastConfirmPage: GM_getValue('LAST_CONFIRM_PAGE', '')
            });
        }

        if (!migrated) GM_setValue(MIGRATION_KEY, true);
    }

    function nowText() {
        return new Date().toLocaleTimeString();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function jitter(baseMs, spreadMs) {
        return baseMs + Math.floor(Math.random() * (spreadMs * 2 + 1)) - spreadMs;
    }

    function isVisible(el) {
        return Boolean(el && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden');
    }

    function isClickableButton(el) {
        if (!isVisible(el)) return false;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        return !String(el.className || '').split(/\s+/).some(name => name === 'is-disabled' || name === 'disabled' || name === 'disable');
    }

    function detailUrl(projectId = FIXED_PROJECT_ID) {
        return `https://mall.bilibili.com/neul-next/ticket/detail.html?id=${projectId}`;
    }

    function isTargetTicketApi(urlLike) {
        try {
            const url = new URL(urlLike, location.href);
            if (!url.href.includes('/api/ticket/project/getV2')) return false;
            const projectId = url.searchParams.get('project_id') || url.searchParams.get('id');
            return projectId === String(FIXED_PROJECT_ID);
        } catch {
            return false;
        }
    }

    function forcePresaleStatus(body) {
        const presale = { number: 2, display_name: '预售中' };
        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        const todayDateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const todayMidnightStr = `${todayDateStr} 00:00:00`;
        const todayMidnightSec = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
        const countDown = todayMidnightSec - Math.floor(Date.now() / 1000);

        // Match the Playwright detail-page hook: make the project look clickable to the page app.
        if (body?.data) {
            const data = body.data;
            data.sale_flag_number = presale.number;
            data.sale_flag = presale.display_name;
            data.canClick = true;
            data.pre_sale = 0;
            data.count_down = countDown;
            data.bs_countDown = countDown;
            if (Array.isArray(data.sales_dates)) {
                data.sales_dates = data.sales_dates.map(item => ({ date: item.date }));
            }
        }

        const screenList = body?.data?.screen_list;
        if (!Array.isArray(screenList)) return body;

        // The site checks availability at screen and ticket levels, so both layers are patched.
        for (const screen of screenList) {
            screen.saleFlag = { ...presale };
            screen.sale_flag = { ...presale };
            screen.sale_flag_number = presale.number;
            screen.show_date = todayDateStr;
            screen.clickable = true;

            if (!Array.isArray(screen.ticket_list)) continue;
            for (const ticket of screen.ticket_list) {
                ticket.saleFlag = { ...presale };
                ticket.sale_flag = { ...presale };
                ticket.sale_flag_number = presale.number;
                ticket.clickable = true;
                ticket.saleStart = todayMidnightStr;
                ticket.sale_start = todayMidnightStr;
                ticket.is_sale = 1;
                ticket.num = 4;
                ticket.num_type = 2;
                ticket.less_vt = -1;
                ticket.less_lv = -1;
            }
        }

        updateStats(stats => {
            stats.countFound += 1;
            stats.lastFoundTime = nowText();
            return stats;
        });
        return body;
    }

    function installTicketApiHook() {
        // Tampermonkey runs with GM grants in an isolated world; unsafeWindow reaches the real page APIs.
        const originalFetch = pageWindow.fetch;
        if (typeof originalFetch === 'function' && !originalFetch.__bwTicketHooked) {
            const hookedFetch = async function (input, init) {
                const response = await originalFetch.apply(this, arguments);
                const url = typeof input === 'string' ? input : input?.url;
                if (!isTargetTicketApi(url)) return response;

                try {
                    const body = forcePresaleStatus(await response.clone().json());
                    return new pageWindow.Response(JSON.stringify(body), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                } catch (error) {
                    console.error('[bw] fetch hook failed:', error);
                    return response;
                }
            };
            hookedFetch.__bwTicketHooked = true;
            pageWindow.fetch = hookedFetch;
        }

        const XHR = pageWindow.XMLHttpRequest;
        if (XHR?.prototype && !XHR.prototype.__bwTicketHooked) {
            const originalOpen = XHR.prototype.open;
            XHR.prototype.open = function (method, url) {
                this.__bwTicketRequestUrl = url;
                return originalOpen.apply(this, arguments);
            };

            const originalSend = XHR.prototype.send;
            XHR.prototype.send = function () {
                this.addEventListener('readystatechange', function () {
                    if (this.readyState !== 4 || !isTargetTicketApi(this.__bwTicketRequestUrl)) return;
                    try {
                        const body = forcePresaleStatus(JSON.parse(this.responseText));
                        const text = JSON.stringify(body);
                        Object.defineProperty(this, 'responseText', { get: () => text });
                        Object.defineProperty(this, 'response', { get: () => text });
                    } catch (error) {
                        console.error('[bw] xhr hook failed:', error);
                    }
                });
                return originalSend.apply(this, arguments);
            };
            XHR.prototype.__bwTicketHooked = true;
        }
    }

    async function waitUntilStart(label, stillHere) {
        while (stillHere()) {
            const startTime = readConfig().detailStartTime;
            if (!startTime || Date.now() >= startTime) return true;
            const remainMs = startTime - Date.now();
            if (remainMs % 10000 < 1000) console.info(`[bw:${label}] waiting ${Math.ceil(remainMs / 1000)}s before automation starts`);
            // Keep the page's own state machine fresh while waiting for the configured start time.
            document.dispatchEvent(new Event('visibilitychange'));
            await sleep(Math.min(1000, Math.max(100, remainMs)));
        }
        return false;
    }

    function registerMenus() {
        const cfg = readConfig();
        const stats = readStats();
        GM_registerMenuCommand('📊 查看统计数据', () => {
            const current = readStats();
            alert([
                `进入提交页: ${current.countEnter}`,
                `最近进入记录: ${current.enterLog.length ? current.enterLog.join(', ') : '无'}`,
                `接口可售/改写次数: ${current.countFound}`,
                `最后可售/改写时间: ${current.lastFoundTime}`,
                `限流弹窗点击: ${current.countClick}`,
                `最后限流点击时间: ${current.lastClickTime}`,
                `上次确认订单页: ${current.lastConfirmPage || '无'}`
            ].join('\n'));
        });
        GM_registerMenuCommand('🧹 重置统计数据', () => {
            writeStats(DEFAULT_STATS);
            alert('统计数据已重置');
        });
        GM_registerMenuCommand('💡 打开上次确认订单页', () => {
            const url = readStats().lastConfirmPage || detailUrl(FIXED_PROJECT_ID);
            location.href = url;
        });
        GM_registerMenuCommand(`🎯 项目 ID 固定: ${FIXED_PROJECT_ID}`, () => {
            alert(`项目 ID 已固定为 ${FIXED_PROJECT_ID}`);
        });
        GM_registerMenuCommand(`📅 目标日期索引 dayFlag: ${cfg.dayFlag}`, () => promptConfigInt('dayFlag', '请输入目标日期索引 dayFlag（0/1/2...）', 0));
        GM_registerMenuCommand(`🎫 票档索引 ticketIndex: ${cfg.ticketIndex}`, () => promptConfigInt('ticketIndex', '请输入票档索引 ticketIndex（从 0 开始）', 0));
        GM_registerMenuCommand(`👥 购票张数: ${cfg.ticketQuantity}`, () => promptConfigInt('ticketQuantity', '请输入购票张数', 1));
        GM_registerMenuCommand(`⏱️ 开始时间: ${formatStartTime(cfg.detailStartTime)}`, () => promptStartTime());
        GM_registerMenuCommand(`🚦 限流弹窗间隔: ${cfg.clickLimitIntervalMs} ms`, () => promptConfigInt('clickLimitIntervalMs', '请输入限流弹窗点击间隔（ms，最小 80）', 80));
        GM_registerMenuCommand(`🔁 提交/检查间隔: ${cfg.checkTicketIntervalMs} ms`, () => promptConfigInt('checkTicketIntervalMs', '请输入提交/检查间隔（ms，最小 350）', 350));
        GM_registerMenuCommand('🔔 设置成功提醒 URL', () => {
            const next = prompt('请输入进入支付页后打开的提醒 URL', readConfig().successUrl);
            if (next === null) return;
            writeConfig({ ...readConfig(), successUrl: next.trim() || DEFAULT_CONFIG.successUrl });
            location.reload();
        });
        GM_registerMenuCommand('📤 导出配置和统计 JSON', () => {
            alert(JSON.stringify({ config: readConfig(), stats: readStats() }, null, 2));
        });

        console.info('[bw] menus registered', { cfg, stats });
    }

    function promptConfigInt(key, message, min) {
        const current = readConfig();
        const input = prompt(message, current[key]);
        if (input === null) return;
        const value = Number.parseInt(input, 10);
        if (!Number.isFinite(value) || value < min) {
            alert(`请输入不小于 ${min} 的整数`);
            return;
        }
        writeConfig({ ...current, [key]: value });
        location.reload();
    }

    function promptStartTime() {
        const current = readConfig();
        const input = prompt('请输入开始时间毫秒时间戳；留空表示立即开始', current.detailStartTime || '');
        if (input === null) return;
        const trimmed = input.trim();
        writeConfig({ ...current, detailStartTime: trimmed ? Number.parseInt(trimmed, 10) : 0 });
        location.reload();
    }

    function formatStartTime(value) {
        if (!value) return '立即开始';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function formatClockTime(date = new Date()) {
        const pad = value => String(value).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function updateDetailWaitingTitle() {
        const title = document.querySelector('.title-text');
        if (title) title.textContent = `走马灯已部署，当前时间: ${formatClockTime()}`;
    }

    function startDetailWaitingTitleTicker() {
        const startTime = readConfig().detailStartTime;
        if (!startTime || Date.now() >= startTime) return null;

        // Only show the waiting ticker before automation starts; clear it as soon as the wait ends.
        updateDetailWaitingTitle();
        return window.setInterval(updateDetailWaitingTitle, 1000);
    }

    function routeCurrentPage() {
        // Router mirrors src/index.js, but only for pages Tampermonkey can observe in the current tab.
        if (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
            const params = new URLSearchParams(location.search);
            if (params.get('id') === String(FIXED_PROJECT_ID)) {
                runWhenReady(runDetailPage);
            } else {
                console.warn(`[bw] current project is not ${FIXED_PROJECT_ID}; automation disabled on this page`);
            }
        } else if (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
            updateStats(stats => ({ ...stats, lastConfirmPage: location.href }));
            runWhenReady(runConfirmOrderPage);
        } else if (location.href.startsWith('https://pay.bilibili.com')) {
            location.href = readConfig().successUrl;
        }
    }

    function runWhenReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => void fn(), { once: true });
        } else {
            void fn();
        }
    }

    async function runDetailPage() {
        console.info(`[bw:detail] watching project ${FIXED_PROJECT_ID}, day flag ${config.dayFlag}`);
        const waitingTitleTicker = startDetailWaitingTitleTicker();
        const started = await waitUntilStart('detail', () => location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html'));
        if (waitingTitleTicker) window.clearInterval(waitingTitleTicker);
        if (!started) return;
        void runDetailRequestLimitLoop();
        await runPurchaseAttemptLoop();
    }

    async function runDetailRequestLimitLoop() {
        while (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
            const button = document.querySelector(selectors.detailRequestLimitButton);
            if (isClickableButton(button)) {
                button.click();
                console.info('[bw:detail] clicked request-limit button');
            }
            await sleep(100);
        }
    }

    function clickIndexedRadio(groupSelector, index, label) {
        // Indexes come from GM config; out-of-range values fall back to the last available option.
        const radioGroup = document.querySelector(groupSelector);
        if (!radioGroup) {
            console.warn(`[bw:detail] ${label} radio group not found`);
            return false;
        }

        const children = Array.from(radioGroup.children);
        if (!children.length) {
            console.warn(`[bw:detail] ${label} has no options`);
            return false;
        }

        let targetIndex = index;
        if (targetIndex < 0) targetIndex = 0;
        if (targetIndex >= children.length) {
            targetIndex = children.length - 1;
            console.warn(`[bw:detail] ${label} index out of range, using ${targetIndex}`);
        }

        const option = children[targetIndex];
        if (!isClickableButton(option)) {
            console.warn(`[bw:detail] ${label} ${targetIndex} is disabled`);
            return false;
        }

        option.click();
        return true;
    }

    async function setTicketQuantity() {
        const target = readConfig().ticketQuantity;
        if (target === 1) return true;

        const quantitySelect = document.querySelector(selectors.detailQuantitySelect);
        if (!quantitySelect) {
            console.warn('[bw:detail] quantity selector not found');
            return false;
        }

        for (let attempt = 0; attempt < 100; attempt += 1) {
            const number = Number.parseInt(quantitySelect.querySelector('.number')?.textContent?.trim() || '', 10);
            if (!Number.isFinite(number)) return false;
            if (number === target) return true;

            // Quantity controls are plus/minus buttons; stop if the site disables either side.
            const direction = number < target ? 'plus' : 'minus';
            const button = quantitySelect.querySelector(`.button.${direction}`);
            if (!isClickableButton(button)) {
                console.warn(`[bw:detail] cannot change quantity from ${number} to ${target}`);
                return false;
            }
            button.click();
            await sleep(45);
        }

        return false;
    }

    async function selectScreenTicketAndQuantity() {
        const cfg = readConfig();
        if (!clickIndexedRadio(selectors.screenRadioGroup, cfg.dayFlag, 'screen')) return false;
        await sleep(45);
        if (!clickIndexedRadio(selectors.ticketRadioGroups, cfg.ticketIndex, 'ticket')) return false;
        if (!await setTicketQuantity()) return false;
        return Boolean(document.querySelector(selectors.detailBottomButton));
    }

    async function clickDetailPopupSelectButton() {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const popup = document.querySelector(selectors.detailPopupContainer);
            if (isVisible(popup)) {
                const selectButton = document.querySelector(selectors.detailPopupSelectButton);
                if (!isClickableButton(selectButton)) return false;
                selectButton.click();
                await sleep(45);
                return true;
            }
            await sleep(50);
        }
        return true;
    }

    function closeTicketModal() {
        document.querySelector(selectors.detailModalClose)?.click();
    }

    async function runPurchaseAttemptLoop() {
        let ticketSelected = false;
        let disabledSince = null;

        while (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
            const previousUrl = location.href;
            const bottomButton = document.querySelector(selectors.detailBottomButton);
            const modalOpen = isVisible(document.querySelector('.ticket-modal-container')) || isVisible(bottomButton);

            if (modalOpen) {
                // Some flows show a venue/popup confirmation before the real ticket modal becomes usable.
                if (!await clickDetailPopupSelectButton()) {
                    await sleep(100);
                    continue;
                }

                if (isClickableButton(bottomButton)) {
                    disabledSince = null;
                    bottomButton.click();
                    recordEnter();
                    if (location.href !== previousUrl) return;
                    await sleep(500 + Math.floor(Math.random() * 501));
                    continue;
                }

                if (!disabledSince) disabledSince = Date.now();
                // Disabled too long usually means stale modal state; close it and restart the attempt.
                if (Date.now() - disabledSince >= 6000) {
                    console.warn('[bw:detail] submit button disabled too long, closing modal');
                    disabledSince = null;
                    ticketSelected = false;
                    closeTicketModal();
                    await sleep(300);
                    continue;
                }

                if (!ticketSelected && await selectScreenTicketAndQuantity()) {
                    ticketSelected = true;
                    console.info('[bw:detail] screen and ticket selected');
                }

                await sleep(100);
                continue;
            }

            ticketSelected = false;
            disabledSince = null;

            const buyButton = document.querySelector(selectors.detailBuyButton);
            if (isClickableButton(buyButton)) {
                buyButton.click();
                await sleep(100);
                continue;
            }

            // The Bilibili page refreshes ticket state on visibilitychange without a full reload.
            document.dispatchEvent(new Event('visibilitychange'));
            await sleep(300);
        }
    }

    function recordEnter() {
        updateStats(stats => {
            stats.countEnter += 1;
            stats.enterLog.push(nowText());
            stats.enterLog = stats.enterLog.slice(-10);
            return stats;
        });
    }

    async function runConfirmOrderPage() {
        console.info('[bw:confirm] running confirm-order automation');
        void updateBuyerInfoOverlayLoop();
        if (!await waitUntilStart('confirm', () => location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html'))) return;

        const enteredAt = Date.now();
        void selectBuyer();
        void limitDialogLoop();

        while (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
            const elapsedMs = Date.now() - enteredAt;
            const afterInitialWindow = elapsedMs >= 30000;
            // First 30s are aggressive; afterwards slow down a bit so manual takeover stays possible.
            const shouldClick = !afterInitialWindow || Math.random() < 0.6;
            const intervalMs = afterInitialWindow ? readConfig().checkTicketIntervalMs * 2 : readConfig().checkTicketIntervalMs;
            if (shouldClick) simulateClick();
            await sleep(Math.max(80, jitter(intervalMs, 65)));
        }
    }

    async function limitDialogLoop() {
        while (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
            checkAndClickLimit();
            await sleep(Math.max(80, jitter(readConfig().clickLimitIntervalMs, 65)));
        }
    }

    function checkAndClickLimit() {
        const messageIcon = document.querySelector(selectors.messageIcon);
        if (isVisible(messageIcon)) {
            console.warn('[bw:confirm] visible message icon detected, returning to detail page');
            location.href = detailUrl(FIXED_PROJECT_ID);
            return;
        }

        const limit = document.querySelector(selectors.requestLimit);
        if (!isVisible(limit)) return;

        const button = document.querySelector(selectors.requestLimitButton);
        if (isClickableButton(button)) {
            button.click();
            updateStats(stats => {
                stats.countClick += 1;
                stats.lastClickTime = nowText();
                return stats;
            });
        }
    }

    function simulateClick() {
        if (isVisible(document.querySelector(selectors.requestLimit))) return false;
        const button = document.querySelector(selectors.orderButton);
        if (!isClickableButton(button)) return false;
        button.click();
        return true;
    }

    async function selectBuyer() {
        while (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
            const buyerTags = Array.from(document.querySelectorAll(selectors.buyerTag));
            if (buyerTags.length >= readConfig().ticketQuantity) {
                const selected = ensureBuyersSelected(buyerTags);
                if (!selected) {
                    await sleep(100);
                    continue;
                }
                document.dispatchEvent(new Event('visibilitychange'));
                await sleep(47);
                updateBuyerInfoOverlay();
                simulateClick();
                return;
            }
            await sleep(60);
        }
    }

    function ensureBuyersSelected(buyerTags) {
        const count = readConfig().ticketQuantity;
        if (buyerTags.length < count) return false;

        for (let index = 0; index < count; index += 1) {
            const buyerTag = buyerTags[index];
            if (!buyerTag.classList.contains('selected')) buyerTag.click();
        }
        return true;
    }

    async function updateBuyerInfoOverlayLoop() {
        while (location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
            updateBuyerInfoOverlay();
            await sleep(500);
        }
    }

    function updateBuyerInfoOverlay() {
        const stats = readStats();

        if (readConfig().ticketQuantity < 2) {
            document.querySelectorAll(selectors.buyerTagName).forEach(element => {
                element.textContent = '已匿名';
            });
        }

        document.querySelectorAll(selectors.buyerDetailContent).forEach(element => {
            const [name, phone] = Array.from(element.children);
            if (name) name.textContent = `限流点击: ${stats.countClick}`;
            if (phone) phone.textContent = `进入提交: ${stats.countEnter}`;
        });

        document.querySelectorAll(selectors.personalId).forEach(element => {
            element.style.display = 'none';
        });
    }
})();
