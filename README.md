# BW Ticket Playwright Automation

这是一个 Node.js 22 + Playwright 本地自动化项目，用本机 Chrome 或 Edge 运行 Bilibili 票务页面流程。

程序会在详情页轮询查票，发现可售票后进入购买流程，在确认订单页选择购票人并提交订单。到达支付页后会停止自动化并打开提醒 URL，支付步骤需要人工处理。

## 1. 准备环境

需要先安装：

- Node.js `>=22.22.0`
- pnpm `11.5.2`
- Google Chrome，推荐
- Microsoft Edge，可作为 Chrome 不可用时的回退

确认版本：

```powershell
node -v
pnpm -v
```

## 2. 安装依赖

在项目目录执行：

```powershell
pnpm install
```

本项目默认使用本机已安装的浏览器，不依赖 Playwright 下载自带浏览器。

## 3. 创建配置文件

复制示例配置：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`。通常至少确认这些配置：

```dotenv
BW_PROJECT_ID=1002174
BW_DAY_FLAG=0
BW_CHECK_TICKET_INTERVAL_MS=1000
BW_CLICK_LIMIT_INTERVAL_MS=1000
BW_CHROME_PROFILE=E:/code/bw_tickets/.chrome-profile
BW_EDGE_PROFILE=E:/code/bw_tickets/.edge-profile
BW_BROWSER_EXECUTABLE=
BW_SUCCESS_URL=https://www.bilibili.com/video/BV1sa4y1H7ek
```

常用配置说明：

| 配置 | 说明 |
|---|---|
| `BW_PROJECT_ID` | 活动 ID，对应详情页 URL 里的 `id` |
| `BW_DAY_FLAG` | 目标日期索引，`0/1/2` 对应不同日期 |
| `BW_CHECK_TICKET_INTERVAL_MS` | 查票接口轮询间隔，单位毫秒 |
| `BW_CLICK_LIMIT_INTERVAL_MS` | 请求限制弹窗检查/点击间隔，单位毫秒 |
| `BW_CHROME_PROFILE` | Chrome 专用持久化登录 profile |
| `BW_EDGE_PROFILE` | Edge 专用持久化登录 profile |
| `BW_BROWSER_EXECUTABLE` | 浏览器可执行文件路径；留空时自动检测，优先 Chrome，找不到再用 Edge |
| `BW_SUCCESS_URL` | 进入支付页后打开的提醒 URL |
| `BW_USER_AGENT` | 自定义 User-Agent，留空关闭 |
| `BW_ACCEPT_LANGUAGE` | 自定义语言，留空关闭 |
| `BW_HIDE_WEBDRIVER` | 设置为 `1` 时隐藏部分自动化特征，默认关闭 |

不要把 `BW_CHROME_PROFILE` 或 `BW_EDGE_PROFILE` 指向日常使用的主浏览器 profile。建议一直使用项目专用 profile。

## 4. 首次登录

执行：

```powershell
pnpm run login
```

程序会打开浏览器并进入 Bilibili。请在打开的窗口里手动登录，最后关闭浏览器。

登录完成后，直接在终端按 `Ctrl+C` 结束登录模式。登录态会保存在 `.env` 中配置的 profile 目录里。

## 5. 启动自动化

执行：

```powershell
pnpm start
```

启动后程序会：

1. 打开配置的浏览器和持久化 profile。
2. 进入 `BW_PROJECT_ID` 对应的详情页。
3. 按 `BW_DAY_FLAG` 选择目标日期。
4. 发现可售票后进入购买流程。
5. 在确认订单页选择购票人并提交订单。
6. 遇到请求限制弹窗时尝试关闭。
7. 到达支付页后停止自动化，并打开 `BW_SUCCESS_URL` 提醒人工处理。

支付页不会继续自动支付。

## 6. 重置统计

统计文件写在：

```txt
data/stats.json
```

需要清空统计时执行：

```powershell
pnpm reset-stats
```

统计字段包括：

- `countEnter`
- `enterLog`
- `countFound`
- `lastFoundTime`
- `countClick`
- `lastClickTime`
- `lastConfirmPage`

## FAQ

### 为什么启动的是 Edge？

`BW_BROWSER_EXECUTABLE` 留空时，程序会自动检测浏览器：优先 Chrome，找不到 Chrome 时回退到 Edge。

如果希望固定使用 Chrome 或 Edge，可以在 `.env` 里写入完整路径：

```dotenv
BW_BROWSER_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe
```

或：

```dotenv
BW_BROWSER_EXECUTABLE=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe
```

### Edge 启动时报 driver 或浏览器启动失败怎么办？

本项目通过 Playwright 的 Chromium 通道启动本机 Edge，不需要手动下载 Edge WebDriver。出现 driver、browser executable、launch failed 之类错误时，优先检查：

1. Edge 是否已正常安装，并能手动打开。
2. `.env` 里的 `BW_BROWSER_EXECUTABLE` 是否写错。
3. 路径里有空格时，不要额外加引号，直接写完整路径。
4. Edge 是否正在被系统更新占用，关闭所有 Edge 后重试。
5. `BW_EDGE_PROFILE` 是否指向了日常 Edge 主 profile，建议改回项目专用目录。

仍然失败时，建议改用 Chrome：

```dotenv
BW_BROWSER_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe
```

### 登录后再次启动还是未登录？

确认登录和启动使用的是同一个 profile 配置：

```dotenv
BW_CHROME_PROFILE=E:/code/bw_tickets/.chrome-profile
BW_EDGE_PROFILE=E:/code/bw_tickets/.edge-profile
```

如果登录时用的是 Chrome，启动时却自动回退到了 Edge，就会使用另一个 profile。可以通过 `BW_BROWSER_EXECUTABLE` 固定浏览器。

### 页面没有按预期点击怎么办？

先保持可视化运行，观察页面是否改版、是否弹出验证或登录失效。页面结构变化时，优先检查 `src/selectors.js` 里的选择器。

### 可以把轮询间隔调得更低吗？

不建议。间隔过低更容易触发请求限制，也会让流程更难人工接管。建议先用较保守的间隔，确认流程稳定后再小幅调整。

## 安全边界

- 不自动支付。
- 不使用日常浏览器主 profile。
- 不建议降低轮询间隔到危险水平。
- 新增稳定性相关行为需要可配置，并默认关闭。

## 免责声明

本项目仅供个人学习、技术研究和合法的本地自动化实践使用。使用者应自行确认并遵守相关平台规则、活动规则、服务条款以及适用法律法规。

严禁将本项目用于恶意刷票、批量抢票、黄牛倒卖、牟利经营、破坏平台公平性、规避平台风控、干扰正常购票秩序或其他任何违法违规、不正当竞争及侵害第三方权益的行为。因使用、修改、传播或部署本项目而产生的任何风险、责任、损失或法律后果，均由使用者自行承担，项目作者及贡献者不对此承担责任。
