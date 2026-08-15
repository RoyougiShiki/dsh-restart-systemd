# dsh-restart-systemd

> **_English summary._**
> A DeepSeek Harness WebUI **restart button** (systemd edition). Adds a sidebar‑footer
> restart trigger **next to the remote‑web‑ui phone icon** plus a `/restart` command.
> Clicking schedules `systemctl --user restart dsh-web` (~3s later, so the browser
> gets its 202 first), dups are refused (**409**), non‑loopback callers are refused
> (**403**), a flag‑file + residual‑window design prevents restart loops, and after the
> service comes back up the browser **auto‑reconnects without a manual refresh**
> (ConnectionController exponential backoff 500ms→10s) while interrupted agent turns
> are **auto‑resumed**. Platform: **WSL/Linux → systemctl --user** (primary, tested);
> **Windows → detached helper** branch is present but unused on WSL.

**GitHub topics**（主代理创建仓库时使用）: `dsh` · `dsh-plugin` · `restart` · `systemd`

---

## 设计总览

双面插件（与 `dsh-client-ui-aionui-panel` 同构）：

| 半边 | entry（exports） | 运行环境 | 职责 |
|------|------------------|----------|------|
| host | `"."` → `lib/index.js` | node（宿主导进） | `/api/restart-dsh` 路由、`/restart` 命令、flag/resume 状态、restart-recover |
| client | `"./client"` → `lib/client.js` | 浏览器（WebUI） | 侧边栏 footer 重启按钮 + 二次确认 + 状态反馈 |

```
src/
  index.ts               # host apply()：串联路由 + 命令 + boot 消费/resume
  host/gate.ts           # loopback fence（照抄 dsh-aionui-panel 的 gate）
  host/restart.ts        # 调度 + 延迟 spawn + 平台分支 + flag/单飞锁
  host/recover.ts        # agent/created -> lastTurnInterrupted -> followup continue
  client/index.ts        # client apply()：locale + sidebar.footer.action 注入
  client/RestartButton.tsx   # 按钮 + 确认对话框（内联样式，无需 CSS bundle）
  client/api.ts          # POST 助手 + 重连探活
```

内部依赖：官方 socket `sidebar.footer.action`（list/root additive，remote-web-ui 电话图标同座）+ 备选 `conversation.session.header.utilities`。

### 重启流程

1. 点按钮（或输入 `/restart`）→ 二次确认：“进行中的 agent 任务将中断并自动续接，页面约几秒后自动重连。”
2. 确认 → `POST /api/restart-dsh`（或命令回调）。
3. host 把**当前 running** 的 agent id 快照到 `$DSH_HOME/dsh-restart-resume.json`，写 flag `$DSH_HOME/dsh-restart.flag`，随即回 **202 `{scheduled:true, delayMs:3000}`**。
4. 3s 后 host 用**白名单 argv**（无 shell 拼串）spawn `systemctl --user restart dsh-web`。服务重启；浏览器靠 ConnectionController 指数退避（500ms→10s）**自动重连，无需手动刷新**。
5. 重启后插件消费（删除）flag token，装上 `agent/created` 监听，读 resume 列表——对每个**最后 turn 被中断**（存在未闭合 `turn/start` 或最近的 `turn/end.reason === 'interrupted'`）的会话，`agent.followup("Continue.")` 自动续接；idle/正常结束的会话绝不打扰。

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

## 验证

1. **插件加载**：新会话打开；`journalctl --user -u dsh-web` 出现 `dsh-restart-systemd: ...`。
2. **侧边栏按钮**：设置按钮旁的 footer 行出现重启图标（在 remote-web-ui 电话图标旁边），悬停标题“重启 DeepSeek Harness”。
3. **点击→确认→202→重启**：确认后页面短暂显示“正在重启…”，~3s 后服务重启，页面自动重连：
   - journald 依次出现 `restart scheduled … delayMs=3000` → `spawning restart for dsh-web …` → 新 boot 的 `consumed leftover restart flag`。
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
- 重启后**前端自动重连，无需手动刷新**（ConnectionController 指数退避 500ms→10s）。

## 已知限制

- **单一服务单元**：systemctl 命令固定 `dsh-web`（`SYSTEMD_UNIT`）。
- **非 systemctl 启动则不生效**：若以 `node …` 手跑，spawn systemctl 会失败并记日志，不产生重启。
- **恢复为尽力而为**：60s `RECOVERY_TIMEOUT_MS` 窗口内未重建的 agent 会被丢弃；无法判定“最后 turn 被中断”的会话会被跳过（clean 会话永不被主动续接）。
- **Windows helper 为占位**：仅提供 spawn 目标，helper 本体机器相关，超出 WSL 主目标范围。
- 路由避开 `/plugins`（官方 client-modules 拥有该前缀），仅注册 `/api/restart-dsh`，无 bundle 供数冲突。

## License

MIT — see [LICENSE](./LICENSE).
