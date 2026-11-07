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
async function requestRestart(reason = "webui-button") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/restart-dsh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
      signal: controller.signal
    });
    if (response.status === 202) {
      let delayMs = 3e3;
      try {
        const body = await response.json();
        if (typeof body.delayMs === "number") delayMs = body.delayMs;
      } catch {
      }
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
    clearTimeout(timer);
  }
}

// src/client/RestartButton.tsx
var import_jsx_runtime = require("react/jsx-runtime");
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
var proceedStyle = { ...buttonBase, background: "var(--dsw-alias-label-primary)", color: "var(--dsw-alias-bg-layer-3)" };
var errorStyle = { margin: "4px 0 0", color: "var(--dsw-alias-label-error)" };
var hintStyle = { margin: "8px 0 0", fontSize: 12, color: "var(--dsw-alias-label-tertiary)" };
function SpinnerGlyph({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { animation: "dsh-restart-spin 1s linear infinite" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "6", stroke: "var(--dsw-alias-label-tertiary)", strokeWidth: "2", opacity: "0.35" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M14 8a6 6 0 0 0-6-6", stroke: "var(--dsw-alias-label-secondary)", strokeWidth: "2", strokeLinecap: "round" })
  ] });
}
function RestartButton({ wide, t }) {
  const [phase, setPhase] = (0, import_react.useState)({ kind: "idle" });
  const [open, setOpen] = (0, import_react.useState)(false);
  const busyRef = (0, import_react.useRef)(false);
  const actionsRef = (0, import_react.useRef)({ close: () => {
  }, confirm: () => {
  } });
  (0, import_react.useEffect)(() => {
    document.querySelectorAll('style[id^="dsh-restart-css"]').forEach((stale) => stale.remove());
    const style = document.createElement("style");
    style.id = "dsh-restart-css-v5";
    style.textContent = [
      ".dsh-restart-trigger{background:transparent;color:var(--dsw-alias-label-secondary);transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}",
      ".dsh-restart-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-restart-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}",
      ".dsh-restart-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);outline:none}",
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
  const close = (0, import_react.useCallback)(() => {
    busyRef.current = false;
    setOpen(false);
    setPhase({ kind: "idle" });
  }, []);
  const run = (0, import_react.useCallback)(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase({ kind: "requesting" });
    let result;
    try {
      result = await requestRestart("webui-button");
    } catch {
      result = { status: "unknown" };
    }
    busyRef.current = false;
    if (result.status === "accepted") {
      setPhase({ kind: "accepted" });
      setOpen(true);
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
    setOpen(true);
  }, [t]);
  const confirm = (0, import_react.useCallback)(() => {
    void run();
  }, [run]);
  (0, import_react.useEffect)(() => {
    actionsRef.current = { close, confirm };
  });
  (0, import_react.useEffect)(() => {
    const handler = (event) => {
      const target = event.target;
      const element = target?.closest?.("[data-dsh-restart-action]");
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const action = element.getAttribute("data-dsh-restart-action");
      if (action === "cancel" || action === "close") actionsRef.current.close();
      else if (action === "proceed") actionsRef.current.confirm();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
  const label = t("restart.label");
  const requesting = phase.kind === "requesting";
  const trigger = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      className: "dsh-restart-trigger",
      style: wide ? triggerStyle : triggerRailStyle,
      "aria-label": label,
      "aria-busy": requesting || void 0,
      disabled: requesting,
      title: requesting ? t("restart.requesting") : label,
      onClick: () => {
        setPhase({ kind: "confirming" });
        setOpen(true);
      },
      children: requesting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpinnerGlyph, { size: wide ? 16 : 18 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RestartGlyph, { size: wide ? 16 : 18 })
    }
  );
  const dialog = open && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: overlayStyle, role: "presentation", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: maskStyle, "aria-hidden": "true", onClick: requesting ? void 0 : close }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: dialogStyle, role: "dialog", "aria-modal": "true", "aria-label": label, children: [
      phase.kind === "confirming" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: titleStyle, children: t("restart.confirm.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: bodyStyle, children: t("restart.confirm.body") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: actionsStyle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-dsh-restart-action": "cancel", style: cancelStyle, onClick: close, children: t("restart.cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-dsh-restart-action": "proceed", style: proceedStyle, onClick: confirm, children: t("restart.proceed") })
        ] })
      ] }),
      phase.kind === "requesting" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpinnerGlyph, { size: 18 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: titleStyle, children: t("restart.requesting") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: t("restart.requestingHint") })
        ] })
      ] }),
      phase.kind === "accepted" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: titleStyle, children: t("restart.accepted") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: t("restart.acceptedHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: actionsStyle, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-dsh-restart-action": "close", style: cancelStyle, onClick: close, children: t("restart.close") }) })
      ] }),
      phase.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: errorStyle, children: phase.message }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: actionsStyle, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-dsh-restart-action": "close", style: cancelStyle, onClick: close, children: t("restart.close") }) })
      ] })
    ] })
  ] }), document.body);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    trigger,
    dialog
  ] });
}

// src/client/index.ts
var NS = "restart-dsh";
var en = {
  "restart.label": "Restart DeepSeek Harness",
  "restart.confirm.title": "Restart the DeepSeek Harness service?",
  "restart.confirm.body": "Restarting will interrupt in-flight tasks and will not resume them automatically. Please restart after your tasks are done.",
  "restart.cancel": "Cancel",
  "restart.proceed": "Restart",
  "restart.requesting": "Submitting restart request...",
  "restart.requestingHint": "This only submits the request; it does not wait for recovery.",
  "restart.accepted": "Restart request accepted. Connection status is shown by DSH.",
  "restart.acceptedHint": "The service will restart in about 3 seconds.",
  "restart.conflict": "A restart request is already in progress.",
  "restart.suppressed": "The service just restarted; please wait a moment before trying again.",
  "restart.denied": "Restart is only available from this machine (loopback).",
  "restart.unsupported": "Restart is not supported on this platform.",
  "restart.unknown": "Could not confirm whether the restart request was accepted. Check the DSH connection status; do not retry repeatedly.",
  "restart.failed": "Restart request failed",
  "restart.close": "Close"
};
var zh = {
  "restart.label": "\u91CD\u542F DeepSeek Harness",
  "restart.confirm.title": "\u91CD\u542F DeepSeek Harness \u670D\u52A1\uFF1F",
  "restart.confirm.body": "\u91CD\u542F\u5C06\u4E2D\u65AD\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u7EED\u63A5\u3002\u5EFA\u8BAE\u4EFB\u52A1\u5B8C\u6210\u540E\u64CD\u4F5C\u3002",
  "restart.cancel": "\u53D6\u6D88",
  "restart.proceed": "\u91CD\u542F",
  "restart.requesting": "\u6B63\u5728\u63D0\u4EA4\u91CD\u542F\u8BF7\u6C42\u2026",
  "restart.requestingHint": "\u8FD9\u91CC\u53EA\u63D0\u4EA4\u8BF7\u6C42\uFF0C\u4E0D\u7B49\u5F85\u670D\u52A1\u6062\u590D\u3002",
  "restart.accepted": "\u91CD\u542F\u8BF7\u6C42\u5DF2\u63A5\u53D7\uFF0C\u540E\u7EED\u8FDE\u63A5\u72B6\u6001\u7531 DSH \u663E\u793A",
  "restart.acceptedHint": "\u670D\u52A1\u5C06\u5728\u7EA6 3 \u79D2\u540E\u91CD\u542F\u3002",
  "restart.conflict": "\u5DF2\u6709\u91CD\u542F\u8BF7\u6C42\u5728\u5904\u7406\u3002",
  "restart.suppressed": "\u670D\u52A1\u521A\u521A\u91CD\u542F\uFF0C\u8BF7\u7A0D\u5019\u518D\u8BD5\u3002",
  "restart.denied": "\u91CD\u542F\u4EC5\u9650\u672C\u673A\u8BBF\u95EE\uFF08loopback\uFF09\u3002",
  "restart.unsupported": "\u5F53\u524D\u5E73\u53F0\u4E0D\u652F\u6301\u91CD\u542F\u3002",
  "restart.unknown": "\u65E0\u6CD5\u786E\u8BA4\u91CD\u542F\u8BF7\u6C42\u662F\u5426\u88AB\u63A5\u53D7\uFF0C\u8BF7\u67E5\u770B DSH \u8FDE\u63A5\u72B6\u6001\uFF1B\u4E0D\u8981\u8FDE\u7EED\u91CD\u8BD5\u3002",
  "restart.failed": "\u91CD\u542F\u8BF7\u6C42\u5931\u8D25",
  "restart.close": "\u5173\u95ED"
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
