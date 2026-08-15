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
async function requestRestart(reason = "webui-button") {
  try {
    const response = await fetch("/api/restart-dsh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason })
    });
    if (response.status === 202) {
      const body = await response.json();
      return { status: "scheduled", delayMs: body.delayMs ?? 3e3 };
    }
    if (response.status === 409) return { status: "already-scheduled" };
    if (response.status === 429) return { status: "suppressed" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 501) return { status: "unsupported" };
    return { status: "error", message: `restart request failed (HTTP ${response.status})` };
  } catch {
    return { status: "error", message: "request failed (service may already be restarting)" };
  }
}
function waitForReconnect(timeoutMs = 3e4) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const probe = async () => {
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      try {
        const res = await fetch("/api/health", { method: "GET" });
        if (res.ok || res.status < 500) {
          resolve(true);
          return;
        }
      } catch {
      }
      setTimeout(() => void probe(), 1500);
    };
    void probe();
  });
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
var actionsStyle = { display: "flex", justifyContent: "flex-end", gap: 8 };
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
var successCardStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "4px 0 0",
  padding: "10px 14px",
  borderRadius: 12,
  background: "color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 12%, transparent)",
  border: "1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 28%, transparent)"
};
var successTitleStyle = { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" };
var successSubStyle = { margin: "2px 0 0", fontSize: 12, color: "var(--dsw-alias-label-secondary)" };
function CheckGlyph({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "7", fill: "color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 18%, transparent)" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.5 8.2l2.3 2.3 4.7-5", stroke: "var(--dsw-alias-state-success-primary, #3fb950)", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" })
  ] });
}
var errorStyle = { margin: "4px 0 0", color: "var(--dsw-alias-label-error)" };
var hintStyle = { margin: "8px 0 0", fontSize: 12, color: "var(--dsw-alias-label-tertiary)" };
function RestartButton({ wide, t }) {
  const [phase, setPhase] = (0, import_react.useState)({ kind: "idle" });
  const [open, setOpen] = (0, import_react.useState)(false);
  const [railHost, setRailHost] = (0, import_react.useState)(null);
  const timer = (0, import_react.useRef)(void 0);
  (0, import_react.useEffect)(() => {
    if (document.getElementById("dsh-restart-css")) return;
    const style = document.createElement("style");
    style.id = "dsh-restart-css";
    style.textContent = [
      ".dsh-restart-trigger{background:transparent;color:var(--dsw-alias-label-secondary);transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}",
      ".dsh-restart-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-restart-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}",
      ".dsh-restart-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);outline:none}"
    ].join("\n");
    document.head.appendChild(style);
  }, []);
  const triggerRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (wide || !railHost) return;
    const el = triggerRef.current;
    if (!el) return;
    const handler = () => {
      setPhase({ kind: "confirming" });
      setOpen(true);
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [wide, railHost]);
  (0, import_react.useEffect)(() => {
    if (wide) {
      setRailHost(null);
      return;
    }
    const findHost = () => {
      const phone = Array.from(document.querySelectorAll("button")).find((b) => {
        const l = b.getAttribute("aria-label") || "";
        return l.includes("\u79FB\u52A8\u7AEF\u8FDC\u7A0B\u63A7\u5236") || l.includes("Remote") || l.includes("\u8FDC\u7A0B");
      });
      return phone?.parentElement ?? null;
    };
    setRailHost(findHost());
    let tries = 0;
    const iv = window.setInterval(() => {
      tries += 1;
      const h = findHost();
      if (h || tries > 10) {
        setRailHost(h);
        window.clearInterval(iv);
      }
    }, 500);
    return () => window.clearInterval(iv);
  }, [wide]);
  (0, import_react.useEffect)(() => () => {
    if (timer.current !== void 0) window.clearTimeout(timer.current);
  }, []);
  (0, import_react.useEffect)(() => {
    let pending = false;
    try {
      pending = sessionStorage.getItem("dsh-restart-pending") === "1";
    } catch {
    }
    if (!pending) return;
    void (async () => {
      await waitForReconnect(45e3);
      try {
        sessionStorage.removeItem("dsh-restart-pending");
      } catch {
      }
      setPhase({ kind: "done" });
      setOpen(true);
      timer.current = window.setTimeout(() => {
        setOpen(false);
        setPhase({ kind: "idle" });
      }, 3500);
    })();
  }, []);
  const close = (0, import_react.useCallback)(() => {
    setOpen(false);
    if (phase.kind !== "busy") setPhase({ kind: "idle" });
  }, [phase.kind]);
  const run = (0, import_react.useCallback)(async () => {
    setPhase({ kind: "busy" });
    const result = await requestRestart("webui-button");
    if (result.status === "already-scheduled") {
      setPhase({ kind: "done" });
    } else if (result.status === "scheduled") {
      try {
        sessionStorage.setItem("dsh-restart-pending", "1");
      } catch {
      }
      await waitForReconnect(45e3);
      setPhase({ kind: "done" });
    } else if (result.status === "forbidden") {
      setPhase({ kind: "denied" });
    } else if (result.status === "suppressed") {
      setPhase({ kind: "failed", message: t("restart.suppressed") });
    } else if (result.status === "unsupported") {
      setPhase({ kind: "failed", message: t("restart.unsupported") });
    } else {
      setPhase({ kind: "failed", message: result.message });
    }
    timer.current = window.setTimeout(() => {
      setOpen(false);
      setPhase({ kind: "idle" });
    }, 3500);
  }, [t]);
  const confirm = (0, import_react.useCallback)(() => {
    void run();
  }, [run]);
  const label = t("restart.label");
  const trigger = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      ref: triggerRef,
      type: "button",
      className: "dsh-restart-trigger",
      style: wide ? triggerStyle : triggerRailStyle,
      "aria-label": label,
      title: label,
      onClick: () => {
        setPhase({ kind: "confirming" });
        setOpen(true);
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RestartGlyph, { size: wide ? 16 : 18 })
    }
  );
  const dialog = open && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: overlayStyle, role: "presentation", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: maskStyle, "aria-hidden": "true", onClick: close }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: dialogStyle, role: "dialog", "aria-modal": "true", "aria-label": label, children: [
      phase.kind === "confirming" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: titleStyle, children: t("restart.confirm.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: bodyStyle, children: t("restart.confirm.body") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: actionsStyle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: cancelStyle, onClick: close, children: t("restart.cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: proceedStyle, onClick: confirm, children: t("restart.proceed") })
        ] })
      ] }),
      phase.kind === "busy" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: titleStyle, children: t("restart.busy") }),
      phase.kind === "done" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: successCardStyle, role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckGlyph, { size: 18 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: successTitleStyle, children: t("restart.done") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: successSubStyle, children: "DeepSeek Harness" })
        ] })
      ] }),
      phase.kind === "denied" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: errorStyle, children: t("restart.denied") }),
      phase.kind === "failed" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: errorStyle, children: phase.message }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: t("restart.failedHint") })
      ] })
    ] })
  ] }), document.body);
  if (!wide && railHost) {
    return (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        trigger,
        dialog
      ] }),
      railHost
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    trigger,
    dialog
  ] });
}

// src/client/index.ts
var NS = "restart-dsh";
var en = {
  "restart.label": "Restart DeepSeek Harness",
  "restart.confirm.title": "Restart DeepSeek Harness service?",
  "restart.confirm.body": "In-flight agent tasks will be interrupted and resumed automatically. The page will reconnect in a few seconds.",
  "restart.cancel": "Cancel",
  "restart.proceed": "Restart",
  "restart.busy": "Restarting\u2026 the page will reconnect automatically.",
  "restart.done": "Reconnected. The service restarted successfully.",
  "restart.denied": "Restart is only available from this machine (loopback).",
  "restart.failedHint": "If the service does not come back, run: systemctl --user status dsh-web",
  "restart.suppressed": "The service just restarted; please wait a moment before trying again.",
  "restart.unsupported": "Restart is not supported on this platform. Run: systemctl --user restart dsh-web"
};
var zh = {
  "restart.label": "\u91CD\u542F DeepSeek Harness",
  "restart.confirm.title": "\u91CD\u542F DeepSeek Harness \u670D\u52A1\uFF1F",
  "restart.confirm.body": "\u8FDB\u884C\u4E2D\u7684 agent \u4EFB\u52A1\u5C06\u4E2D\u65AD\u5E76\u81EA\u52A8\u7EED\u63A5\uFF0C\u9875\u9762\u7EA6\u51E0\u79D2\u540E\u81EA\u52A8\u91CD\u8FDE\u3002",
  "restart.cancel": "\u53D6\u6D88",
  "restart.proceed": "\u91CD\u542F",
  "restart.busy": "\u6B63\u5728\u91CD\u542F\u2026\u9875\u9762\u5C06\u81EA\u52A8\u91CD\u8FDE\u3002",
  "restart.done": "\u5DF2\u91CD\u8FDE\uFF0C\u670D\u52A1\u91CD\u542F\u6210\u529F\u3002",
  "restart.denied": "\u91CD\u542F\u4EC5\u9650\u672C\u673A\u8BBF\u95EE\uFF08loopback\uFF09\u3002",
  "restart.failedHint": "\u82E5\u670D\u52A1\u672A\u6062\u590D\uFF0C\u8BF7\u624B\u52A8\u6267\u884C\uFF1Asystemctl --user status dsh-web",
  "restart.suppressed": "\u670D\u52A1\u521A\u521A\u91CD\u542F\uFF0C\u8BF7\u7A0D\u5019\u518D\u8BD5\u3002",
  "restart.unsupported": "\u5F53\u524D\u5E73\u53F0\u4E0D\u652F\u6301\u91CD\u542F\uFF0C\u8BF7\u624B\u52A8\u6267\u884C\uFF1Asystemctl --user restart dsh-web"
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

//# sourceMappingURL=index.js.map
