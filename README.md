# dsh-restart-systemd

> **_English summary._**
> A DeepSeek Harness WebUI **restart button** (Linux/WSL systemd edition). It adds a
> sidebar-footer restart trigger **next to the remote-web-ui phone icon**. Clicking it
> asks for confirmation, then schedules `systemctl --user restart dsh-web` about 3
> seconds later, so the browser receives its **202** first. Duplicate requests are
> refused (**409**), non-loopback callers are refused (**403**), and a one-shot flag
> file plus a 15-second suppression window prevents restart loops. The button never
> tries to reconnect, resume interrupted turns, or reload the page: after **202**, the
> normal DSH connection state is the source of truth. Platform: **Linux / WSL only**.

**GitHub topics**: `dsh` · `dsh-plugin` · `restart` · `systemd` · `wsl`

---

## 设计总览

双面插件（host + browser）：

| 半边 | entry（exports） | 运行环境 | 职责 |
|------|------------------|----------|------|
| host | `"."` → [lib/index.js](./lib/index.js) | node（宿主导入） | 注册受 loopback 保护的 `POST /api/restart-dsh`；单飞；写 flag；3s 后 spawn 固定 systemctl argv |
| client | `"./client"` → [lib/client/index.js](./lib/client/index.js) | 浏览器（WebUI） | 侧边栏 footer 重启按钮、确认框、请求状态与文案 |

```
src/
  index.ts                 # host apply(): exact route + body/security handling
  host/gate.ts             # loopback fence (Host / Origin / Sec-Fetch-Site)
  host/restart.ts          # flag, single-flight, 3s timer, fixed systemctl argv
  client/index.ts          # client apply(): locale + sidebar.footer.action
  client/RestartButton.tsx # button + confirm dialog + result states
  client/api.ts            # POST helper with a 10s AbortController
```

内部依赖：官方 socket `sidebar.footer.action`（list/root additive，remote-web-ui 电话图标同座）；客户端上下文与 slot 服务类型来自 `@deepseek-ai/cordis` 的 `Context` + `dsh-client-ui-renderer` 的声明合并。**不注入** `connection`、`commands`、`agents`、`systemPrompt`。

## 行为

1. 侧边栏 footer 出现重启图标（`wide` 与 `rail` 两种侧栏都可用）；点击打开确认框。
2. 确认文案：**「重启将中断进行中的任务，不会自动续接。建议任务完成后操作。」**（英文对应项见 [src/client/index.ts](./src/client/index.ts)）。
3. 确认后按钮进入 `requesting` 并禁用，弹窗不可关闭；请求只发一次。
4. `202` → 显示 **「重启请求已接受，后续连接状态由 DSH 显示」**。不等待恢复、不轮询、不自动刷新页面、不自动续接会话。
5. `409` → 已有请求在处理；`429` → 重启后的抑制窗口内；`403` → 非 loopback；`501` → 非 Linux；`500` → 调度准备或 flag 写入失败、调度器已 `dispose`（受控错误）。
6. 网络断线或 10s 超时 → 显示 **「无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试。」**，不把结果谎报为成功或失败。
7. `accepted` / `error` 是终态：可关闭弹窗、释放忙锁、再次打开；请求本身已经由服务端接管，客户端不会因 3s 内还没重启就重复发送。

## Host 契约

- 只注册 **exact** `POST /api/restart-dsh`；没有 `/restart` 命令、没有恢复快照、没有 agent 续接、没有状态查询 API。
- 安全：`isLoopbackRequest` 拒绝非 loopback Host、非 loopback socket、`sec-fetch-site: cross-site`、不同源 Origin；不信任 `X-Forwarded-For`。`403 forbidden: loopback-only`。
- 请求体：空 body 允许；非 JSON content-type → **415**；无效 JSON / 读流异常 → **400**；超过 1MB → **413**。所有读取异常都在 handler 内收敛，不产生 unhandled rejection。
- 调度：`schedule(reason)` 是 async：先立单飞锁，再 `await` 写 `$DSH_HOME/dsh-restart.flag`（`{ reason, ts }`），成功后才启动 **3000ms** timer 并回 **202 `{scheduled:true,delayMs:3000}`**；调度准备或写失败回 **500**，不 spawn，清理本次 flag 后才释放锁，之后可重试。
- 已接受后到 spawn 或失败清理结束保持锁；重复请求 **409 `already-scheduled`**。`dispose` 永久关闭该 scheduler，清 timer，并尽力删除尚未 spawn 的本次 flag（只在 `flagTs` 仍是本次时间戳时删）；dispose 发生在初始化、写 flag 或请求体读取期间时，恢复后返回受控错误且不安装 timer，若本次 flag 已写则清理。
- spawn 参数固定为 `['systemctl','--user','restart','dsh-web']`，`cwd=process.cwd()`，`stdin:'ignore'`、stdout/stderr inherit、`graceMs=10000`；不自行拉进程、不拼接 shell。
- 延迟 spawn 的同步 throw、done reject、非 0 退出、定时器安装失败：只记可见日志（error/warn），**不会**把已经发出的 202 改成 500；失败时清理本次 flag，并在同一 attempt 的清理完成后才释放单飞锁，允许用户重试。所有异步链都 catch；日志器本身抛错不逃逸。
- boot：`initialize()` 消费残留 flag（兼容旧 flag 的多余字段，例如 `sessionIds`），删除 flag 与旧版 `dsh-restart-resume.json`，并在 **15000ms** 内把请求回为 **429 `suppressed`**。请求会 `await` 这个初始化 promise，boot 竞争不会漏掉抑制。
- 平台：仅 `process.platform === 'linux'`（含 WSL）支持；其他平台 **501 `unsupported-platform`**，不 spawn。

### 状态文件（`$DSH_HOME` → `~/.dsh`）

| 文件 | 用途 |
|------|------|
| `dsh-restart.flag` | 一次性 boot token `{ reason, ts }`；成功重启后留在磁盘，由下一次 boot 消费 |
| `dsh-restart-resume.json` | 旧版遗留文件，仅启动时删除；本版不读取、不写入 |

## 安装

```bash
cd dsh-restart-systemd
npm ci
npm run build          # tsc -b → lib/，再写 lib/client/index.js 与 lib/client.js

# 装入 web profile（会应用 package.json 的 dsh.bundle.patch）
dsh plugin --profile web add link:$PWD

# 无热重载，需重启生效
systemctl --user restart dsh-web
```
`exports."."` → [lib/index.js](./lib/index.js)；`exports."./client"` → [lib/client/index.js](./lib/client/index.js)；`main`/`types` 与之对应。仓库同时保留 [lib/client.js](./lib/client.js) 作为浏览器 bundle 的构建产物。

### 依赖版本

devDependencies 对齐 **DSH 0.1.7-rc.1**，Node `^22.19.0 || >=24.0.0`。host 不需要 `dsh-commands`、`dsh-agent`、`dsh-session`、`dsh-llm`；client 不需要 `dsh-client-connection`。

## 验证

```bash
npm test             # build + client + host
npm run test:client  # bundle 接线 / 无连接钩子 / SSR / locale 键集合
npm run test:host    # exact route / gate / 202-409-429-501-500 / flag / spawn 替身
npm run typecheck
```

两套测试都**不启动真实 systemctl、不向 3080 或真实 profile 发请求**：
- [scripts/verify-host.mjs](./scripts/verify-host.mjs) 用真实 loopback HTTP + `subprocess.spawn` 硬替身，`DSH_HOME` 全部指向临时目录；覆盖取消/单飞/延迟/flag 失败/平台拒绝/spawn 失败日志/dispose 与请求体或 flag 写入期间的清理/清理期间 409/清理后重试/unhandled=0。
- [scripts/verify-client.mjs](./scripts/verify-client.mjs) 通过 loader 协议加载 [lib/client/index.js](./lib/client/index.js)，检查运行时 require 仅 `react`、`react-dom`、`react/jsx-runtime`，再做 SSR 渲染与中英字典覆盖；它是**接线/文案级**验证，不是浏览器点击验证。
- 浏览器交互（确认、取消、双击、202/409/429/403/501/500、断线未知、10s 超时、关闭重开、wide/rail）通过 [scripts/ui-fixture.mjs](./scripts/ui-fixture.mjs) + [scripts/ui-fixture-entry.tsx](./scripts/ui-fixture-entry.tsx) 的临时静态 React 夹具，在隔离浏览器 TaskSpace 中运行 [scripts/verify-ui-browser.mjs](./scripts/verify-ui-browser.mjs) 验证；夹具只 mock `/api/restart-dsh`，不连接当前 GUI、不调用真实 systemctl。
- 夹具绑定 `0.0.0.0` 只是为了另一台主机（例如 Windows）上的 ego-browser 能访问 WSL 内的夹具；它不是 DSH 服务，也不是插件的监听面。浏览器脚本需要外部 ego-browser，不进入 `npm test`，也不硬编码浏览器路径。

### 浏览器验证（单独运行，不进入 npm test）

```bash
npm run fixture
# 复制输出的 FIXTURE_URL
node scripts/verify-ui-browser.mjs --url <FIXTURE_URL> --task-space <隔离任务名>
```

`--ego <command>` 或 `EGO_BROWSER` 可指定 ego-browser（默认 `ego-browser`）。脚本生成 Node 脚本源码并通过 stdin 交给 ego-browser，不写入仓库；它覆盖确认/取消、双击、202/409/429/403/501/500、断线未知、10s 超时、关闭重开和 wide/rail。脚本在 TaskSpace 持有段包 `try/finally`，成功或失败都会 `finish({ keep: [] })` 清理本次任务。本次已在隔离 TaskSpace 实际运行 32/32（`finished=true`）；fixture server 与 job 已终止，不打开当前 GUI。

## HTTP API

| 情况 | 状态码 | body 关键字段 |
|------|--------|----------------|
| 接受调度 | 202 | `{scheduled:true, delayMs:3000}` |
| 已有请求在途 | 409 | `already-scheduled` |
| boot 后 15s 内 | 429 | `suppressed` |
| 非 loopback / 跨源 | 403 | `forbidden: loopback-only` |
| 非 Linux | 501 | `unsupported-platform` |
| 调度准备/flag 写入失败、已 dispose | 500 | `restart-failed` |
| 非 POST | 405 | 受控错误 |
| 非 JSON content-type | 415 | 受控错误 |
| 无效 JSON / 读流失败 | 400 | `invalid-json` / `invalid-body` |
| body 超过 1MB | 413 | `body-too-large` |

## 回滚

```bash
dsh plugin --profile web remove dsh-restart-systemd
systemctl --user restart dsh-web
# 可选：清理残留状态
rm -f ~/.dsh/dsh-restart.flag ~/.dsh/dsh-restart-resume.json
```

回滚后按钮消失，不改动其它配置。

## 已知限制

- **仅 Linux/WSL**：没有 Windows helper、没有平台分支；非 Linux 返回 501。
- **服务单元固定**：argv 恒为 `systemctl --user restart dsh-web`；若以其它方式启动 DSH，spawn 会失败并记日志，不会产生重启。
- **不自动续接、不自动刷新**：进行中的 agent 任务会被重启中断；页面是否恢复、何时恢复由 DSH 连接层决定，本插件不轮询、不刷新、不注入 `Continue.`。
- **已接受 ≠ 已重启**：202 只表示 flag 已写、timer 已排；3s 后 spawn 失败只体现在日志中，没有查询接口。客户端在网络未知时会明确提示这一点。
- **单飞只在同一调度器实例**：flag + boot 抑制用于防跨重启循环；热重载会产生新实例，两个实例共享 `DSH_HOME` 时不保证 flag 读写的跨实例原子性，也不提供跨实例锁。`dispose` 清 flag 是 best-effort；进程退出未清时，下一次 boot consume 最多额外抑制 15s。
- **UI 验证边界**：SSR/HTTP 替身不能替代真实浏览器；浏览器验证使用隔离夹具和 [scripts/verify-ui-browser.mjs](./scripts/verify-ui-browser.mjs)，不会打开当前 GUI。

## License

MIT — see [LICENSE](./LICENSE).
