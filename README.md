# dsh-restart-systemd

> **_English summary._**
> A DeepSeek Harness WebUI **restart button** (Linux/WSL **and** Windows). It adds a
> sidebar-footer trigger next to the remote-web-ui phone icon. The dialog offers two
> intents: **restart now** (interrupts whatever runs) and **restart when idle** (queues
> the request and fires only after every session has finished, so you can click the
> moment a plugin changed and walk away). Linux/WSL runs `systemctl --user restart
> dsh-web`; Windows hands the relaunch to a detached watcher that waits for this exact
> pid and then runs your launcher script. Duplicate requests are refused (**409**),
> non-loopback callers are refused (**403**), and a one-shot flag plus a 15-second
> suppression window prevents restart loops. After a **202** the plugin paints no
> waiting or "accepted" surface: DSH's own connection indicator owns the outage. The
> button never reconnects, resumes turns, or reloads the page.

**GitHub topics**: `dsh` · `dsh-plugin` · `restart` · `systemd` · `wsl` · `windows`

---

## 设计总览

双面插件（host + browser）：

| 半边 | entry（exports） | 运行环境 | 职责 |
|------|------------------|----------|------|
| host | `"."` → [lib/index.js](./lib/index.js) | node（宿主导入） | 注册受 loopback 保护的 `/api/restart-dsh`（POST 调度 / GET 查排队 / DELETE 取消）；单飞；写 flag；按平台执行重启 |
| client | `"./client"` → [lib/client/index.js](./lib/client/index.js) | 浏览器（WebUI） | 侧边栏 footer 触发器、双模式确认框、排队卡片、错误气泡（**不画等待/恢复界面**） |

```
src/
  index.ts                 # host apply(): exact route + body/security handling
  host/gate.ts             # loopback fence (Host / Origin / Sec-Fetch-Site)
  host/restart.ts          # flag, single-flight, queue, 3s timer, platform act
  host/windows.ts          # launcher config + detached PowerShell watcher
  client/index.ts          # client apply(): locale + sidebar.footer.action
  client/RestartButton.tsx # trigger + confirm dialog + queued card + error bubble
  client/api.ts            # POST/GET/DELETE helpers with a 10s AbortController
```

内部依赖：官方 socket `sidebar.footer.action`（list/root additive，remote-web-ui 电话图标同座）；客户端上下文与 slot 服务类型来自 `@deepseek-ai/cordis` 的 `Context` + `dsh-client-ui-renderer` 的声明合并。host 只 `inject` `webServer` 与 `subprocess`；agent 注册表通过 `ctx.get('agents')` 无类型读取，`appExit` 只在 Windows 分支通过 `ctx.get('appExit')` 读取，缺失时明确报错而不是裸退。**不注入** `connection`、`commands`、`session`。

## 行为

1. 侧边栏 footer 出现重启图标（`wide` 与 `rail` 两种侧栏都可用）；点击打开确认框。
2. 确认框给出**两个选择**：
   - **「立即重启」** —— 不管有没有会话在跑，3 秒后重启，会中断进行中的任务；
   - **「等会话结束后重启」** —— 如果有会话在跑就**排队**，等全部会话跑完（并且空闲持续 5 秒）后再自动重启；如果当前没有会话在跑，就等同于立即重启。
   文案强调「立即重启」不会自动续接任务，这正是第二个按钮存在的理由：改完插件当场点，然后就不用再记着回来点了。
3. 点任一按钮后确认框**立即关闭**，只有按钮自己转圈并禁用（防重复提交）；请求只发一次。
4. 请求被接受：
   - **立即重启**（`202 {scheduled:true,delayMs}`）→ **不再显示任何界面**，按钮回到常态。断开与重连由 DSH 自己的连接指示器（侧边栏 footer 的「重新连接中 / 连接成功」）叙述；本插件不画等待遮罩、不画「已接受」卡片、不轮询、不自动刷新页面、不自动续接会话。
   - **排队**（`202 {queued:true,waitingForSessions}`）→ 弹出一张 `role="status"` 的轻量卡片：「已安排重启 / 所有会话跑完后会自动重启。可以直接关掉这个窗口」。卡片带「取消这次重启」（发 `DELETE`）和 × 关闭；**× 只隐藏卡片**，触发器仍高亮标记（`data-dsh-restart-queued`），再点触发器就把卡片叫回来（不重发请求）。排队期间每 5 秒 `GET` 一次刷新等待会话数；宿主报「无排队」时卡片自动消失。
5. `409` → 已有请求在处理；`429` → 重启后的抑制窗口内；`403` → 非 loopback；`501` → 平台不支持；`500` → 调度准备、flag 写入或（Windows）watcher/启动器准备失败。这些情况在按钮旁弹出一个 `role="alert"` 轻量气泡（320px，不遮罩页面、不阻断操作），点 × 关闭。
6. 网络断线或 10s 超时 → 同一个气泡显示 **「无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试。」**，不把结果谎报为成功或失败。
7. 关闭气泡即释放忙锁，可再次打开确认框；请求本身已经由服务端接管，客户端不会因 3s 内还没重启就重复发送。

## 平台

| 平台 | 动作 | 状态 |
|------|------|------|
| Linux / WSL | `systemctl --user restart dsh-web`（经 `ctx.subprocess`，固定 argv，无 shell） | 支持 |
| Windows | 写 flag → `wscript.exe` 起**脱离父进程**的 PowerShell watcher → `ctx.get('appExit')(0)` | 支持（需配置启动器） |
| 其它（darwin 等） | 不动作 | **501 `unsupported-platform`** |

### Windows 是怎么重启的

Windows 没有可调的服务管理器，DSH 进程内也没有 self-restart 钩子（cordis-plugin-loader 的 `exit()` 是空实现），唯一优雅退出入口是 `ctx.get('appExit')`。所以顺序必须是「**先安排好谁来拉起来，再退出**」：

1. 写 `$DSH_HOME/dsh-restart.flag`（与 Linux 共用）；
2. 解析启动器路径（见下）；
3. 取 `ctx.get('appExit')`（`dsh-cmdline` 提供）；
4. 生成 `$DSH_HOME/dsh-restart-watcher.ps1` 与 `dsh-restart-watcher.vbs`，然后用 `detached` 方式启动 `wscript.exe //Nologo <vbs>`，由 VBS 用 `WScript.Shell.Run` 隐藏启动 PowerShell watcher；
5. 只有 watcher **启动成功后**才 `appExit(0)`。任何一步失败（没有配置启动器、`appExit` 不存在、watcher 起不来）都只记 **error 日志 + 清掉本次 flag + 保持进程存活**，绝不出现「退掉了但没人拉起来」。

**为什么要绕一层 `wscript.exe`**：本机实测，node 用 `child_process.spawn('powershell.exe', ..., { detached: true })` 启 PowerShell，子进程会**立刻以 exit 0 结束且脚本一行都不执行**（`-File`、`-Command`、`-NoProfile`、`-NonInteractive`、`-ExecutionPolicy Bypass`、`windowsHide` 开或关、有无 `cwd` 全都一样；换成 node 子进程或纯 VBS 则正常）。`wscript.exe` 跑 VBS 是唯一稳定可用的路径，也正好是桌面启动器快捷方式本来就在走的链路（`.lnk` → `start-dsh-native.vbs` → `wscript.exe` → PowerShell）。

另一个坑：`powershell.exe` 和 `wscript.exe` 都会把**无 BOM 的脚本按 ANSI 代码页解码**，用户目录里只要有中文（`C:\Users\张三\.dsh`）路径就会被转成乱码。所以 `.ps1` 写成 UTF-8 **带 BOM**，`.vbs` 写成 **UTF-16LE 带 BOM**——这两种是两种宿主都认的编码。

watcher 的逻辑（[src/host/windows.ts](./src/host/windows.ts)）：

- **按 pid 等待，不按端口**：`Get-Process -Id <旧 pid>` 消失才继续。这一点是硬要求——绕过启动器另起的 DSH 同样占着端口，按端口判断会在旧进程还活着时就启动第二个实例。
- **只认「没有这个进程」为消失**：查询用 `-ErrorAction Stop`，catch 里只有 `CategoryInfo.Category -eq 'ObjectNotFound'` 才算消失。查询失败（权限不足等）**不算消失**，只记一次日志继续等——把「问不到」当成「已经退出」会在宿主还占着端口时去拉启动器，启动器回答「already running」然后宿主才退出，结果又是没人拉起。
- **watcher 与宿主必须同一个用户上下文**：本机实测，受限令牌下 `Get-Process -Id <正常用户启动的 pid>` 会返回 `ObjectNotFound`（进程其实活着）。watcher 是宿主的子进程，天然继承宿主的令牌，所以正常路径没问题；但如果你把 DSH 跑在沙箱/另一用户的会话里，watcher 就会「看不见」宿主而提前去拉起启动器，启动器回 "already running"，宿主随后退出、没人接。
- 复用保护：若该 pid 的 `StartTime` 晚于 watcher 启动时间，说明 pid 被新进程复用，直接当作旧进程已消失。
- 最多等 **120 秒**，超时写日志并 `exit 1`（不会去拉起）。
- 旧进程消失后再等 800ms 让端口释放，然后按扩展名用 `Start-Process -PassThru` 把启动器**当独立进程**跑：`.ps1` → `<powershell> -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "<path>"`；`.cmd` / `.bat` → `<cmd.exe> /c "<path>"`；其它 → 直接运行该文件。
- **先记「已启动」，再等退出码**：`Start-Process` 成功后立刻写 `the launcher was started (pid N)`，之后才等退出码。这样即使 watcher 后半段出问题，日志也已经证明「宿主被交接出去了」，不会出现「日志停在 running the launcher、完全不知道发生了什么」。
- **不用 `-Wait`**：实测 `Start-Process -Wait` 会等到启动器的**子进程**也结束（启动器里挂一个 22 秒的子进程，`-Wait` 就等了 22 秒），而启动器的子进程就包括新宿主（要跑几小时）。改用 `WaitForExit(180000)` 有界等待：拿到退出码就记下来，超时则写 `the launcher is still running after 180s; watcher is not waiting for it` 然后自己退出。
- 为什么不 dot-call：启动器里有 `exit 1`，dot-call 会把 watcher 也一起退掉，日志断在「running the launcher」，事后完全看不出为什么机器没起来。独立进程能拿到 exit code 并写进日志（`the launcher exited with code N`）；连启动都失败（路径不存在）会写 `the launcher could not be started: ...`。

## Host 契约

- 只注册 **exact** `/api/restart-dsh`，三个方法：
  - `POST` → 调度（body `{reason?, mode?}`，`mode` ∈ `'now'|'when-idle'`，缺省 `now`）；
  - `GET|HEAD` → `200 {queued: <PendingRestart|null>, armed: <boolean>}`；
  - `DELETE` → `200 {cancelled: <boolean>}`，取消排队中的重启；
  - 其它方法 → `405`。
- 没有 `/restart` 命令、没有恢复快照、没有 agent 续接。
- 安全：**三个方法都先过** `isLoopbackRequest`，拒绝非 loopback Host、非 loopback socket、`sec-fetch-site: cross-site`、不同源 Origin；不信任 `X-Forwarded-For`。`403 forbidden: loopback-only`。
- 请求体：空 body 允许；非 JSON content-type → **415**；无效 JSON / 读流异常 → **400**；超过 1MB → **413**；`mode` 不是那两个值 → **400 `invalid-mode`**。所有读取异常都在 handler 内收敛，不产生 unhandled rejection。
- 调度：`schedule(reason, mode)` 是 async：先立单飞锁，再 `await` 写 flag（`{ reason, ts }`），成功后才启动 **3000ms** timer 并回 **202**；调度准备或写失败回 **500**，不动作，清理本次 flag 后才释放锁，之后可重试。
- `when-idle`：读 `ctx.get('agents').list()` 里 `status === 'running'` 的个数。>0 → 入队并回 `202 {queued:true, waitingForSessions}`；**注册表读不到时回 500 而不是盲重启**（「不打断会话」正是这个模式的全部意义）。**idle 且 5 秒内保持 idle** 才真正 arm；settle 窗口里又开新会话就继续排队。排队每 **2000ms** 复查一次。
- 已接受后到动作结束保持锁；重复请求 **409 `already-scheduled`**（排队中再点也是 409）。`dispose` 永久关闭 scheduler，清 timer 与队列，并尽力删除尚未动作的本次 flag（只在 `flagTs` 仍是本次时间戳时删）。
- boot：`initialize()` 消费残留 flag（兼容旧 flag 的多余字段），删除 flag 与旧版 `dsh-restart-resume.json`，并在 **15000ms** 内把请求回为 **429 `suppressed`**。请求会 `await` 这个初始化 promise，boot 竞争不会漏掉抑制。

### 状态文件（`$DSH_HOME` → `~/.dsh`）

| 文件 | 用途 |
|------|------|
| `dsh-restart.flag` | 一次性 boot token `{ reason, ts }`；重启后排空时留在磁盘（Windows 分支刻意保留），由下一次 boot 消费并开 15s 抑制窗口 |
| `dsh-restart-resume.json` | 旧版遗留文件，仅启动时删除；本版不读取、不写入 |
| `dsh-restart-watcher.ps1` | Windows 专用；每次重启覆盖写入的 watcher 脚本（UTF-8 带 BOM） |
| `dsh-restart-watcher.vbs` | Windows 专用；用 `wscript.exe` 启动上面那个脚本的壳（UTF-16LE 带 BOM） |
| `dsh-restart-watcher.log` | Windows 专用；watcher 自己追加的进度日志（等谁、何时超时、启动了哪个启动器） |
| `dsh-restart.json` | Windows 专用配置，见下 |

## Windows 配置

插件不知道你的 DSH 是怎么被拉起来的，必须告诉它。二选一：

```jsonc
// $DSH_HOME/dsh-restart.json   (~/.dsh/dsh-restart.json)
{ "windowsLauncher": "F:\\AIProjects\\launchers\\native\\start-dsh-native.ps1" }
```

或设置环境变量 `DSH_RESTART_WINDOWS_LAUNCHER`（优先于配置文件）。

启动器调用方式按扩展名决定（都以独立进程运行，见上）：`.ps1` → `powershell -NoProfile -ExecutionPolicy Bypass -File "<path>"`；`.cmd` / `.bat` → `cmd.exe /c "<path>"`；其它 → 直接运行该文件。

**启动器脚本本身要满足「进程不在时它会启动一个新的」**。本仓库实测过的 `launchers/native/start-dsh-native.ps1` 正是如此：端口没监听 → 轮转日志 → `Start-Process dsh web ...` → 等 token 行 → 开窗。它没有 `-Restart` 开关，也不需要——watcher 保证了旧进程已经退出，脚本自然走「端口空」那条分支。

注意：不要把「启动器」配成一个只会 `stop` 的脚本；那样退出之后就没人拉起来了。插件不会自己 `spawn 'dsh web'`（会与启动器的单实例判断、日志轮转、token 提取逻辑打架）。

## 安装

```bash
cd dsh-restart-systemd
npm ci
npm run build          # tsc -b → lib/，再写 lib/client/index.js 与 lib/client.js

# 装入 web profile（会应用 package.json 的 dsh.bundle.patch）
# --config.auto-install-peers=false：pnpm 8 起 auto-install-peers 默认开启，会顺着 peer 列表
# 现抓 @deepseek-ai/* 运行时包；registry 上没有对应版本时整条命令直接失败
dsh plugin --profile web add link:$PWD --config.auto-install-peers=false
```

**装完必须重启宿主进程一次**（插件改动不走 HMR；host 侧入口与 client bundle 都换新了）：

- Linux/WSL：`systemctl --user restart dsh-web`
- Windows：关掉 DSH 进程后用你的启动器重新起，或——装好本插件并配好 `windowsLauncher` 之后——直接点按钮的「立即重启」让它自己完成一次。

`npm run build` 里的 `scripts/build-client.mjs` 用 esbuild JS API，需要**当前平台**的 esbuild 二进制（`node_modules/@esbuild/<platform>-<arch>`）。在 WSL 装的仓库拿到 Windows 上用会报 "You installed esbuild for another platform"；在 Windows 上 `npm install` 一次即可重装对应平台二进制。

## 验证

```bash
npm test             # build + client + host
npm run test:client  # bundle 接线 / 双模式文案 / 无连接钩子 / SSR / locale 键集合
npm run test:host    # exact route / gate / 202-409-429-501-500 / flag / 队列 / 平台矩阵 / Windows 分支
npm run typecheck
```

两套测试都**不启动真实 systemctl、不启动 PowerShell watcher、不向 3081 或真实 profile 发请求**：
- [scripts/verify-host.mjs](./scripts/verify-host.mjs)（**153 checks**）用真实 loopback HTTP + `subprocess.spawn` 硬替身 + `setDetachedSpawner` 假 detach，`DSH_HOME` 全部指向临时目录，`RestartScheduler` 直接注入毫秒级 `delayMs/pollMs/settleMs` 与 `platform`。覆盖：路由与方法矩阵、5 种鉴权拒绝、`invalid-mode`、单飞、boot 抑制、flag 写失败、Linux argv/延迟/日志/失败清理、平台矩阵、Windows 五条失败路径（无启动器 / 有启动器 / 同步与异步的 watcher 起不来 / 无 `appExit`）并断言 watcher 脚本里是 `Get-Process -Id $OldPid -ErrorAction Stop`、只把 `ObjectNotFound` 当消失（权限失败要继续等）、且**没有** `Get-NetTCPConnection`/`netstat`、VBS 壳与两种脚本的编码（UTF-16LE BOM / UTF-8 BOM）、启动器按扩展名以独立进程运行、用有界 `WaitForExit` 而非 `-Wait`、先记「已启动」再等退出码、源码里没有漏进来的 TypeScript 表达式（`String(`/`undefined`/`${`）、`when-idle` 排队/触发/settle 推迟/取消/注册表缺失、`dispose`、race 探针。
- [scripts/verify-client.mjs](./scripts/verify-client.mjs)（**73 checks**）通过 loader 协议加载 [lib/client/index.js](./lib/client/index.js)，检查运行时 require 仅 `react`、`react-dom`、`react/jsx-runtime`，再做 SSR 渲染与中英字典覆盖（en/zh 键数一致，现 17 键，无孤立键，`role="status"` 恰好一处）；它是**接线/文案级**验证，不是浏览器点击验证。
- 浏览器交互见下节。

### Windows watcher 冒烟验证（手动跑过，不在 npm test 内）

watcher 是真的会去拉进程的代码，值得在真机上验一次。做法（Windows PowerShell）：

```powershell
# 起一个 5 秒后自己退出的进程冒充 DSH 宿主，剩下的交给插件自己的函数
node -e "import('file:///.../lib/host/windows.js').then(async (m) => {
  const { spawn } = await import('node:child_process')
  const victim = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 5000)'], { stdio: 'ignore' })
  const started = await m.startWatcher({ home: process.env.USERPROFILE + '\\.dsh', launcher: 'F:\\path\\to\\fake-launcher.ps1', pid: victim.pid })
  console.log(started.logPath)
})"
```

2026-11-16 在 Windows 上实测通过的分支：

| 场景 | 结果 |
|------|------|
| 目标进程 5 秒后退出 | watcher 等它消失 + 800ms，调启动器，日志记 `the launcher exited with code 0` |
| 目标 pid 启动前就已不存在 | 立即调启动器 |
| 目标进程一直活着（把 120s 临时改 2s） | 写 `timed out waiting for the old process`，`exit 1`，**不调启动器** |
| 启动器是 `exit 3` 的脚本 | 记 `the launcher exited with code 3`，watcher 自己正常退出 |
| 启动器路径不存在 | 记 `the launcher exited with code -196608`（PowerShell 的 `-File` 找不到文件） |
| 启动器路径含中文与空格 | 正常调用（BOM 编码生效） |
| **父进程（冒充宿主）startWatcher 后立刻 `process.exit(0)`** | watcher 存活，父进程消失后被拉起，日志完整 |
| 启动器自己挂一个 30 秒的子进程后 `exit 7` | 2 秒就记 `the launcher exited with code 7`（有界等待，不等子进程） |
| 同上，但用的是旧写法 `Start-Process -Wait` | `-Wait` 等了 **31.3 秒**才返回——这就是去掉 `-Wait` 的理由 |
| 真实宿主（2026-11-16 23:42 按下按钮） | `watching pid 24316` → `old process is gone` → 启动器起 pid 57844 → 23:43:28 `ready` |

`dsh-restart-watcher.log` 逐行可读（「watching pid N」「old process is gone; running the launcher」「the launcher exited with code N」「watcher finished」），出事时先看它——**它不存在就说明连 VBS 壳都没跑起来**（第一次踩到的正是这个：脚本写了，日志一条没有）。

### 浏览器验证（单独运行，不进入 npm test）

```bash
npm run fixture
# 复制输出的 FIXTURE_URL
node scripts/verify-ui-browser.mjs --url <FIXTURE_URL> --task-space <隔离任务名>
```

覆盖：确认框两个按钮、取消不发请求、**立即重启在有会话时也立刻发**（`mode=now`，不排队、不画任何界面）、**等会话结束时排队**（`mode=when-idle`，卡片文案 + 触发器高亮 + 不弹 alert）、× 隐藏后触发器再叫回卡片（不重发请求）、「取消这次重启」真的发 `DELETE` 并清宿主队列、空闲宿主上 when-idle 立即执行、刷新页面后重新读到排队、宿主报队列消失后卡片自动消隐、409/429/403/501/500 五种气泡、断线未知、10s 超时、双击只发一次、wide/rail 两种宽度。

夹具（[scripts/ui-fixture.mjs](./scripts/ui-fixture.mjs)）只 mock `/api/restart-dsh` 的 POST/GET/DELETE，另加 `/__mode` / `/__sessions` / `/__state` 控制面，**不连接当前 GUI、不调用真实 systemctl、不启动 PowerShell**。它绑定 `0.0.0.0` 只是为了另一台主机（例如 Windows）上的 ego-browser 能访问 WSL 内的夹具；它不是 DSH 服务，也不是插件的监听面。

- `--ego <command>` 或 `EGO_BROWSER` 可指定 ego-browser（默认 `ego-browser`）；脚本生成浏览器脚本并通过 stdin 交给 `ego-browser nodejs`，不写入仓库。
- 需要预构建夹具 bundle 时（例如 esbuild 无法 spawn 的受限环境）：先用 `esbuild scripts/ui-fixture-entry.tsx --bundle --format=iife --platform=browser --jsx=automatic --define:process.env.NODE_ENV='"development"' --outfile=<file>` 生成，再 `FIXTURE_BUNDLE=<file> npm run fixture`。

## HTTP API

| 情况 | 状态码 | body 关键字段 |
|------|--------|----------------|
| 立即重启已排定 | 202 | `{scheduled:true, delayMs:3000}` |
| 排队等待会话结束 | 202 | `{scheduled:true, queued:true, waitingForSessions:N}` |
| 队列状态查询 | 200 | `{queued: {reason,requestedAt,waitingForSessions} \| null, armed:boolean}` |
| 取消排队 | 200 | `{cancelled:boolean}` |
| 已有请求在途 / 已在排队 | 409 | `already-scheduled` |
| boot 后 15s 内 | 429 | `suppressed` |
| 非 loopback / 跨源 | 403 | `forbidden: loopback-only` |
| 平台不支持（darwin 等） | 501 | `unsupported-platform` |
| 调度准备、flag 写入、Windows 前置条件失败 | 500 | `restart-failed` |
| agent 注册表不可读（when-idle） | 500 | `restart-failed` |
| 非 POST/GET/HEAD/DELETE | 405 | 受控错误 |
| 非 JSON content-type | 415 | 受控错误 |
| 无效 JSON / 读流失败 | 400 | `invalid-json` / `invalid-body` |
| `mode` 取值非法 | 400 | `invalid-mode` |
| body 超过 1MB | 413 | `body-too-large` |

## 回滚

```bash
dsh plugin --profile web remove dsh-restart-systemd --config.auto-install-peers=false
# 然后重启宿主进程
# 可选：清理残留状态
rm -f ~/.dsh/dsh-restart.flag ~/.dsh/dsh-restart-resume.json ~/.dsh/dsh-restart-watcher.ps1 ~/.dsh/dsh-restart-watcher.log ~/.dsh/dsh-restart.json
```

回滚后按钮消失，不改动其它配置。

## 已知限制

- **平台**：支持 Linux/WSL 与 Windows；其它平台 501。
- **Linux 服务单元固定**：argv 恒为 `systemctl --user restart dsh-web`；若以其它方式启动 DSH，spawn 会失败并记日志，不会产生重启。
- **Windows 必须有启动器**：没配 `windowsLauncher`／`DSH_RESTART_WINDOWS_LAUNCHER` 时按钮会 500 并打印该配哪个文件；插件不会自己拉 `dsh web`。
- **Windows 重启会重启整个宿主进程**，不只是 WebUI；watcher 只等 120 秒，超时就不拉起（只留日志）。
- **排队只认 agent 状态**：`when-idle` 依据 `ctx.agents.list()` 的 `running` 个数，settle 窗口 5 秒防「前一个会话结束、下一个立刻开始」时被打断。若某个后台任务不在 agent 注册表里（例如独立于会话的批处理），排队看不到它。
- **不自动续接、不自动刷新**：被中断的 agent 任务不会恢复；页面是否恢复、何时恢复由 DSH 连接层决定，本插件不轮询连接、不 `location.reload`、不注入 `Continue.`。改了 **client** 侧代码时，重启后仍需手动刷新页面让浏览器拿到新 bundle。
- **不显示等待/恢复界面**：202 之后（立即重启）插件什么都不画；只有排队态会显示一张可关闭的 `role="status"` 卡片，因为它描述的是宿主上真实挂着的待办。
- **已接受 ≠ 已重启**：202 只表示 flag 已写、timer 已排（或已排队）；之后的失败只体现在日志与 watcher 日志里，没有查询接口。客户端在网络未知时会明确提示这一点。
- **单飞只在同一调度器实例**：flag + boot 抑制用于防跨重启循环；热重载会产生新实例，两个实例共享 `DSH_HOME` 时不保证 flag 读写跨实例原子性，也不提供跨实例锁。排队状态同理只活在单个实例里。
- **UI 验证边界**：SSR/HTTP 替身不能替代真实浏览器；浏览器验证使用隔离夹具和 [scripts/verify-ui-browser.mjs](./scripts/verify-ui-browser.mjs)，不会打开当前 GUI。

## License

MIT — see [LICENSE](./LICENSE).
