# BW Zoumadeng

去年单人拿下三张，战绩可查。

如果你是新手，请阅读下面的配置教程，如果还是不会，请淘宝闪购搜索超级小桀。

## 新手快速配置

### 1. 先装 Git、Node.js 和浏览器

你需要准备这些东西：

- Git
- Node.js `>=22.22.0`
- Chrome 或 Edge，二选一就行

Windows 安装 Node.js 时，记得勾上这个选项：

```txt
Automatically install the necessary tools. Note that this will also install Chocolatey...
```

安装器结束后，命令行窗口可能还会继续装一段时间。等它跑完再关，**不要看到 Node.js 安装界面结束就直接关掉所有窗口**。

装好以后可以打开**新的**命令行确认一下：

```powershell
# Windows 打开 cmd，不要开 PowerShell
git -v
node -v
```

### 2. 下载项目

找一个你平时放代码的目录，执行：

```powershell
git clone https://github.com/neiro-o/bw-8000.git
cd bw-8000
```

### 3. 安装 pnpm 和项目依赖

先安装 pnpm：

```powershell
npm install -g pnpm
```

然后在项目目录里安装依赖：

```powershell
pnpm install
```

如果你不确定自己是不是在项目目录，看当前目录里有没有 `package.json`。有的话再执行 `pnpm install`。

### 4. 初始化环境配置

执行：

```powershell
pnpm run setenv
```

这一步会帮你生成并填写基础配置。大多数情况下直接跑完就可以。

如果它提示失败，通常是没找到浏览器。打开 `.env`，把 `BW_BROWSER_EXECUTABLE` 填成你电脑上 Chrome 或 Edge 的绝对路径，例如，请严格注意把所有的路径分隔符"\"全部改成"/"：

```dotenv
BW_BROWSER_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe
```

Edge 一般是：

```dotenv
BW_BROWSER_EXECUTABLE=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe
```

路径里有空格也不用加引号，直接填完整路径。

### 5. 登录小破站

打开命令行（Windows可以右键项目文件夹，点击“在终端中打开”），执行：

```powershell
pnpm run login
```

注意，是 `pnpm run login`，不要输成 `pnpm login`。

脚本会打开浏览器。你在这个浏览器里登录小破站，登录时一定要勾选“长期登录”。不勾的话，后面很容易跑着跑着又变成未登录。

登录完成后，把这个浏览器彻底退出。Windows 直接关掉浏览器窗口通常就够了；Mac 上还需要在下方 Dock 栏右键浏览器图标，然后点“退出”。

退出后可以再执行一次：

```powershell
pnpm run login
```

如果打开后还是登录状态，说明登录信息已经保存好了。检查完同样要把浏览器彻底退出。

注意要预填购票人，如果抢2个及以上，强烈建议把多余的购票人删除。

### 6. 选择票种和开抢时间

执行：

```powershell
pnpm run setindex
```

按提示选择要抢的票种和开始抢票的时间。这里一次只能选一种票；如果想改，重新执行一遍 `pnpm run setindex` 就行。

强烈建议每次运行脚本前都先跑一遍 `pnpm run setindex`。这样能顺手确认票种、日期和开抢时间没有选错（每一轮开票之前都会变的）。

### 7. 开始运行

执行：

```powershell
pnpm start
```

启动后，脚本会打开配置好的浏览器，进入对应活动页面并开始轮询。发现可售票后，它会继续走到确认订单页并提交订单。

到支付页后脚本会停下，并打开提醒 URL。**支付不会自动完成，需要你自己处理。我这里做的是跳转到指定视频，播放声音，请自行修改。**

## 重置统计

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

### 运行时提示“[out] 正在现有的浏览器会话中打开。”怎么办？

这通常说明上一次打开的浏览器没有彻底退出，或者还有别的抢票进程正在跑。

先手动关闭 Chrome/Edge。Mac 用户注意，只点窗口左上角关闭不一定够，需要在 Dock 栏右键浏览器图标，然后点“退出”。

如果关掉浏览器后还是提示这句话，就打开系统的任务管理器或活动监视器，结束残留的 Chrome/Edge 进程，以及还在运行的 `pnpm start`、`node` 抢票进程，然后再重新启动。

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
