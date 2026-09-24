# dsh-restart-systemd

> **_English summary._**
> A DeepSeek Harness WebUI **restart button** (systemd edition). Adds a sidebar‑footer
> restart trigger **next to the remote‑web‑ui phone icon** plus a `/restart` command.
> Clicking schedules `systemctl --user restart dsh-web` (~3s later, so the browser
> gets its 202 first), dups are refused (**409**), non‑loopback callers are refused
> (**403**), and a flag‑file + residual‑window design prevents restart loops.
> **The reconnect UX belongs to the client runtime, not to this plugin**: the
> ConnectionController's exponential backoff (500ms→10s) and the official
> `ConnectionIndicator` — rendered in the sidebar‑foot settings row — own the outage
> narration and the click‑to‑retry action. This plugin only *consumes*
> `ctx.connection.state`, to reload the page once so the restarted host's client
> bundles actually load. Interrupted agent turns are **auto‑resumed** by the host half.
> Platform: **WSL/Linux → systemctl --user** (primary, tested);
> **Windows → detached helper** branch is present but unused on WSL.

**GitHub topics**（主代理创建仓库时使用）: `dsh` · `dsh-plugin` · `restart` · `systemd`

---

## 设计总览

双面插件（与 `dsh-client-ui-aionui-panel` 同构）：

| 半边 | entry（exports） | 运行环境 | 职责 |
|------|------------------|----------|------|
| host | `"."` → `lib/index.js` | node（宿主导进） | `/api/restart-dsh` 路由、`/restart` 命令、flag/resume 状态、restart-recover |
| client | `"./client"` → `lib/client.js` | 浏览器（WebUI） | 侧边栏 footer 重启按钮 + 二次确认 + 消费核心连接状态触发整页刷新 |

```
src/
  index.ts               # host apply()：串联路由 + 命令 + boot 消费/resume
  host/gate.ts           # loopback fence（照抄 dsh-aionui-panel 的 gate）
  host/restart.ts        # 调度 + 延迟 spawn + 平台分支 + flag/单飞锁
  host/recover.ts        # agent/created -> lastTurnInterrupted -> followup continue
  client/index.ts        # client apply()：locale + sidebar.footer.action 注入 + connection hooks
  client/RestartButton.tsx   # 按钮 + 确认对话框（内联样式，无需 CSS bundle）
  client/api.ts          # POST 助手（只发请求，不做重连探活）
```

内部依赖：官方 socket `sidebar.footer.action`（list/root additive，remote-web-ui 电话图标同座）；客户端上下文与 slot 服务类型来自 `@deepseek-ai/cordis` 的 `Context` + `dsh-client-ui-renderer` 的声明合并。

### 重连由谁负责（v0.2 起）

| 关注点 | 归属 | 说明 |
|--------|------|------|
| 断线检测 / 指数退避重试 | **client runtime** | `ConnectionController`（base 500ms → cap 10s，factor 2），插件不探测、不轮询 |
| 断线提示与「点击立即重连」 | **`ConnectionIndicator`**（`dsh-client-ui-settings-general`） | 渲染在侧边栏底部设置行：`连接异常，点击立即重连` / `重新连接中` / `连接成功`（2s），connecting 最少显示 800ms |
| 重启请求 / 单飞 / 排障文案 | **本插件** | 只负责 `POST /api/restart-dsh`、确认弹窗与 403/409/429/501 的结果呈现 |
| 重连后加载新的前端 bundle | **本插件** | 核心不会刷新页面（runtime 重连传输层但继续跑重启前的 JS），故订阅 `ctx.connection.state`，观察到真实断线→恢复后 `location.reload()` 一次 |

> v0.1 里自研的 `waitForReconnect()`（每 350ms `fetch('/')` + 20s 超时 + `sawDown` 启发式）与 busy/done 分阶文案已删除——它做的事核心做得更准（能区分「真的重连」和「重启前的旧进程还活着」），且 `sessionStorage` 兜底标记随之不再需要。

### 重启流程

1. 点按钮（或输入 `/restart`）→ 二次确认：“进行中的 agent 任务将中断并自动续接。页面会自行重连，并在服务恢复后自动刷新。”
2. 确认 → `POST /api/restart-dsh`（或命令回调）。
3. host 把**当前 running** 的 agent id 快照到 `$DSH_HOME/dsh-restart-resume.json`，写 flag `$DSH_HOME/dsh-restart.flag`，随即回 **202 `{scheduled:true, delayMs:3000}`**。
4. 3s 后 host 用**白名单 argv**（无 shell 拼串）spawn `systemctl --user restart dsh-web`。服务重启；浏览器靠 ConnectionController 指数退避（500ms→10s）**自动重连，无需手动刷新**，核心指示器同步显示断线与恢复。
5. 页面观察到断线→恢复后自动 `location.reload()` 一次（换掉重启前的前端 bundle）；45s 内始终未恢复则弹超时提示并指向 `systemctl --user status dsh-web`。
6. 重启后插件消费（删除）flag token，装上 `agent/created` 监听，读 resume 列表——对每个**最后 turn 被中断**（存在未闭合 `turn/start`，或最近的 `turn/end.reason.kind === 'interrupted'`）的会话，`agent.followup("Continue.")` 自动续接；idle/正常结束的会话绝不打扰。

### 平台三态

| 平台 | 行为 | 代码位置 |
|------|------|----------|
| **WSL** | `process.platform === 'linux'` → `systemctl --user restart dsh-web`（**本机主场景，已实测**） | `restartArgv()` / `platformSupported()` |
| **Linux** | 同上（systemd 用户态） | 同上 |
| **Windows（原生 win32，非 WSL）** | `spawn(process.execPath, [helper, 'win-restart.mjs'])` detached helper，重启可脱离当前进程存活（机器相关，WSL 场景不走此分支） | 同上 |

## 安全（三合一 + 单飞）

- **flag 文件** `$DSH_HOME/dsh-restart.flag`：spawn 前写入，boot 消费一次即删，绝不自行触发重启 → 残留 flag 无法造成二次重启。
- **残留窗口**：插件驱动的 boot（flag 被消费）后 15s 内再次点击 → **429**，防重试乒乓。
- **单飞锁**：已有一发在途时重复 POST → **409**。
- **loopback fence**：socket/Host 非 127.0.0.1/::1 或 `sec-fetch-site === 'cross-site'` 或 Origin 不同源 → **403**；`X-Forwarded-For` 永不被信任。

### 状态文件（`$DSH_HOME` → `~/.dsh`）

| 文件 | 用途 |
|------|------|
| `dsh-restart.flag` | 一次性 boot token `{ reason, ts, sessionIds }` |
| `dsh-restart-resume.json` | 续接列表 `{ ts, reason, sessionIds }` |

---

## 独立仓库 / 发布形态

本目录即一个**独立 Git + npm 包**（社区格式 `dsh-<feature>`，systemd 版包名唯一且表意）：

- `package.json` 已补全：`name: dsh-restart-systemd`、`version: 0.1.0`、`license: MIT`、
  `repository`（GitHub 占位 `https://github.com/<your-org>/dsh-restart-systemd.git`，主代理稍后创建）、
  `keywords`（`['dsh','dsh-plugin','deepseek-harness','restart','systemd','systemctl','wsl','webui']`）、
  `files`（`lib, src, cordis.patch.yml, README.md, LICENSE`）、`dsh.bundle.patch` ⇒ `./cordis.patch.yml`。
- `LICENSE` 已就位（MIT，2026 contributors）。
- `cordis.patch.yml` 注入一行双面插件，安装后 host+client 同时挂载，无需手改 bundle：
  ```yaml
  - insert:
      - id: ui-dsh-restart-systemd
        name: dsh-restart-systemd
  ```

**创建 GitHub 仓库时建议 topics**：`dsh`、`dsh-plugin`、`restart`、`systemd`。

## 安装

```bash
# 1) 构建（需 devDependencies）
cd dsh-restart-systemd
npm install
npm run build          # tsc -b → lib/（host=lib/index.js，client=lib/client.js，内联样式无需 CSS bundle）

# 2) 装入 web profile（注册 bundle + 补丁插件行）
dsh plugin --profile web add /tmp/dsh-restart-systemd
#    或 pnpm add /tmp/dsh-restart-systemd + 手补 cordis.patch.yml 行到 profile bundle 列表

# 3) 无热重载，需重启生效
systemctl --user restart dsh-web
```

`exports."."` → `lib/index.js`，`exports."./client"` → `lib/client.js`；`main`/`types` 与之对应。

### 依赖版本

v0.2 起 devDependencies 对齐 **DSH 0.1.7-rc.1**（v0.1 编译于 0.1.0-rc.6，其 `ConnectionHandle` 还没有 `state`；`dsh-client-runtime` 包已被上游移除，客户端上下文改用 `@deepseek-ai/cordis` 的 `Context`，slot 服务由 `dsh-client-ui-renderer` 声明）。

对宿主的运行时要求很宽松：`connection` 服务是**软读取**（`ctx.get('connection')`，不写进 `inject`）。宿主没有该服务或版本更老时，重启按钮与 `/restart` 命令照常工作，只是不再自动整页刷新。

## 验证

```bash
npm test    # = npm run build && node scripts/verify-client.mjs（41 项检查）
```

`scripts/verify-client.mjs` 在没有浏览器、也不重启线上服务的前提下验三件事：
1. **loader 接线**：按 DSH 加载器的方式 boot `lib/client/index.js`，断言注册的 slot / locale / `hooks.connectionState`，以及运行时 require 只有 `react`、`react-dom`、`react/jsx-runtime` 三个 seed word；
2. **重启-刷新状态机**：`restartReloadDecision` 的全部分支，重点是「观察到真实断线之前的 `connected` 绝不触发刷新」（宿主在 ~3s 调度延迟内仍由重启前的进程应答）；
3. **渲染 + 文案覆盖**：SSR 渲染组件，并断言源码里用到的每个 `t('restart.*')` 键在中英两本字典里都存在、且没有多余键。

线上手工验收：

1. **插件加载**：新会话打开；`journalctl --user -u dsh-web` 出现 `dsh-restart-systemd: ...`。
2. **侧边栏按钮**：设置按钮旁的 footer 行出现重启图标（在 remote-web-ui 电话图标旁边），悬停标题“重启 DeepSeek Harness”。
3. **点击→确认→202→重启**：确认后弹窗显示“已请求重启”，~3s 后服务重启；此时**侧边栏底部设置行**出现核心的连接指示器（`连接中断，正在重试，点击立即重连` → `重新连接中` → `连接成功`），页面自行重连，随后自动整页刷新一次：
   - journald 依次出现 `restart scheduled … delayMs=3000` → `spawning restart for dsh-web …` → 新 boot 的 `consumed leftover restart flag`。
   - 重启按钮在等待期间显示 spinner 且禁用；若 45s 内始终未恢复，弹窗改为超时提示。
4. **`/restart` 命令**：聊天输入 `/restart` → 返回确认文本。
5. **会话自动续接**：重启前若有 running agent，boot 后 journald 出现 `recovery armed for N session(s)` 与 `resuming interrupted agent <id>`，agent 自动继续。
6. **单飞**：快速点两次 → 第二次返回 **409** `already-scheduled`。
7. **loopback**：`curl -H 'Host: evil.example' -X POST http://127.0.0.1:3080/api/restart-dsh` → **403** `forbidden: loopback-only`。
8. 失败兜底：`systemctl --user status dsh-web` 确认单元存活。

## 回滚

```bash
dsh plugin --profile web remove ui-dsh-restart-systemd
# 或手删包 + bundle 行后
systemctl --user restart dsh-web
# 清理残留状态（随时可删）
rm -f ~/.dsh/dsh-restart.flag ~/.dsh/dsh-restart-resume.json
```

重启后按钮与命令即消失，不改动其它配置。

## 平台说明

- **WSL/Linux**：`systemctl --user restart dsh-web`，主目标已实测。
- **Windows（原生，非 WSL）**：`restartArgv()` 走 detached `spawn(process.execPath, [helper])`
  `win-restart.mjs`（未随包附带；参考 anweat/dsh-restart 的 detached helper、
  LnsiAxe/dsh-web-restart 的 WMI `Win32_Process.Create`、shaoyi1991 的 lsof 杀端口+spawn）。
  路由、单飞、flag、loopback fence、restart-recover 均平台无关。WSL 本机场景不进入此分支。
- 重启后**前端自动重连，无需手动刷新**（ConnectionController 指数退避 500ms→10s），并在恢复后自动整页刷新一次。

## 已知限制

- **单一服务单元**：systemctl 命令固定 `dsh-web`（`SYSTEMD_UNIT`）。
- **非 systemctl 启动则不生效**：若以 `node …` 手跑，spawn systemctl 会失败并记日志，不产生重启。
- **恢复为尽力而为**：60s `RECOVERY_TIMEOUT_MS` 窗口内未重建的 agent 会被丢弃；无法判定“最后 turn 被中断”的会话会被跳过（clean 会话永不被主动续接）。
- **Windows helper 为占位**：仅提供 spawn 目标，helper 本体机器相关，超出 WSL 主目标范围。
- 路由避开 `/plugins`（官方 client-modules 拥有该前缀），仅注册 `/api/restart-dsh`，无 bundle 供数冲突。
- **折叠（rail）侧边栏下核心不渲染连接指示器**：`ConnectionIndicator` 仅在 `wide` 时挂载（`sidebar.toggle.badge` 也会在断线时隐藏）。此时用户只能看到重启按钮自身的 spinner/禁用态；展开侧边栏即可看到核心的断线/重连提示。
- **续接消息的 source.kind 变了**：v0.1 用的是已废弃的共享 `kind: 'plugin'`，v0.2 按 harness 设计改为本插件自有的 `kind: 'dsh-restart-systemd'`（`MessageSourceMap` 合并扩展）。任何按 `source.kind === 'plugin'` 过滤注入消息的插件（如 `dsh-handoff-wall` 的取材过滤）需同步加上这个新 kind，否则 `Continue.` 会被当作真实对话取走。

## License

MIT — see [LICENSE](./LICENSE).
