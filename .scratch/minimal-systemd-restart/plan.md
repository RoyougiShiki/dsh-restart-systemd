# Minimal systemd restart — 本地实施计划

状态：F1/F2 修复完成，host 66/66、client 47/47、build/typecheck 通过；README/plan 已按主代理审查修正；本清单已验收，已获准本地提交；实际提交以git记录为准，未安装、未部署、未推送。基线 commit：`dfa78ed12846ba12f697ec0a1c1e3d5ce9a7f5e9`。
本文件是本地实施计划/任务草案，不是 tracker ticket；不造 `ready-for-agent` 等状态。项目 tracker 配置未完成，后续需运行 `/setup-matt-pocock-skills`。本迭代不另建 ADR 或术语表。

## 目标

只保留 Linux/WSL 下由 systemd 管理的 GUI 重启按钮。确认提示（中英文）：

> 重启将中断进行中的任务，不会自动续接。建议任务完成后操作。

按钮现有位置、`wide`/rail 两种形态、确认/取消交互保持可用；其他样式不重新设计。

保留：loopback gate、HTTP method/content-type 检查、3000ms 延迟、single-flight、重启后 15000ms 抑制。

唯一允许的 subprocess argv：

```text
['systemctl', '--user', 'restart', 'dsh-web']
```

不自行拉进程。删除 `/restart` 命令与 `commands` 注入；删除 agents/recovery/快照/Continue 逻辑；删除 connection 监听、恢复超时、自动 reload；删除 Windows helper 与平台死代码。Linux 以外拒绝。

## 客户端

- phase 只需 `idle | confirm | requesting | accepted | error` 一类状态。
- 请求期间禁止重复确认。
- 收到 202 显示「重启请求已接受，后续连接状态由 DSH 显示」，不可称为恢复成功。
- 409 显示已有请求在处理；429/403/501/500 等显示对应错误。
- fetch 断线或请求超时显示「无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试」；不是 scheduled，也不断言服务未重启。
- 可给 HTTP 请求本身设置 10000ms `AbortController` 超时；这不是等待恢复。
- 终态可由用户关闭并释放 busy 锁，之后可再次打开；不加恢复/自动刷新定时器，不加新轮询接口。

## 主机

- 删除 resume 相关文件和 `sessionIds`。
- 只保留 `dsh-restart.flag`，内容 `{ ts, reason }`，用于 boot 抑制。
- `consume` 兼容旧 flag（忽略多余字段），并在插件启动时于 `resolveDshHome()` 下一次性清除旧 `dsh-restart-resume.json` 遗留；不在当前主机实际运行。
- flag 是安全机制，不是恢复机制。
- 为让调度准备失败有真实 500 路径：`schedule` 改成 async，先立单飞锁，再 `await` flag 写入；成功设 timer 并回 202；flag 写失败返回 error、释放锁、不 spawn。
- boot consume 的初始化 promise 要被请求 `await`，避免抑制竞态。
- HTTP `readBody`/调度异常必须 catch 回受控错误，不能 unhandled rejection；不扩展新认证方案。
- 延迟 spawn 失败、done 拒绝、nonzero 只能记录可见日志；不伪称已回的 202 会变 500；不添加状态查询 API。
- 保留失败后可重试；清理本次 flag 时避免误删其他新请求的 flag。
- 每次已接受后直到 spawn 或失败清理结束不得提前解锁重复排入；发出 systemctl 可能杀掉宿主，done 未回的情况由新 boot 消费 flag 接管。

## 清理范围

- `src`、`scripts`、`README`、`cordis.patch.yml` 注释、`package.json` / lock、受跟踪 `lib`。
- 保留真实安装清单、`dsh.bundle.patch`、双面 client exports。
- 删除孤儿 recover lib 产物、过时恢复测试；build 后无旧代码。
- 无关 homepage/bugs 修正不做；不改版本；不装卸 node_modules。
- 依赖精简可用 `npm --package-lock-only --ignore-scripts --offline --cache <repo-temp>` 更新 lock；失败先报告，不联网。
- 构建/typecheck 用本地工具。

## 已确认测试接缝

A. 真实 React 按钮渲染交互 → HTTP：
- 取消零请求；确认一次；双击单请求；202 不等恢复；409/429/403/501/500；网络未知反馈后可操作；wide/rail 均可。

B. 宿主公开 HTTP 注册 route → subprocess 替身：
- 真实 loopback 端口 0，或注册 handler + 真实 HTTP 夹具。
- 安全 method/type/origin；202 延迟且 argv 固定；409 并发；临时 `DSH_HOME` boot flag 429；flag 写失败/调度准备失败 500；spawn throw / done reject / nonzero 日志和无未处理异常；dispose 后不 spawn；readBody 未完成或 flag 写入期间 dispose；失败清理期间重复请求 409、清理后重试 202。
- 不向真实服务发请求。

所有**重启 subprocess 调用**必须硬 stub；竞态 probe 只启动 Node，不启动 systemctl；所有 `DSH_HOME` 均临时目录（import 前设置）；任何情况下禁止 systemctl/kill/3080/current profile。

按 TDD 一个用例 red 再 green 推进，记录实际命令 exit，不伪造 red。保留 bundle 接线/locale 键集合验证，可更新既有测试。充分校验完整 body 错误路径，但不扩展成大重构。

## 浏览器验证

- 必须先运行 ego-browser skill 并遵循完整输出；缺命令读其安装参考但不安装，报告。
- 只用专用隔离 tab/上下文和临时静态 React 夹具；不打开当前 GUI/登录站点，不另起 DSH。
- 可启动临时夹具 server（port 0 随机端口，managed job 记录并收尾）；不替代当前 GUI。
- 浏览器及依赖不可用时不得冒充 SSR/手写 React stub 为真实 UI 验证；完成其他部分并明确未验证，交回主代理；不得擅自安装或远程浏览。
- 需要新依赖先报告。

## 写入边界

- 允许写入仅当前插件仓库与此任务独占临时目录。
- 读取仅仓库/必要依赖/skill 和 ego 工具文档；禁止凭证/profile 内容、用户服务/远端写入/push/release/gh issue/当前 GUI 验证。
- 所有删除先核对绝对目标；文本用 read/edit，遵守 HASH；同文件改动批量；bash 必须检查 exit。
- 实现可串行修改全部批准文件，无其他写代理。
- 本清单已验收，已获准本地提交；实际提交以git记录为准，未安装、未部署、未推送。

## 实施结果（2026-11-06，已按主代理要求完成）

- 源码：host 只保留 `webServer`/`subprocess`、exact `POST /api/restart-dsh`、固定 `['systemctl','--user','restart','dsh-web']`、单飞、flag、15000ms 抑制；client 只保留 idle/confirming/requesting/accepted/error，无 connection/自动刷新/自动续接。删除 `src/host/recover.ts`、`scripts/verify-agents-inject.mjs`、`scripts/verify-full-cycle.mjs`；主机实现见 [src/host/restart.ts](../../src/host/restart.ts)。
- 依赖/发布面：[package.json](../../package.json) 去掉 agents/commands/llm/session/system-prompt/client-connection/client-store；`dsh.client.inject` 只留 locale/ui-renderer/ui-sidebar；[package-lock.json](../../package-lock.json) 用 `npm install --package-lock-only --ignore-scripts --offline --cache .scratch/npm-cache` 更新（exit 0，无网络）；版本保持 0.3.0。
- 构建：`npm run build` exit 0（本地 tsc + [scripts/build-client.mjs](../../scripts/build-client.mjs)）；`npm run typecheck` exit 0；受跟踪 `lib` 已重建，孤儿 `lib/host/recover.*` 已核对并删除，build 后无旧代码。
- 首轮 TDD red（wiring/import，不是逐行为 red）：`node [scripts/verify-host.mjs](../../scripts/verify-host.mjs)` exit 1（inject 仍是 webServer,subprocess,commands,agents；随后 `TypeError: Cannot read properties of undefined (reading 'register') at lib/index.js:133`）；`node [scripts/verify-client.mjs](../../scripts/verify-client.mjs)` exit 1（`TypeError: ctx.get is not a function at lib/client/index.js:370`）。
- Green（修复后本轮）：`npm test` exit 0：build + client **47/47** + host **66/66**；`npm run typecheck` exit 0；host 使用真实 loopback HTTP + subprocess 硬替身，`DSH_HOME` 全部临时目录。修复前 host red 59/66，失败项与修复见下节。
- 浏览器：round-06 已在 Windows 隔离 TaskSpace `dsh-restart-ui-20261106`（spaceId 3）通过 32 项；截图 [wide-confirm.png](./wide-confirm.png)、[wide-accepted.png](./wide-accepted.png)、[wide-conflict.png](./wide-conflict.png)、[wide-unknown.png](./wide-unknown.png)、[rail-idle.png](./rail-idle.png) 保留为本地证据。最终 runner 实际执行 TaskSpace `dsh-restart-ui-final-20261106-2153`（spaceId 11）**32/32，finished=true，exit 0**；临时 fixture job `bash-274fc0bce73949cc` 已 killed。首次实际执行（spaceId 10）也完成了 32 项，但 runner 当时只查 stdout、ego 把结果写 stderr，导致 exit 1；改为合并 stdout+stderr 后重跑得到上述最终结果。未打开当前 GUI/登录站点，未连接 3080，未执行真实 systemctl。
- 未验项：没有用真实 DSH GUI 实例点击（按边界要求），没有真实执行 systemctl/重启；浏览器验证是隔离夹具，不能替代线上端到端。UI 夹具对网络断线收到 3 次传输层重试，但页面 `fetch` 调用计数为 1，UI 仍只显示 unknown，host 的单飞会拒绝后续重复请求。夹具绑定 `0.0.0.0` 仅用于跨主机 ego 到达 WSL 夹具；bundle 现在写到 `os.tmpdir()`，不写仓库 `.scratch`；runner 不再写临时 verify.mjs。

## 主代理审查修正与保证边界（2026-11-06）

- F1（dispose/热重载竞态）：新增永久 `disposed` 标记；`schedule` 入口、`initialize()` 后、flag 写入后、timer 安装前和 timer 回调都检查。请求在 `readBody` 未完成时 dispose，恢复后返回受控 500 且不装 timer；flag 写入期间 dispose，恢复后清本次 flag、返回受控 500、不 spawn。覆盖 race1（boot 初始化期间 dispose）、race2（失败清理期间 409 / 清理后重试 202）、race3（flag 写入期间 dispose）和父进程 readBody 回归（显式断言受控 500），host 66/66。
- F2（清理锁）：`inFlight` 保持到本次 attempt 的清理完成；timer 安装失败、spawn 同步 throw、done reject、非 0 退出都先 `await clearOwnFlag` 再解锁。`clearOwnFlag` 按 `flagTs` 匹配；同一调度器实例串行执行，因此同毫秒 ts 不再与清理竞争。热重载/多实例共享 `DSH_HOME` 的跨实例原子性**不保证**，没有文件锁或新 token 格式；`dispose` 清 flag 是 best-effort，进程退出未清时下一次 boot consume 最多额外抑制 15s。
- F3（浏览器可复跑）：新增 [scripts/verify-ui-browser.mjs](../../scripts/verify-ui-browser.mjs)，参数为 `--url`、`--task-space`、可选 `--ego`/`EGO_BROWSER`、`--timeout`；生成脚本经 stdin 交给 ego-browser，不写仓库、不硬编码 Windows/ego 路径、不进入 `npm test`。生成脚本在 TaskSpace 持有段包 `try/finally`，成功或失败都 `await task.finish({ keep: [] })`，只清理本次任务。`node --check`、`--dry-run` 通过；实际最终运行为 `spaceId 11`、32/32、`finished=true`（见上）。
- 文档修正：README 回滚命令改为 `dsh-restart-systemd`；源码/脚本/产物提及补相对 markdown 链接；删除长期测试数量承诺；500 范围改为“调度准备/flag 写入失败、已 dispose”；`flagTs` 笔误已改；单飞保证收窄到“同一调度器实例”。
- 测试措辞：所有**重启 subprocess 调用**是硬 stub；竞态 probe 只启动 Node；`DSH_HOME` 全部临时目录。首轮 TDD red 是 wiring/import（inject 不匹配、`ctx.get` 不存在），行为 red 是上述 7 个 host 失败；两者分开记录，未冒充逐行为 red。
- 审查 smell（非阻断，不重构）：`delayMs` 未使用、局部 try/catch 冗余；不影响安全契约，未做无谓重构。
- 边界：没有真实 systemctl、真实重启或当前 GUI 点击；跨实例/跨进程原子安全不在承诺内。

## 双轴结论

- 规范轴：主代理独立读 `restart.ts` 后认可 F1/F2 逻辑，无硬违规；`delayMs` 未用、局部 try/catch 冗余为非阻断 smell，未做无谓重构。
- 需求轴：F1/F2 仅在单调度器实例内保证并已通过 host 66/66；F3 runner 可重跑，最终隔离夹具实际 32/32、finished=true；跨实例共享 DSH_HOME 不承诺，未部署/未真实 systemctl/未对当前 GUI 验证。

## 验收清单

- [x] plan 已写入 [plan.md](./plan.md)
- [x] 确认提示中英文均为「重启将中断进行中的任务，不会自动续接。建议任务完成后操作。」
- [x] 客户端 phase 精简为 idle/confirm/requesting/accepted/error
- [x] 请求期间禁重复确认；终态可关闭、释放锁、可再打开
- [x] 202 文案为「重启请求已接受，后续连接状态由 DSH 显示」
- [x] 409/429/403/501/500 各有对应错误文案
- [x] fetch 断线/10s 超时显示「无法确认重启请求是否被接受，请查看 DSH 连接状态；不要连续重试」
- [x] 删除 connection 监听、恢复超时、自动 reload、恢复轮询
- [x] 删除 `/restart` 命令与 commands 注入
- [x] 删除 agents/recovery/快照/Continue 逻辑及过时测试
- [x] 删除 Windows helper 与平台死代码；Linux 以外拒绝
- [x] 唯一 argv 为 `['systemctl','--user','restart','dsh-web']`
- [x] 保留 loopback gate、method/content-type、3000ms、single-flight、15000ms 抑制
- [x] flag 只写 `{ ts, reason }`；consume 兼容旧 flag 并忽略多余字段
- [x] 启动时清理旧 `dsh-restart-resume.json`
- [x] `schedule` async：先锁、await flag 写入、失败清理后才 unlock、不 spawn
- [x] boot consume 初始化 promise 被请求 await
- [x] HTTP readBody/调度异常 catch 为受控错误，无 unhandled rejection
- [x] spawn throw / done reject / nonzero 只记可见日志；不新增状态查询 API
- [x] 失败后可重试；同一调度器实例内按 `flagTs` 清理，不误删新请求的 flag（跨实例不承诺）
- [x] 已接受后到 spawn/失败清理结束前不解锁重复排入
- [x] src/scripts/README/cordis.patch.yml/package/lock/受跟踪 lib 已更新
- [x] 保留真实安装清单、dsh.bundle.patch、双面 client exports
- [x] 删除孤儿 lib/recover 产物；build 后无旧代码
- [x] 不改版本、不装卸 node_modules；lock 更新仅离线方式（exit 0）
- [x] 测试 A：真实 React 交互→HTTP 全场景（round-06 wide/rail；runner 参数化）
- [x] 测试 B：宿主公开 HTTP route→subprocess 替身全场景（含 dispose/readBody/flag write race 与清理锁）
- [x] 所有重启 subprocess 调用硬 stub；竞态 probe 只启动 Node；所有 DSH_HOME 临时目录
- [x] TDD red/green 实际命令与退出码已记录
- [x] npm test（client 47/47、host 66/66）/ typecheck / build 实际结果已记录
- [x] F1 dispose/readBody/flag write race 回归通过
- [x] F2 清理锁与“同一调度器实例”保证边界已记录
- [x] [README.md](../../README.md) 回滚命令改为 `dsh-restart-systemd`；源码/脚本/产物提及补相对 markdown 链接；删除长期测试数量承诺；500 范围改为“调度准备/flag 写入失败、已 dispose”；`flagTs` 笔误已改；单飞保证收窄到“同一调度器实例”。
- [x] 浏览器 runner 位于 scripts，参数化 URL/task-space；实际 32/32、finished=true，TaskSpace 持有段 try/finally finish
- [x] ego-browser 实际运行；截图路径与未验项已记录
- 提交前工作树：41 个受跟踪文件（+1941/−3088），`git diff --check` exit 0；未跟踪 `.scratch/`、`scripts/ui-fixture.mjs`、`scripts/ui-fixture-entry.tsx`、`scripts/verify-ui-browser.mjs`；本清单已验收，已获准本地提交，实际提交以 git 记录为准，未安装、未部署、未推送。
**交付状态（2026-11-07 更新）**：代码、测试、本地提交、推送与 GitHub Release v0.3.0 均已完成；**安装与重启未完成**。本会话文件沙箱把整个 `~/.dsh` 挂为只读（`touch ~/.dsh/...` → `EROFS`，`dsh --profile web --dump-config` 也因写 `cordis.yml` 失败），扩大权限的申请在本会话没有应答方，因此没有手改 profile、没有重启。

证据：origin/main = `e439d0068d8b3fc8e90c1e51a87b47ccd0028c70`，tag `v0.3.0` 指向同一 commit；Release 资产 `dsh-restart-systemd-0.3.0.tgz` sha256 `3d04119d945fb0b85186f6c901653664c28f5f2b2d5c1d26c6f9f170d28b05b2` 与本地 `.scratch/release/` 产物一致；`npm test` exit 0（client 47/47、host 66/66），`npm run typecheck` exit 0，`git diff --check` exit 0。

当前 profile 仍运行旧代码：`~/.dsh/profiles/web/pnpm-lock.yaml` 把该包 pin 在 `dfa78ed…`，安装副本 `lib/index.js` 的 sha256 与 `260bd73^` 相同，且 `lib/host/recover.js` 仍在——所以此刻重启只会重启旧插件。

**安装命令已在 profile 的隔离副本上验证（未触碰当前 profile）**：复制 profile 的 `package.json` + `pnpm-lock.yaml` 后，`pnpm add link:<仓库>` 与 `pnpm add github:RoyougiShiki/dsh-restart-systemd` 只有加 `--config.auto-install-peers=false` 才 exit 0；不加则 `ERR_PNPM_NO_MATCHING_VERSION @deepseek-ai/dsh-session@>=0.2.2 <0.3.0-0`（`@michengai/dsh-archive-manager` 的 peer 范围 × `~/.npmrc` 的 npmmirror 源，该区间在 registry 上不存在）。装上后 `lib/index.js` `8c3ed25b…`、`lib/host/restart.js` `efafdfc4…`、`lib/host/gate.js` `29bb94ad…` 与仓库 HEAD 完全一致，`lib/host/` 内无 `recover.*`。
