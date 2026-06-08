# BW Ticket Playwright Automation

这个项目把 `Bilibili Ticket Automation-0.20.user.js` 的 Tampermonkey 用户脚本迁移成一个 Node.js 22 + Playwright 程序。它复原了原脚本的页面分派、查票轮询、详情页点击、确认订单页选择购票人、提交订单、请求限制弹窗处理和支付页提醒逻辑。

## 边界说明

本项目不实现 undetected chromedriver 风格的规避检测、指纹伪装、header 伪装、CreepJS 调参或绕过平台风控的配置。程序使用可视化本地 Chrome 和持久化 profile，目标是让自动化流程可观察、可暂停、可手动接管。

支付页不会继续自动支付。进入 `pay.bilibili.com` 后程序认为流程已经到达人工支付阶段，并打开配置的提醒 URL。

## 环境

- Node.js `22.22.0` 或更高
- pnpm `11.5.2`
- Google Chrome
- Playwright

安装依赖：

```bash
pnpm install
```

如果 Playwright 没有安装浏览器也没有关系，本项目默认使用本机 Chrome：

```js
channel: 'chrome'
```

## 快速开始

第一次建议先登录：

```bash
pnpm login
```

它会打开本地 Chrome，使用项目目录下的 `.chrome-profile` 保存登录态。登录完成后手动结束进程。

启动自动化：

```bash
pnpm start
```

清空统计：

```bash
pnpm reset-stats
```

## 配置

配置通过环境变量传入：

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `BW_PROJECT_ID` | `102194` | 活动 ID |
| `BW_DAY_FLAG` | `0` | 目标日期索引，`0/1/2` 对应原脚本的 7 月 10/11/12 日 |
| `BW_CLICK_LIMIT_INTERVAL_MS` | `285` | 请求限制弹窗检查/点击间隔 |
| `BW_CHECK_TICKET_INTERVAL_MS` | `520` | 查票接口轮询间隔 |
| `BW_CHROME_PROFILE` | `E:/code/bw_tickets/.chrome-profile` | Chrome 专用持久化 profile 目录 |
| `BW_EDGE_PROFILE` | `E:/code/bw_tickets/.edge-profile` | Edge 专用持久化 profile 目录 |
| `BW_BROWSER_EXECUTABLE` | 自动检测 | 浏览器可执行文件路径；未设置时优先找 Chrome，找不到自动回退 Edge |
| `BW_HEADLESS` | `false` | 设置为 `1` 时使用 headless |
| `BW_DETAIL_RELOAD_WAIT_MS` | `10000` | 详情页点击购买后等待选票层的超时时间 |
| `BW_SUBMIT_WITHOUT_TICKET_CHANCE` | `0.26` | 确认订单页未检测到有票时随机提交概率 |
| `BW_SUCCESS_URL` | B 站视频 URL | 进入支付页后的提醒 URL |

PowerShell 示例：

```powershell
$env:BW_DAY_FLAG="1"
$env:BW_CHECK_TICKET_INTERVAL_MS="700"
pnpm start
```

## 迁移后的逻辑

### 页面路由

入口文件 `src/index.js` 根据当前 URL 分派：

- `ticket/detail.html` -> `runDetailPage`
- `ticket/confirmOrder.html` -> `runConfirmOrderPage`
- `pay.bilibili.com` -> `runPaymentPage`
- 其他页面 -> 返回详情页

### 详情页

文件：`src/pages/detailPage.js`

复原原脚本的 `runDetailPageScript()`：

1. 调用票务 API：

   ```txt
   https://show.bilibili.com/api/ticket/project/getV2
   ```

2. 读取：

   ```js
   body.data.screen_list?.[dayFlag]?.ticket_list
   ```

3. 如果 `sale_flag.number` 不是 `8/4/1`，认为发现可售票。
4. 点击 `.action-container .bili-button`。
5. 选择 `.screen-container .radio-group` 中第 `dayFlag` 个日期。
6. 在 `.ticket-container .radio-group` 中选择最后一个 `active` 票种。
7. 点击 `.bottom-bar .bili-button` 进入确认订单页。

如果没有发现票，会更新 `.venue-name` 的首个子节点文本，显示当前检查时间和售罄状态。

### 确认订单页

文件：`src/pages/confirmOrderPage.js`

复原原脚本的 `runConfirmOrderPageScript()`：

1. 循环查找并点击 `.buyer-list .buyer-tag`。
2. 派发 `visibilitychange`。
3. 隐藏 `.personal-id`。
4. 点击 `.order-button-area .bili-button` 提交订单。
5. 按间隔检查 `#bili-request-limit`。
6. 弹窗可见时点击 `.bili-request-limit-container .bili-button`。
7. 如果 `.bili-message-icon` 可见，返回详情页。
8. 确认订单页继续轮询票务 API。
9. 有票时提交；无票时按 `BW_SUBMIT_WITHOUT_TICKET_CHANCE` 随机提交。

查票间隔带有原脚本相同的正负 65ms 抖动。

### 支付页

文件：`src/pages/paymentPage.js`

进入 `pay.bilibili.com` 后停止继续自动化，并跳转到 `BW_SUCCESS_URL` 作为提醒。建议实际使用时把提醒 URL 改成一个本地声音提示页，或者改成桌面通知。

## 状态统计

文件：`src/storage.js`

统计数据写入：

```txt
data/stats.json
```

字段包括：

- `countEnter`
- `enterLog`
- `countFound`
- `lastFoundTime`
- `countClick`
- `lastClickTime`
- `lastConfirmPage`

这对应原脚本里的 `GM_getValue` / `GM_setValue` 数据。

## 选择器清单

文件：`src/selectors.js`

主要选择器：

```js
detailBuyButton: '.action-container .bili-button'
screenRadioGroup: '.screen-container .radio-group'
ticketRadioGroups: '.ticket-container .radio-group'
detailBottomButton: '.bottom-bar .bili-button'
buyerTag: '.buyer-list .buyer-tag'
orderButton: '.order-button-area .bili-button'
requestLimit: '#bili-request-limit'
requestLimitButton: '.bili-request-limit-container .bili-button'
messageIcon: '.bili-message-icon'
```

如果 B 站页面改版，优先检查这些选择器。

## 与原脚本的差异

- 原脚本运行在页面里，本项目运行在 Node.js 里，由 Playwright 控制浏览器。
- 原脚本使用 GM storage，本项目使用 `data/stats.json`。
- 原脚本在确认订单页疑似把保存确认页写成了 `GM_getValue("LAST_CONFIRM_PAGE", window.location.href)`；本项目修正为写入 `lastConfirmPage`。
- 原脚本在支付页跳转到视频；本项目保留这个行为，但文档中建议把它替换成更明确的提醒。
- 本项目不包含指纹伪装、header 伪装或风控规避逻辑。

## 安全使用建议

- 始终使用 `headless: false`，方便观察和接管。
- 不要复用日常 Chrome 主 profile，使用项目专用 `.chrome-profile`。
- 不要自动化支付。
- 轮询和点击间隔应根据页面稳定性调高，不建议盲目降低。
- 页面异常时先停下观察，不要让程序在未知状态下持续提交。
