window.__ModuleLoader__.load({
	id: "dsh-restart-systemd",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  NS: () => NS,
  apply: () => apply,
  dictionaries: () => dictionaries,
  en: () => en,
  inject: () => inject,
  zh: () => zh
});
module.exports = __toCommonJS(index_exports);
var import_react2 = require("react");

// src/client/RestartButton.tsx
var import_react = require("react");
var import_react_dom = require("react-dom");

// src/client/api.ts
var REQUEST_TIMEOUT_MS = 1e4;
function budget() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}
async function requestRestart(mode = "now", reason = "webui-button") {
  const { signal, done } = budget();
  try {
    const response = await fetch("/api/restart-dsh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, mode }),
      signal
    });
    if (response.status === 202) {
      let body = {};
      try {
        body = await response.json();
      } catch {
      }
      if (body.queued === true) {
        const waiting = typeof body.waitingForSessions === "number" ? body.waitingForSessions : 0;
        return { status: "queued", waitingForSessions: waiting };
      }
      const delayMs = typeof body.delayMs === "number" ? body.delayMs : 3e3;
      return { status: "accepted", delayMs };
    }
    if (response.status === 409) return { status: "already-scheduled" };
    if (response.status === 429) return { status: "suppressed" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 501) return { status: "unsupported" };
    return { status: "error", message: "HTTP " + response.status };
  } catch {
    return { status: "unknown" };
  } finally {
    done();
  }
}
async function fetchQueuedRestart() {
  const { signal, done } = budget();
  try {
    const response = await fetch("/api/restart-dsh", { method: "GET", headers: { accept: "application/json" }, signal });
    if (response.status !== 200) return void 0;
    const body = await response.json();
    if (body === null || typeof body !== "object") return void 0;
    const queued = body.queued;
    if (queued === null || queued === void 0) return null;
    if (typeof queued !== "object") return void 0;
    const record = queued;
    return {
      reason: typeof record.reason === "string" ? record.reason : "unknown",
      requestedAt: typeof record.requestedAt === "number" ? record.requestedAt : 0,
      waitingForSessions: typeof record.waitingForSessions === "number" ? record.waitingForSessions : 0
    };
  } catch {
    return void 0;
  } finally {
    done();
  }
}
async function cancelQueuedRestart() {
  const { signal, done } = budget();
  try {
    const response = await fetch("/api/restart-dsh", { method: "DELETE", signal });
    if (response.status !== 200) return false;
    const body = await response.json();
    return body?.cancelled === true;
  } catch {
    return false;
  } finally {
    done();
  }
}

// src/client/RestartButton.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var QUEUE_POLL_MS = 5e3;
function RestartGlyph({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      d: "M2.5 4.6A6 6 0 0 1 13.5 8M13.5 8l-2.1-2.2M13.5 8l-2.2 2.1M13.5 11.4A6 6 0 0 1 2.5 8M2.5 8l2.2 2.2M2.5 8l2.1-2.2",
      stroke: "currentColor",
      strokeWidth: "1.3",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }
  ) });
}
var triggerStyle = {
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  border: "none",
  borderRadius: "50%",
  padding: 0,
  cursor: "pointer"
};
var triggerRailStyle = {
  ...triggerStyle,
  height: 36
};
var overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};
var maskStyle = { position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" };
var dialogStyle = {
  position: "relative",
  boxSizing: "border-box",
  width: 400,
  maxWidth: "calc(100vw - 48px)",
  padding: "20px 22px",
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: 16,
  background: "var(--dsw-alias-bg-layer-2)",
  boxShadow: "var(--dsw-shadow-lv3)",
  color: "var(--dsw-alias-label-primary)",
  fontSize: 14,
  lineHeight: 1.55
};
var titleStyle = { margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "var(--dsw-alias-label-primary)" };
var bodyStyle = { margin: "0 0 16px", color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-line" };
var actionsStyle = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 };
var buttonBase = {
  appearance: "none",
  font: "inherit",
  cursor: "pointer",
  border: "1px solid transparent",
  borderRadius: 8,
  padding: "6px 16px",
  fontSize: 13,
  lineHeight: 1.5
};
var cancelStyle = { ...buttonBase, borderColor: "var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-secondary)", background: "transparent" };
var proceedStyle = { ...buttonBase, borderColor: "var(--dsw-alias-border-l2)", color: "var(--dsw-alias-label-primary)", background: "transparent" };
var proceedIdleStyle = { ...buttonBase, background: "var(--dsw-alias-label-primary)", color: "var(--dsw-alias-bg-layer-3)" };
var cardStyle = (wide) => ({
  position: "fixed",
  left: wide ? 12 : 72,
  bottom: 72,
  zIndex: 50,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  width: 320,
  maxWidth: "calc(100vw - 24px)",
  padding: "10px 12px",
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: 12,
  background: "var(--dsw-alias-bg-layer-2)",
  boxShadow: "var(--dsw-shadow-lv3)",
  fontSize: 13,
  lineHeight: 1.5
});
var bubbleTextStyle = { flex: "1 1 auto", color: "var(--dsw-alias-label-error)", whiteSpace: "pre-line" };
var queuedTextStyle = { flex: "1 1 auto", color: "var(--dsw-alias-label-primary)", whiteSpace: "pre-line" };
var queuedTitleStyle = { display: "block", fontWeight: 600, color: "var(--dsw-alias-label-primary)" };
var queuedBodyStyle = { display: "block", marginTop: 2, color: "var(--dsw-alias-label-secondary)" };
var queuedCancelStyle = {
  appearance: "none",
  marginTop: 6,
  padding: 0,
  border: "none",
  background: "transparent",
  font: "inherit",
  fontSize: 12,
  color: "var(--dsw-alias-label-secondary)",
  textDecoration: "underline",
  cursor: "pointer"
};
var bubbleCloseStyle = {
  flex: "none",
  appearance: "none",
  background: "transparent",
  border: "none",
  padding: 0,
  width: 18,
  height: 18,
  lineHeight: "18px",
  fontSize: 15,
  cursor: "pointer",
  color: "var(--dsw-alias-label-tertiary)"
};
function SpinnerGlyph({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { animation: "dsh-restart-spin 1s linear infinite" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "6", stroke: "var(--dsw-alias-label-tertiary)", strokeWidth: "2", opacity: "0.35" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M14 8a6 6 0 0 0-6-6", stroke: "var(--dsw-alias-label-secondary)", strokeWidth: "2", strokeLinecap: "round" })
  ] });
}
function RestartButton({ wide, t }) {
  const [phase, setPhase] = (0, import_react.useState)({ kind: "idle" });
  const [queuedCardShown, setQueuedCardShown] = (0, import_react.useState)(true);
  const busyRef = (0, import_react.useRef)(false);
  const actionsRef = (0, import_react.useRef)({
    cancel: () => {
    },
    confirm: () => {
    },
    dismiss: () => {
    },
    cancelQueued: () => {
    }
  });
  (0, import_react.useEffect)(() => {
    document.querySelectorAll('style[id^="dsh-restart-css"]').forEach((stale) => stale.remove());
    const style = document.createElement("style");
    style.id = "dsh-restart-css-v7";
    style.textContent = [
      ".dsh-restart-trigger{background:transparent;color:var(--dsw-alias-label-secondary);transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}",
      ".dsh-restart-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-restart-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}",
      ".dsh-restart-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);outline:none}",
      ".dsh-restart-trigger[data-dsh-restart-queued]{color:var(--dsw-alias-brand-primary)}",
      ".dsh-restart-rail [class*=footerActions]{flex-direction:column!important;align-items:center;row-gap:4px}",
      "@keyframes dsh-restart-spin{to{transform:rotate(360deg)}}"
    ].join("\n");
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  (0, import_react.useEffect)(() => {
    if (wide) return void 0;
    document.documentElement.classList.add("dsh-restart-rail");
    return () => document.documentElement.classList.remove("dsh-restart-rail");
  }, [wide]);
  (0, import_react.useEffect)(() => {
    let alive = true;
    void fetchQueuedRestart().then((queued2) => {
      if (!alive || queued2 === null || queued2 === void 0) return;
      setPhase((current) => current.kind === "idle" ? { kind: "queued", waitingForSessions: queued2.waitingForSessions } : current);
    });
    return () => {
      alive = false;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    if (phase.kind !== "queued") return void 0;
    const timer = setInterval(() => {
      void fetchQueuedRestart().then((queued2) => {
        if (queued2 === null) {
          setPhase({ kind: "idle" });
          return;
        }
        if (queued2 === void 0) return;
        setPhase((current) => current.kind === "queued" ? { kind: "queued", waitingForSessions: queued2.waitingForSessions } : current);
      });
    }, QUEUE_POLL_MS);
    return () => clearInterval(timer);
  }, [phase.kind]);
  const cancel = (0, import_react.useCallback)(() => {
    setPhase({ kind: "idle" });
  }, []);
  const dismiss = (0, import_react.useCallback)(() => {
    setPhase((current) => current.kind === "error" ? { kind: "idle" } : current);
    setQueuedCardShown(false);
  }, []);
  const cancelQueued = (0, import_react.useCallback)(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const cancelled = await cancelQueuedRestart();
      setPhase(cancelled ? { kind: "idle" } : { kind: "error", message: t("restart.failed") });
    } finally {
      busyRef.current = false;
    }
  }, [t]);
  const run = (0, import_react.useCallback)(async (mode) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase({ kind: "requesting" });
    let result;
    try {
      result = await requestRestart(mode, "webui-button");
    } catch {
      result = { status: "unknown" };
    }
    busyRef.current = false;
    if (result.status === "accepted") {
      setPhase({ kind: "idle" });
      return;
    }
    if (result.status === "queued") {
      setQueuedCardShown(true);
      setPhase({ kind: "queued", waitingForSessions: result.waitingForSessions });
      return;
    }
    let message;
    if (result.status === "already-scheduled") message = t("restart.conflict");
    else if (result.status === "suppressed") message = t("restart.suppressed");
    else if (result.status === "forbidden") message = t("restart.denied");
    else if (result.status === "unsupported") message = t("restart.unsupported");
    else if (result.status === "unknown") message = t("restart.unknown");
    else message = t("restart.failed") + " (" + result.message + ")";
    setPhase({ kind: "error", message });
  }, [t]);
  const confirm = (0, import_react.useCallback)((mode) => {
    setPhase({ kind: "requesting" });
    void run(mode);
  }, [run]);
  (0, import_react.useEffect)(() => {
    actionsRef.current = { cancel, confirm, dismiss, cancelQueued };
  });
  (0, import_react.useEffect)(() => {
    const handler = (event) => {
      const target = event.target;
      const element = target?.closest?.("[data-dsh-restart-action]");
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const action = element.getAttribute("data-dsh-restart-action");
      if (action === "cancel") actionsRef.current.cancel();
      else if (action === "proceed") actionsRef.current.confirm("now");
      else if (action === "proceedIdle") actionsRef.current.confirm("when-idle");
      else if (action === "dismiss") actionsRef.current.dismiss();
      else if (action === "cancelQueued") void actionsRef.current.cancelQueued();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
  const label = t("restart.label");
  const requesting = phase.kind === "requesting";
  const queued = phase.kind === "queued";
  const trigger = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      className: "dsh-restart-trigger",
      style: wide ? triggerStyle : triggerRailStyle,
      "aria-label": label,
      "aria-busy": requesting || void 0,
      "data-dsh-restart-queued": queued ? "true" : void 0,
      disabled: requesting,
      title: queued ? t("restart.queued.title") : requesting ? t("restart.requesting") : label,
      onClick: () => {
        if (queued) {
          setQueuedCardShown(true);
          return;
        }
        setPhase({ kind: "confirming" });
      },
      children: requesting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpinnerGlyph, { size: wide ? 16 : 18 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RestartGlyph, { size: wide ? 16 : 18 })
    }
  );
  const dialog = phase.kind === "confirming" && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: overlayStyle, role: "presentation", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: maskStyle, "aria-hidden": "true", onClick: cancel }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: dialogStyle, role: "dialog", "aria-modal": "true", "aria-label": label, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: titleStyle, children: t("restart.confirm.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: bodyStyle, children: t("restart.confirm.body") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: actionsStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-dsh-restart-action": "cancel", style: cancelStyle, onClick: cancel, children: t("restart.cancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-dsh-restart-action": "proceed", style: proceedStyle, onClick: () => confirm("now"), children: t("restart.proceed") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-dsh-restart-action": "proceedIdle", style: proceedIdleStyle, onClick: () => confirm("when-idle"), children: t("restart.proceedIdle") })
      ] })
    ] })
  ] }), document.body);
  const queuedCard = phase.kind === "queued" && queuedCardShown && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: cardStyle(wide), role: "status", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: queuedTextStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: queuedTitleStyle, children: t("restart.queued.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: queuedBodyStyle, children: t("restart.queued.body") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          "data-dsh-restart-action": "cancelQueued",
          style: queuedCancelStyle,
          onClick: () => void cancelQueued(),
          children: t("restart.queued.cancel")
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        "data-dsh-restart-action": "dismiss",
        style: bubbleCloseStyle,
        "aria-label": t("restart.close"),
        title: t("restart.close"),
        onClick: dismiss,
        children: "\xD7"
      }
    )
  ] }), document.body);
  const bubble = phase.kind === "error" && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: cardStyle(wide), role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: bubbleTextStyle, children: phase.message }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        "data-dsh-restart-action": "dismiss",
        style: bubbleCloseStyle,
        "aria-label": t("restart.close"),
        title: t("restart.close"),
        onClick: dismiss,
        children: "\xD7"
      }
    )
  ] }), document.body);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    trigger,
    dialog,
    queuedCard,
    bubble
  ] });
}

// src/client/index.ts
var NS = "restart-dsh";
var en = {
  "restart.label": "Restart DeepSeek Harness",
  "restart.confirm.title": "Restart the DeepSeek Harness service?",
  "restart.confirm.body": "\u201CRestart now\u201D interrupts in-flight tasks and will not resume them automatically. \u201CRestart when idle\u201D waits until every session has finished.",
  "restart.cancel": "Cancel",
  "restart.proceed": "Restart now",
  "restart.proceedIdle": "Restart when idle",
  "restart.requesting": "Submitting restart request...",
  "restart.conflict": "A restart request is already in progress.",
  "restart.suppressed": "The service just restarted; please wait a moment before trying again.",
  "restart.denied": "Restart is only available from this machine (loopback).",
  "restart.unsupported": "Restart is not supported on this platform.",
  "restart.unknown": "Could not confirm whether the restart request was accepted. Check the DSH connection status; do not retry repeatedly.",
  "restart.failed": "Restart request failed",
  "restart.close": "Close",
  "restart.queued.title": "Restart scheduled",
  "restart.queued.body": "The restart runs as soon as every session has finished. You can close this window; nothing else is required.",
  "restart.queued.cancel": "Cancel the scheduled restart"
};
var zh = {
  "restart.label": "\u91CD\u542F DeepSeek Harness",
  "restart.confirm.title": "\u91CD\u542F DeepSeek Harness \u670D\u52A1\uFF1F",
  "restart.confirm.body": "\u300C\u7ACB\u5373\u91CD\u542F\u300D\u4F1A\u4E2D\u65AD\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\u4E14\u4E0D\u4F1A\u81EA\u52A8\u7EED\u63A5\uFF1B\u300C\u7B49\u4F1A\u8BDD\u7ED3\u675F\u300D\u4F1A\u7B49\u5230\u6240\u6709\u4F1A\u8BDD\u90FD\u8DD1\u5B8C\u518D\u91CD\u542F\u3002",
  "restart.cancel": "\u53D6\u6D88",
  "restart.proceed": "\u7ACB\u5373\u91CD\u542F",
  "restart.proceedIdle": "\u7B49\u4F1A\u8BDD\u7ED3\u675F\u540E\u91CD\u542F",
  "restart.requesting": "\u6B63\u5728\u63D0\u4EA4\u91CD\u542F\u8BF7\u6C42\u2026",
  "restart.conflict": "\u5DF2\u6709\u91CD\u542F\u8BF7\u6C42\u5728\u5904\u7406\u3002",
  "restart.suppressed": "\u670D\u52A1\u521A\u521A\u91CD\u542F\uFF0C\u8BF7\u7A0D\u5019\u518D\u8BD5\u3002",
  "restart.denied": "\u91CD\u542F\u4EC5\u9650\u672C\u673A\u8BBF\u95EE\uFF08loopback\uFF09\u3002",
  "restart.unsupported": "\u5F53\u524D\u5E73\u53F0\u4E0D\u652F\u6301\u91CD\u542F\u3002",
  "restart.unknown": "\u65E0\u6CD5\u786E\u8BA4\u91CD\u542F\u8BF7\u6C42\u662F\u5426\u88AB\u63A5\u53D7\uFF0C\u8BF7\u67E5\u770B DSH \u8FDE\u63A5\u72B6\u6001\uFF1B\u4E0D\u8981\u8FDE\u7EED\u91CD\u8BD5\u3002",
  "restart.failed": "\u91CD\u542F\u8BF7\u6C42\u5931\u8D25",
  "restart.close": "\u5173\u95ED",
  "restart.queued.title": "\u5DF2\u5B89\u6392\u91CD\u542F",
  "restart.queued.body": "\u6240\u6709\u4F1A\u8BDD\u8DD1\u5B8C\u540E\u4F1A\u81EA\u52A8\u91CD\u542F\u3002\u53EF\u4EE5\u76F4\u63A5\u5173\u6389\u8FD9\u4E2A\u7A97\u53E3\uFF0C\u4E0D\u9700\u8981\u518D\u56DE\u6765\u70B9\u4E00\u6B21\u3002",
  "restart.queued.cancel": "\u53D6\u6D88\u8FD9\u6B21\u91CD\u542F"
};
var dictionaries = { en, zh };
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), "dsh-restart-systemd: dictionaries");
  ctx.slots.inject(
    "sidebar.footer.action",
    () => ctx.slots.register({
      name: "sidebar.footer.action",
      id: "dsh-restart-systemd",
      order: 20,
      locale: NS
    }, RestartButton)
  );
}
		return module.exports;
	}
});
//# sourceMappingURL=client.js.map
