// ==UserScript==
// @name         Bilibili Ticket Automation
// @namespace    http://www.huawei.com/
// @version      0.20
// @description  Automate ticket purchasing process on Bilibili
// @author       You
// @match        https://mall.bilibili.com/neul-next/*
// @match        *://pay.bilibili.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    const BWID = 102194; // 活动ID
    const DAY_FLAG = GM_getValue("day_flag", 0);
    let CLICK_LIMIT_INTV = GM_getValue("CLICK_LIMIT_INTV", 285);
    let CHECK_TICKET_INTV = GM_getValue("CHECK_TICKET_INTV", 520);
    const LAST_CONFIRM_PAGE = GM_getValue("LAST_CONFIRM_PAGE", `https://mall.bilibili.com/neul-next/ticket/detail.html?id=${BWID}`);

    GM_registerMenuCommand("🚶 最有含金量的抢票脚本", () => { window.location.href = 'https://space.bilibili.com/3546885967054928?spm_id_from=333.337.0.0'; });
    GM_registerMenuCommand(`🐎 当前抢票为7月${DAY_FLAG + 11}号`, () => {
        var day_flag_new = prompt("请输入要抢几号的票（仅限11、12、13）", DAY_FLAG + 11);
        if (day_flag_new != null) {
            var set_val = parseInt(day_flag_new) - 11;
            if (set_val < 0 || set_val > 2) {
                alert("你的参数违法了🚨，只能输入11、12、13之一");
                return;
            }
            GM_setValue("day_flag", set_val);
        }
        window.location.reload();
    });
    GM_registerMenuCommand("💡 打开上次确认订单页", () => { window.location.href = LAST_CONFIRM_PAGE; });
    GM_registerMenuCommand(`✔ 已进入 ${GM_getValue("count_enter", 0)} 次抢票页`, () => {
        let enter_log = GM_getValue("enter_log", []);
        let alert_res = "进入记录：";
        enter_log.forEach(item => {
            alert_res += "\n" + item;
        });
        alert(alert_res);
    });
    GM_registerMenuCommand(`💳 有票次数为 ${GM_getValue("count_found", 0)}`, () => {
        let enter_log = GM_getValue("last_found_time", "no");
        let alert_res = "最后一次有票为：" + enter_log;
        alert(alert_res);
    });
    GM_registerMenuCommand(`🖱 点弹窗次数为 ${GM_getValue("count_click", 0)}`, () => {
        let enter_log = GM_getValue("last_click_time", "no");
        let alert_res = "最后一次点击为：" + enter_log;
        alert(alert_res);
    });
    GM_registerMenuCommand(`🗑️ 战绩可查，清空战绩！`, () => {
        GM_setValue("count_found", 0);
        GM_setValue("count_click", 0);
        GM_setValue("count_enter", 0);
        alert("已清空战绩~");
    });
    GM_registerMenuCommand(`⏰ 点弹窗间隔 ${CLICK_LIMIT_INTV} ms`, () => {
        var intv = prompt("请输入点前方拥挤弹窗间隔 (ms)，间隔不要太小。", CLICK_LIMIT_INTV);
        if (intv != null) {
            var set_val = parseInt(intv);
            if (set_val < 80) {
                alert("间隔太短了，请输入80以上的数字。");
                return;
            }
            GM_setValue("CLICK_LIMIT_INTV", set_val);
            window.location.reload();
        }
    });
    GM_registerMenuCommand(`⏰ 查票间隔 ${CHECK_TICKET_INTV} ms`, () => {
        var intv = prompt("请输入点前方拥挤弹窗间隔 (ms)，间隔不要太小。", CHECK_TICKET_INTV);
        if (intv != null) {
            var set_val = parseInt(intv);
            if (set_val < 350) {
                alert("间隔太短了，亲测会被雅阁，请输入350以上的数字。");
                return;
            }
            GM_setValue("CHECK_TICKET_INTV", set_val);
            alert("设置完成，实际间隔为设置间隔正负65ms。");
            window.location.reload();
        }
    });

    // 根据当前URL执行不同的脚本
    if (window.location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/detail.html')) {
        const params = new URLSearchParams(window.location.search);
        let isBW = false;
        params.forEach((value, key) => {
            console.log(key, value);
            if (key == 'id' && value == BWID) {
                isBW = true;
            }
        });
        if (isBW) runDetailPageScript(); else alert("不是BW页面，已关闭检测。");
    } else if (window.location.href.startsWith('https://mall.bilibili.com/neul-next/ticket/confirmOrder.html')) {
        GM_getValue("LAST_CONFIRM_PAGE", window.location.href);
        runConfirmOrderPageScript();
    } else if (window.location.href.startsWith('https://pay.bilibili.com')) {
        // ★★★★★★★★ 把下面这一行注释掉，可以跳转到你的某个视频，等于播放声音了 ★★★★★★★★
        window.location.href = "https://www.bilibili.com/video/BV1sa4y1H7ek";
        // alert("抢到票了兄弟们！");
    }

    function runDetailPageScript() {
        let checkInterval;
        let reloadTimeout;

        function clickTicketCategory() {
            document.querySelectorAll('.ticket-container .radio-group').forEach(group => {
                const labels = Array.from(group.children);
                const lastActive = labels.slice().reverse().find(label => label.classList.contains('active'));
                // 抢分类中最后一类票
                if (lastActive) lastActive.click();
            });
        }

        function openPage2() {
            const radioGroup = document.querySelector(".screen-container .radio-group");
            if (radioGroup && radioGroup.children.length > 1) {
                radioGroup.children[DAY_FLAG].click();
                setTimeout(() => {
                    clickTicketCategory();
                    const bottomButton = document.querySelector(".bottom-bar .bili-button");
                    if (bottomButton && !bottomButton.classList.contains("is-disabled")) {
                        bottomButton.click();
                        var enters = GM_getValue("count_enter", 0);
                        GM_setValue("count_enter", enters + 1);
                        var enter_list = GM_getValue("enter_log", []);
                        const now = new Date().toLocaleTimeString();
                        enter_list.push(now);
                        enter_list = enter_list.slice(-10);
                        GM_setValue("enter_log", enter_list);
                    } else {
                        checkInterval = setInterval(checkTickets, 530);
                        clearTimeout(reloadTimeout);
                    }
                }, 45);
            }
        }

        function openPurchasePage() {
            document.dispatchEvent(new Event('visibilitychange'));
            setTimeout(() => {
                setTimeout(() => {
                    const button = document.querySelector('.action-container .bili-button');
                    if (button && !button.classList.contains("is-disabled")) {
                        button.click();
                        clearInterval(checkInterval);
                        reloadTimeout = setTimeout(() => {
                            location.reload();
                        }, 10000);
                        setTimeout(() => { openPage2(); }, 60);
                    } else {
                        console.info('未找到元素，继续寻找。');
                    }
                }, 50);
            }, 50);
        }

        function checkTickets() {
            fetch(`https://show.bilibili.com/api/ticket/project/getV2?version=134&id=${BWID}&project_id=${BWID}&requestSource=pc-new`)
                .then(res => res.json())
                .then(resp => {
                    const now = new Date().toLocaleTimeString();
                    const list = resp.data.screen_list?.[DAY_FLAG]?.ticket_list || [];
                    let found = false;
                    let allSold = true;
                    list.forEach(item => {
                        if (item.sale_flag?.number !== 8 && item.sale_flag?.number !== 4 && item.sale_flag?.number !== 1) {
                            console.warn(`[${now}] ${item.desc}`);
                            if (!found) {
                                openPurchasePage();
                            }
                            found = true;
                        } else if (item.sale_flag?.number !== 4) {
                            allSold = false;
                        }
                    });
                    if (!found) {
                        // 获取所有 class 为 "venue-name" 的元素
                        const venue = document.querySelector('.venue-name');
                        if (venue) {
                            const firstChild = venue.firstElementChild;
                            if (firstChild) {
                                firstChild.textContent = `[${now}] 7月${DAY_FLAG+11}日${allSold ? "已售罄" : "暂时售罄"}`;
                            }
                        }
                    } else {
                        var founds = GM_getValue("count_found", 0);
                        GM_setValue("count_found", founds + 1);
                        GM_setValue("last_found_time", now);
                    }
                });
        }

        // 启动定时器，并保存ID
        checkInterval = setInterval(checkTickets, CHECK_TICKET_INTV);
    }

    function runConfirmOrderPageScript() {
        // 检查并点击按钮
        function checkAndClick() {
            const messageIcon = document.querySelector('.bili-message-icon');
            if (messageIcon && window.getComputedStyle(messageIcon).display !== 'none') {
                window.location.href = `https://mall.bilibili.com/neul-next/ticket/detail.html?id=${BWID}`;
                console.log('检测到可见的 bili-message-icon，已跳转');
            }
            const limitElement = document.getElementById('bili-request-limit');
            // 如果 bili-request-limit 不存在 或 display 是 none
            if (!limitElement || (limitElement && window.getComputedStyle(limitElement).display === 'none')) {
                return;
            }
            const button = document.querySelector('.bili-request-limit-container .bili-button');
            if (button) {
                button.click();
                const now = new Date().toLocaleTimeString();
                var clicks = GM_getValue("count_click", 0);
                GM_setValue("count_click", clicks + 1);
                GM_setValue("last_click_time", now);
            } else {
                console.error('未找到 .bili-request-limit-container 内的 .bili-button 元素');
            }
        }

        const limitCheckInterval = setInterval(checkAndClick, CLICK_LIMIT_INTV);

        // 点击订单按钮
        function simulateClick() {
            const limitElement = document.getElementById('bili-request-limit');
            // 如果 bili-request-limit 不存在 或 display 是 none 才执行点击
            if (!limitElement || (limitElement && window.getComputedStyle(limitElement).display === 'none')) {
                const button = document.querySelector('.order-button-area .bili-button');
                if (button) {
                    button.click();
                } else {
                    console.error('未找到 .order-button-area 内的 .bili-button 元素');
                }
            } else {
                console.log('bili-request-limit 存在且可见，不执行订单按钮点击');
            }
        }

        // 检查票务状态
        function checkTickets() {
            fetch(`https://show.bilibili.com/api/ticket/project/getV2?version=134&id=${BWID}&project_id=${BWID}&requestSource=pc-new`)
                .then(res => res.json())
                .then(resp => {
                    const now = new Date().toLocaleTimeString();
                    const list = resp.data.screen_list?.[DAY_FLAG]?.ticket_list || [];
                    let found = false;
                    list.forEach(item => {
                        if (item.sale_flag?.number !== 8 && item.sale_flag?.number !== 4 && item.sale_flag?.number !== 1) {
                            console.error(`[${now}] ${item.desc}`);
                            if (!found) simulateClick();
                            found = true;
                        }
                    });
                    if (!found) {
                        // console.log(`[${now}] no`);
                        if (Math.random() < 0.26) {
                            simulateClick();
                        }
                    } else {
                        var founds = GM_getValue("count_found", 0);
                        GM_setValue("count_found", founds + 1);
                        GM_setValue("last_found_time", now);
                    }
                })
                .catch((error) => console.error("[check ticket] Error:", error));
            setTimeout(checkTickets, CHECK_TICKET_INTV + (Math.floor(Math.random() * 131) - 65));
        }

        function selectBuyer() {
            const buyerTag = document.querySelector(".buyer-list .buyer-tag");
            if (buyerTag) {
                buyerTag.click();
                document.dispatchEvent(new Event('visibilitychange'));
                setTimeout(() => {
                    document.querySelector(".personal-id").style.display = "none";
                    simulateClick();
                }, 47);
            } else {
                setTimeout(() => selectBuyer(), 60);
            }
        }

        setTimeout(() => {
            selectBuyer();
        }, 55);
        const ticketCheckInterval = setTimeout(checkTickets, CHECK_TICKET_INTV);
    }
})();