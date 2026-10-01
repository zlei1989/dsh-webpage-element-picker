window.__ModuleLoader__.load({
  id: "dsh-webpage-element-picker",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

"use strict";

// src/client/react.ts
var React = require("react");
var h = React.createElement;

// src/client/primitives.ts
var PRIMITIVES_MODULE = "@deepseek-ai/dsh-client-ui-primitives";
function loadPrimitives() {
  try {
    const mod = require(PRIMITIVES_MODULE);
    if (!mod || mod.Modal == null || mod.Button == null) {
      return { module: null, error: "\u6A21\u5757\u8868\u5DF2\u5E94\u7B54\u4F46\u7F3A\u5C11 Modal/Button \u5BFC\u51FA" };
    }
    return { module: mod, error: "" };
  } catch (err) {
    const e = err;
    return { module: null, error: String(e && e.message || err || "\u672A\u77E5\u9519\u8BEF") };
  }
}
var PRIMITIVES = loadPrimitives();

// src/client/index.ts
var PLUGIN_ID = "dsh-webpage-element-picker";
var INVOKE_PATH = "/dsh-webpage-element-picker/invoke";
var BROWSER_STORAGE_KEY = "dsh-webpage-element-picker.browser";
var LOG_PREFIX = "[dsh-webpage-element-picker]";
function logDebug(msg) {
  console.debug(LOG_PREFIX + " [DEBUG] " + msg);
}
function logInfo(msg) {
  console.info(LOG_PREFIX + " [INFO] " + msg);
}
function logError(msg, err) {
  const e = err;
  const detail = e && e.stack ? e.stack : String(e && e.message || err || "");
  console.error(LOG_PREFIX + " [ERROR] " + msg + (detail ? "\n" + detail : ""));
}
function renderButton(props) {
  const el = h;
  if (PRIMITIVES.module) return el(PRIMITIVES.module.Button, props);
  const primary = props.variant === "primary";
  const className = (primary ? "dsh-we-btnPrimary" : "dsh-we-btnOutline") + (props.className ? " " + props.className : "");
  return el(
    "button",
    {
      type: "button",
      className,
      onClick: props.onClick,
      disabled: props.disabled,
      title: props.title,
      "aria-haspopup": props["aria-haspopup"],
      "aria-expanded": props["aria-expanded"],
      "aria-label": props["aria-label"]
    },
    props.icon != null ? el("span", { className: "dsh-we-btnIcon" }, props.icon) : null,
    props.children
  );
}
function renderDialogShell(props) {
  const el = h;
  if (PRIMITIVES.module) return el(PRIMITIVES.module.Modal, props);
  return el(
    "div",
    {
      className: "dsh-we-overlay",
      role: "presentation",
      onMouseDown: function(e) {
        if (e.target === e.currentTarget || e.target.className === "dsh-we-mask") props.onClose();
      }
    },
    el("div", { className: "dsh-we-mask", "aria-hidden": "true" }),
    el(
      "div",
      { className: "dsh-we-panel dsh-we-dialog", role: "dialog", "aria-modal": "true", "aria-label": props.title },
      el(
        "div",
        { className: "dsh-we-fallbackHeader" },
        el("h2", { className: "dsh-we-fallbackTitle" }, props.title),
        el("button", { type: "button", className: "dsh-we-fallbackClose", "aria-label": props.closeLabel, onClick: props.onClose }, "\xD7")
      ),
      props.children
    )
  );
}
var STYLE_CSS = (
  // ---- 兜底层：Modal 原语不可用时的卡片外观（约等于原语 Modal 的实现） ----
  ".dsh-we-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }.dsh-we-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); backdrop-filter: var(--dsw-mask-blur); }.dsh-we-panel { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px; width: min(380px, 100%); padding: 0 0 24px; overflow: hidden; border: 0; border-radius: 24px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }.dsh-we-panelBody { display: flex; flex-direction: column; gap: 20px; }.dsh-we-dialog.dsh-we-dialog { width: min(560px, 100%); gap: 0; padding-bottom: 20px; }.dsh-we-fallbackHeader { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 12px 24px; }.dsh-we-fallbackTitle { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }.dsh-we-fallbackClose { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 18px; line-height: 1; cursor: pointer; }.dsh-we-fallbackClose:hover { background: var(--dsw-alias-interactive-bg-hover); }.dsh-we-btnOutline, .dsh-we-btnPrimary { display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 14px; border-radius: 18px; font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }.dsh-we-btnOutline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }.dsh-we-btnOutline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }.dsh-we-btnPrimary { border: none; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }.dsh-we-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }.dsh-we-btnOutline:disabled, .dsh-we-btnPrimary:disabled { opacity: 0.4; cursor: not-allowed; }.dsh-we-btnIcon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; }.dsh-we-body { display: flex; flex-direction: column; gap: 10px; padding: 0 24px; }.dsh-we-input { box-sizing: border-box; width: 100%; min-height: 92px; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); font-size: 14px; line-height: 22px; resize: vertical; outline: none; transition: border-color 120ms ease, box-shadow 120ms ease; }.dsh-we-input::placeholder { color: var(--dsw-alias-label-caption); }.dsh-we-input:focus { border-color: var(--dsw-alias-border-l3); box-shadow: 0 0 0 1px var(--dsw-alias-border-l3); }.dsh-we-status { font-size: 13px; line-height: 20px; color: var(--dsw-alias-state-business-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.dsh-we-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption); }.dsh-we-notice { font-size: 12px; line-height: 18px; }.dsh-we-noticeInfo { color: var(--dsw-alias-state-warn-label); }.dsh-we-noticeError { color: var(--dsw-alias-state-error-primary); }.dsh-we-footer { display: flex; align-items: center; gap: 8px; justify-content: space-between; padding: 16px 24px 0; border-top: 0.5px solid var(--dsw-alias-border-l1); }.dsh-we-dialogPrimitive .dsh-we-body, .dsh-we-dialogPrimitive .dsh-we-footer { padding-left: 0; padding-right: 0; }.dsh-we-footerLeft { position: relative; display: flex; align-items: center; }.dsh-we-footerRight { display: flex; align-items: center; gap: 8px; }.dsh-we-ctxCount { padding: 4px 8px; border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; cursor: default; user-select: none; }.dsh-we-ctxCount:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }.dsh-we-menu { position: absolute; left: 0; bottom: 100%; z-index: 1; display: flex; flex-direction: column; width: 280px; overflow: hidden; border: 0; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-panel); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }.dsh-we-menuHeader { padding: 8px 10px 6px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }.dsh-we-menuList { max-height: 200px; overflow-y: auto; }.dsh-we-menuItem { display: flex; gap: 8px; align-items: baseline; width: 100%; padding: 6px 10px; border: none; background: transparent; font-family: inherit; text-align: left; cursor: pointer; }.dsh-we-menuItem:hover { background: var(--dsw-alias-interactive-bg-hover); }.dsh-we-menuItemId { flex-shrink: 0; color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 18px; }.dsh-we-menuItemLabel { overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }.dsh-we-menuEmpty { padding: 12px 10px; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; text-align: center; }.dsh-we-menuRetry { display: block; margin: 8px auto 0; padding: 4px 12px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }.dsh-we-menuRetry:hover { background: var(--dsw-alias-interactive-bg-hover); }.dsh-we-menuFooter { display: flex; justify-content: flex-end; padding: 6px 10px; border-top: 0.5px solid var(--dsw-alias-border-l1); }.dsh-we-menuRight { left: auto; right: 0; width: 240px; }.dsh-we-menuItemCheck { flex: none; width: 12px; color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 18px; }.dsh-we-menuItemActive .dsh-we-menuItemLabel { font-weight: 500; }.dsh-we-split { position: relative; display: inline-flex; align-items: stretch; }.dsh-we-splitMain.dsh-we-splitMain { border-top-right-radius: 0; border-bottom-right-radius: 0; }.dsh-we-splitArrow.dsh-we-splitArrow { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 0.5px solid var(--dsw-alias-bg-layer-2); padding: 0 8px; }.dsh-we-splitArrow.dsh-we-splitArrow.dsh-we-splitArrowOpen { background: var(--dsw-alias-button-primary-hover); }.dsh-we-iconBtn { display: inline-flex; align-items: center; justify-content: center; padding: 5px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }.dsh-we-iconBtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }.dsh-we-iconBtn:disabled { opacity: 0.4; cursor: default; }.dsh-we-iconBtn:focus-visible, .dsh-we-input:focus-visible, .dsh-we-fallbackClose:focus-visible, .dsh-we-menuItem:focus-visible, .dsh-we-splitArrow:focus-visible { outline: 2px solid var(--dsw-alias-button-primary-fill); outline-offset: 2px; }@media (prefers-reduced-motion: reduce) { .dsh-we-input { transition: none; } }"
);
function hostCall(method, params) {
  const base = typeof window !== "undefined" && window.location && window.location.origin ? window.location.origin : "";
  const startedAt = Date.now();
  logDebug("host \u8C03\u7528: " + method + " \u53C2\u6570: " + JSON.stringify(params || {}));
  return fetch(base + INVOKE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params: params || {} })
  }).then((res) => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then((value) => {
    const cost = Date.now() - startedAt;
    if (cost > 500) logInfo("host \u8C03\u7528 " + method + " \u8017\u65F6 " + cost + "ms");
    return value;
  });
}
function readStoredBrowser() {
  try {
    const raw = window.localStorage.getItem(BROWSER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const path = typeof parsed.path === "string" ? parsed.path.trim() : "";
    if (!path) return null;
    const name = typeof parsed.name === "string" && parsed.name ? parsed.name : "Browser";
    logDebug("\u5DF2\u6062\u590D\u8BB0\u4F4F\u7684\u6D4F\u89C8\u5668: " + name + "\uFF08" + path + "\uFF09");
    return { name, path };
  } catch (err) {
    logDebug("\u8BFB\u53D6 localStorage \u4E2D\u7684\u6D4F\u89C8\u5668\u9009\u62E9\u5931\u8D25\uFF08\u6309\u672A\u9009\u62E9\u5904\u7406\uFF09: " + String(err && err.message || err));
    return null;
  }
}
function storeBrowser(choice) {
  try {
    if (choice) window.localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(choice));
    else window.localStorage.removeItem(BROWSER_STORAGE_KEY);
  } catch (err) {
    logDebug("\u5199\u5165 localStorage \u5931\u8D25\uFF08\u9009\u62E9\u4EC5\u5728\u672C\u6B21\u4F1A\u8BDD\u5185\u6709\u6548\uFF09: " + String(err && err.message || err));
  }
}
function normalizeUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return { ok: false, error: "\u8BF7\u5148\u8F93\u5165\u7F51\u5740" };
  if (/^https?:\/\//i.test(url)) return { ok: true, url };
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i);
  if (!scheme) return { ok: true, url: "https://" + url };
  const name = scheme[1].toLowerCase();
  if (name === "http" || name === "https") {
    return { ok: true, url: name + "://" + url.slice(scheme[0].length).replace(/^\/+/, "") };
  }
  return { ok: false, error: "\u53EA\u652F\u6301 http/https \u7F51\u5740\uFF08\u4E0D\u652F\u6301 " + name + ": \u534F\u8BAE\uFF09" };
}
function shortText(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 10 ? t.slice(0, 10) + "\u2026" : t;
}
function labelOf(p) {
  if (p.textContent) return shortText(p.textContent);
  const attrs = p.attributes || {};
  const keys = ["aria-label", "placeholder", "alt", "title", "value"];
  for (const key of keys) {
    if (attrs[key]) return shortText(attrs[key]);
  }
  const tag = String(p.tagName || "?");
  if (p.id) return tag + "#" + String(p.id);
  const cls = String(p.className || "").trim().split(/\s+/).slice(0, 2).join(".");
  if (cls) return tag + "." + cls;
  return tag;
}
function placeholderLine(item) {
  const p = item.payload || {};
  const id = item.domId || "DOM";
  const label = labelOf(p);
  if (!label || label === "?") return "[" + id + "]";
  return "[" + label + "][" + id + "]";
}
function crosshairIcon(el) {
  return el(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round"
    },
    el("circle", { cx: 12, cy: 12, r: 7 }),
    el("line", { x1: 12, y1: 2, x2: 12, y2: 6 }),
    el("line", { x1: 12, y1: 18, x2: 12, y2: 22 }),
    el("line", { x1: 2, y1: 12, x2: 6, y2: 12 }),
    el("line", { x1: 18, y1: 12, x2: 22, y2: 12 })
  );
}
function chevronDownIcon(el) {
  return el(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2.5,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    },
    el("polyline", { points: "6 9 12 15 18 9" })
  );
}
function PickerEntry(props) {
  const el = h;
  const input = props.useInput ? props.useInput(function(s) {
    return s;
  }) : { draft: "" };
  const st = React.useState(function() {
    return { afterSeq: 0, draft: "", synced: false, clearTimer: 0 };
  })[0];
  st.draft = input.draft;
  const openState = React.useState(false);
  const open = openState[0];
  const setOpen = openState[1];
  const urlState = React.useState("");
  const urlText = urlState[0];
  const setUrlText = urlState[1];
  const busyState = React.useState(false);
  const busy = busyState[0];
  const setBusy = busyState[1];
  const statusState2 = React.useState(null);
  const status = statusState2[0];
  const setStatus = statusState2[1];
  const noticeState = React.useState(null);
  const notice = noticeState[0];
  const setNotice = noticeState[1];
  const contextCountState = React.useState(0);
  const contextCount = contextCountState[0];
  const setContextCount = contextCountState[1];
  const menuOpenState = React.useState(false);
  const menuOpen = menuOpenState[0];
  const setMenuOpen = menuOpenState[1];
  const contextItemsState = React.useState([]);
  const contextItems = contextItemsState[0];
  const setContextItems = contextItemsState[1];
  const clearArmedState = React.useState(false);
  const clearArmed = clearArmedState[0];
  const setClearArmed = clearArmedState[1];
  const browserChoiceState = React.useState(readStoredBrowser);
  const browserChoice = browserChoiceState[0];
  const setBrowserChoice = browserChoiceState[1];
  const browserMenuState = React.useState(false);
  const browserMenuOpen = browserMenuState[0];
  const setBrowserMenuOpen = browserMenuState[1];
  const browserListState = React.useState(
    function() {
      return { status: "idle", error: "", items: [], current: null };
    }
  );
  const browserList = browserListState[0];
  const setBrowserList = browserListState[1];
  const splitRef = React.useRef(null);
  const splitRefCb = function(node) {
    splitRef.current = node;
  };
  const statusState = status ? status.state : null;
  const showNotice = function(text, tone) {
    const next = { text, tone: tone || "info" };
    setNotice(next);
    window.setTimeout(function() {
      setNotice(function(cur) {
        return cur && cur.text === text ? null : cur;
      });
    }, 5e3);
  };
  const insertElements = function(elements) {
    const fresh = elements.filter(function(e) {
      return e.seq > st.afterSeq;
    });
    if (!fresh.length) return;
    let draft = st.draft;
    for (const item of fresh) {
      draft += (draft ? "\n" : "") + placeholderLine(item);
    }
    if (props.inputActions && typeof props.inputActions.setDraft === "function") {
      props.inputActions.setDraft(draft);
    }
    st.draft = draft;
    st.afterSeq = fresh[fresh.length - 1].seq;
    logDebug("\u5DF2\u63D2\u5165 " + fresh.length + " \u4E2A\u5360\u4F4D\u7B26: " + fresh.map(function(e) {
      return e.domId;
    }).join(", "));
  };
  const loadContextItems = function() {
    hostCall("picker-context-list", {}).then(function(res) {
      if (!res || !res.ok) return;
      setContextItems(res.items || []);
      if (typeof res.contextCount === "number") setContextCount(res.contextCount);
    }).catch(function(err) {
      logDebug("picker-context-list \u5931\u8D25\uFF08\u83DC\u5355\u4FDD\u7559\u65E7\u6570\u636E\uFF09: " + String(err && err.message || err));
    });
  };
  const loadBrowsers = function() {
    setBrowserList(function(cur) {
      return { status: "loading", error: "", items: cur.items, current: cur.current };
    });
    hostCall("picker-browsers", {}).then(function(res) {
      if (res && res.ok) {
        setBrowserList({ status: "idle", error: "", items: res.browsers || [], current: res.current || null });
      } else {
        setBrowserList(function(cur) {
          return { status: "error", error: res && res.error || "\u672A\u77E5\u9519\u8BEF", items: cur.items, current: cur.current };
        });
      }
    }).catch(function(err) {
      const message = String(err && err.message || err);
      logDebug("picker-browsers \u5931\u8D25\uFF08\u83DC\u5355\u663E\u793A\u9519\u8BEF\u63D0\u793A\uFF09: " + message);
      const stale = message.indexOf("404") >= 0;
      setBrowserList(function(cur) {
        return { status: stale ? "stale" : "error", error: message, items: cur.items, current: cur.current };
      });
    });
  };
  const toggleBrowserMenu = function() {
    if (browserMenuOpen) {
      setBrowserMenuOpen(false);
      return;
    }
    setBrowserMenuOpen(true);
    logDebug("\u5C55\u5F00\u6D4F\u89C8\u5668\u83DC\u5355\uFF0C\u5F00\u59CB\u63A2\u6D4B\u7CFB\u7EDF\u6D4F\u89C8\u5668");
    loadBrowsers();
  };
  const selectBrowser = function(choice) {
    setBrowserChoice(choice);
    storeBrowser(choice);
    setBrowserMenuOpen(false);
    if (choice) {
      logInfo("\u7528\u6237\u9009\u62E9\u6D4F\u89C8\u5668: " + choice.name + "\uFF08" + choice.path + "\uFF09");
      showNotice("\u5DF2\u8BB0\u4F4F\u6D4F\u89C8\u5668 " + choice.name + "\uFF0C\u70B9\u300C\u6253\u5F00\u300D\u65F6\u4F7F\u7528");
    } else {
      logInfo("\u7528\u6237\u6539\u56DE\u81EA\u52A8\u63A2\u6D4B\u6D4F\u89C8\u5668");
      showNotice("\u5DF2\u6539\u56DE\u81EA\u52A8\u63A2\u6D4B\uFF08\u6309 Chrome > Edge > Chromium > Brave > Opera \u4F18\u5148\u7EA7\uFF09");
    }
  };
  const insertContextItem = function(item) {
    const label = item.label && item.label !== "?" ? item.label : "";
    const line = label ? "[" + label + "][" + item.domId + "]" : "[" + item.domId + "]";
    const draft = (st.draft ? st.draft + "\n" : "") + line;
    if (props.inputActions && typeof props.inputActions.setDraft === "function") {
      props.inputActions.setDraft(draft);
    }
    st.draft = draft;
    setMenuOpen(false);
    setClearArmed(false);
    logDebug("\u5DF2\u4ECE\u5386\u53F2\u83DC\u5355\u63D2\u5165\u5360\u4F4D\u7B26: " + item.domId);
    showNotice("\u5DF2\u63D2\u5165 " + item.domId + " \u5230\u8F93\u5165\u6846");
  };
  const onClearClick = function() {
    if (!clearArmed) {
      setClearArmed(true);
      if (st.clearTimer) window.clearTimeout(st.clearTimer);
      st.clearTimer = window.setTimeout(function() {
        st.clearTimer = 0;
        setClearArmed(false);
      }, 3e3);
      return;
    }
    if (st.clearTimer) {
      window.clearTimeout(st.clearTimer);
      st.clearTimer = 0;
    }
    setClearArmed(false);
    logInfo("\u7528\u6237\u786E\u8BA4\u6E05\u7A7A\u5168\u90E8\u4E0A\u4E0B\u6587\u8282\u70B9");
    hostCall("picker-clear-context", {}).then(function(res) {
      if (res && res.ok) {
        setContextItems([]);
        setContextCount(0);
        showNotice("\u5DF2\u6E05\u7A7A\u5168\u90E8\u4E0A\u4E0B\u6587\u8282\u70B9\uFF08\u8F93\u5165\u6846\u4E2D\u5DF2\u6709\u5360\u4F4D\u7B26\u7684\u5F15\u7528\u5C06\u5931\u6548\uFF09");
      } else {
        showNotice("\u6E05\u7A7A\u5931\u8D25\uFF1A" + (res && res.error || "\u672A\u77E5\u9519\u8BEF"), "error");
      }
    }).catch(function(err) {
      logError("\u6E05\u7A7A\u4E0A\u4E0B\u6587\u5931\u8D25", err);
      showNotice("\u6E05\u7A7A\u5931\u8D25\uFF1A" + String(err && err.message || err), "error");
    });
  };
  const processPullResponse = function(res, dialogOpen) {
    if (res.status) setStatus(res.status);
    if (typeof res.contextCount === "number") setContextCount(res.contextCount);
    if (!st.synced) {
      st.synced = true;
      st.afterSeq = typeof res.lastSeq === "number" ? res.lastSeq : 0;
      logDebug("\u8F6E\u8BE2\u57FA\u7EBF\u5DF2\u5EFA\u7ACB: afterSeq=" + st.afterSeq);
      return;
    }
    const elements = res.elements || [];
    if (elements.length) {
      insertElements(elements);
      if (dialogOpen) showNotice("\u5DF2\u6DFB\u52A0 " + elements.length + " \u4E2A\u9875\u9762\u5143\u7D20\u5230\u8F93\u5165\u6846");
    }
  };
  React.useEffect(function() {
    let cancelled = false;
    hostCall("picker-pull", { afterSeq: st.afterSeq }).then(function(res) {
      if (cancelled || !res) return;
      processPullResponse(res, false);
    }).catch(function(err) {
      logDebug("\u6302\u8F7D\u64AD\u79CD picker-pull \u5931\u8D25\uFF08\u6D4F\u89C8\u5668\u672A\u5C31\u7EEA\uFF09\uFF0C\u5FFD\u7565: " + String(err && err.message || err));
    });
    return function() {
      cancelled = true;
    };
  }, []);
  React.useEffect(function() {
    return function() {
      if (st.clearTimer) {
        window.clearTimeout(st.clearTimer);
        st.clearTimer = 0;
      }
    };
  }, []);
  React.useEffect(function() {
    if (!browserMenuOpen) return;
    const onPointerDown = function(e) {
      const target = e.target;
      if (splitRef.current && target && splitRef.current.contains(target)) return;
      setBrowserMenuOpen(false);
    };
    const onKeyDown = function(e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setBrowserMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return function() {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [browserMenuOpen]);
  React.useEffect(function() {
    if (!open && statusState !== "open") return;
    let cancelled = false;
    const poll = function() {
      hostCall("picker-pull", { afterSeq: st.afterSeq }).then(function(res) {
        if (cancelled || !res) return;
        processPullResponse(res, open);
      }).catch(function(err) {
        logDebug("picker-pull \u5931\u8D25\uFF08\u6D4F\u89C8\u5668\u672A\u5C31\u7EEA\uFF09\uFF0C\u7EE7\u7EED\u8F6E\u8BE2: " + String(err && err.message || err));
      });
    };
    poll();
    const intervalId = window.setInterval(poll, 1500);
    return function() {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [open, statusState]);
  const firstUrlLine = function() {
    return String(urlText || "").split("\n").map(function(s) {
      return s.trim();
    }).filter(Boolean)[0] || "";
  };
  const onConfirm = function() {
    const norm = normalizeUrl(firstUrlLine());
    if (!norm.ok) {
      logDebug("\u7F51\u5740\u6821\u9A8C\u672A\u901A\u8FC7: " + norm.error);
      showNotice(norm.error, "error");
      return;
    }
    const url = norm.url;
    const lines = String(urlText || "").split("\n");
    const firstAt = lines.findIndex(function(s) {
      return !!s.trim();
    });
    if (firstAt >= 0 && lines[firstAt] !== url) {
      lines[firstAt] = url;
      setUrlText(lines.join("\n"));
    }
    logInfo("\u7528\u6237\u8BF7\u6C42\u6253\u5F00\u7F51\u5740: " + url + (browserChoice ? "\uFF08\u6D4F\u89C8\u5668: " + browserChoice.name + "\uFF09" : "\uFF08\u6D4F\u89C8\u5668: \u81EA\u52A8\u63A2\u6D4B\uFF09"));
    setBusy(true);
    const params = { url };
    if (browserChoice) params.browser = browserChoice;
    hostCall("picker-navigate", params).then(function(res) {
      if (res && res.ok) {
        const nextStatus = Object.assign({ state: "open" }, res.status || { url });
        setStatus(nextStatus);
        const used = nextStatus.browser || "";
        if (browserChoice && used && used.toLowerCase() !== browserChoice.name.toLowerCase()) {
          logDebug("\u6240\u7528\u6D4F\u89C8\u5668\u4E0E\u9009\u62E9\u4E0D\u4E00\u81F4: \u9009\u62E9 " + browserChoice.name + "\uFF0C\u5B9E\u9645 " + used);
          showNotice("\u6240\u9009\u6D4F\u89C8\u5668 " + browserChoice.name + " \u4E0D\u53EF\u7528\uFF0C\u5DF2\u6539\u7528 " + used, "error");
        } else {
          setOpen(false);
        }
      } else {
        showNotice("\u6253\u5F00\u5931\u8D25\uFF1A" + (res && res.error || "\u672A\u77E5\u9519\u8BEF"), "error");
      }
    }).catch(function(err) {
      logError("\u6253\u5F00\u7F51\u5740\u5931\u8D25: " + url, err);
      showNotice("\u6253\u5F00\u5931\u8D25\uFF1A" + String(err && err.message || err), "error");
    }).finally(function() {
      setBusy(false);
    });
  };
  const onReinject = function() {
    const url = firstUrlLine();
    logInfo("\u7528\u6237\u8BF7\u6C42\u91CD\u65B0\u6CE8\u5165\u9009\u62E9\u529F\u80FD\uFF08\u515C\u5E95\u7F51\u5740: " + (url || "\u65E0") + "\uFF09");
    setBusy(true);
    const params = { url };
    if (browserChoice) params.browser = browserChoice;
    hostCall("picker-reinject", params).then(function(res) {
      if (res && res.ok) {
        const nextStatus = Object.assign({ state: "open" }, res.status || status);
        setStatus(nextStatus);
        showNotice(res.reopened ? "\u6D4F\u89C8\u5668\u672A\u6253\u5F00\uFF0C\u5DF2\u5148\u6253\u5F00\u8BE5\u7F51\u5740\u5E76\u6CE8\u5165\u9009\u62E9\u529F\u80FD" : "\u5DF2\u91CD\u65B0\u6CE8\u5165\u9009\u62E9\u529F\u80FD");
      } else {
        showNotice("\u91CD\u65B0\u6CE8\u5165\u5931\u8D25\uFF1A" + (res && res.error || "\u672A\u77E5\u9519\u8BEF"), "error");
      }
    }).catch(function(err) {
      logError("\u91CD\u65B0\u6CE8\u5165\u5931\u8D25", err);
      showNotice("\u91CD\u65B0\u6CE8\u5165\u5931\u8D25\uFF1A" + String(err && err.message || err), "error");
    }).finally(function() {
      setBusy(false);
    });
  };
  const browserLabel = status && status.browser ? "\u6D4F\u89C8\u5668: " + status.browser + " \xB7 " : "";
  const tooltip = status ? status.message || (status.state === "open" ? browserLabel + "\u5DF2\u6253\u5F00: " + (status.title || status.url || "") + (status.modeExited ? " \xB7 \u9009\u62E9\u6A21\u5F0F\u5DF2\u9000\u51FA\uFF08\u70B9\u51FB\u56FE\u6807\u53EF\u91CD\u65B0\u6253\u5F00\uFF09" : status.injected ? " \xB7 \u5DF2\u6CE8\u5165\u9009\u62E9\u529F\u80FD" : "") : "") : "";
  const buttonTitle = tooltip || "\u6253\u5F00\u6D4F\u89C8\u5668\u5E76\u9009\u62E9\u9875\u9762\u5143\u7D20";
  const browserChoiceLabel = browserChoice ? browserChoice.name : "\u81EA\u52A8\u63A2\u6D4B";
  const statusLine = status ? "\u72B6\u6001\uFF1A" + (status.message || (status.state === "open" ? browserLabel + "\u5DF2\u6253\u5F00 " + (status.url || "") + (status.modeExited ? " \xB7 \u9009\u62E9\u6A21\u5F0F\u5DF2\u9000\u51FA" : status.injected ? " \xB7 \u5DF2\u6CE8\u5165\u9009\u62E9\u529F\u80FD" : "") : status.state === "ready" ? "\u6D4F\u89C8\u5668\u5DF2\u5C31\u7EEA" : status.state)) : "";
  const renderBrowserOption = function(option, running) {
    const selected = option ? !!browserChoice && browserChoice.path.toLowerCase() === option.path.toLowerCase() : !browserChoice;
    const name = option ? option.name : "\u81EA\u52A8\u63A2\u6D4B";
    const detail = option ? option.exists ? "" : "\uFF08\u672A\u68C0\u6D4B\u5230\uFF09" : "\uFF08\u7CFB\u7EDF\u4F18\u5148\u7EA7\uFF09";
    const choice = option ? { name: option.name, path: option.path } : null;
    return el(
      "button",
      {
        key: option ? option.path : "__auto__",
        type: "button",
        role: "menuitem",
        className: "dsh-we-menuItem" + (selected ? " dsh-we-menuItemActive" : ""),
        title: option ? option.path : "\u6309\u7CFB\u7EDF\u4F18\u5148\u7EA7\u81EA\u52A8\u63A2\u6D4B\uFF08\u4E0D\u4F7F\u7528\u8BB0\u4F4F\u7684\u9009\u62E9\uFF09",
        onClick: function() {
          selectBrowser(choice);
        }
      },
      el("span", { className: "dsh-we-menuItemCheck", "aria-hidden": "true" }, selected ? "\u2713" : ""),
      el("span", { className: "dsh-we-menuItemLabel" }, name + detail + (running ? "\uFF08\u8FD0\u884C\u4E2D\uFF09" : ""))
    );
  };
  const renderBrowserMenu = function() {
    const installed = browserList.items.filter(function(b) {
      return b.exists;
    });
    const currentPath = browserList.current ? browserList.current.path.toLowerCase() : "";
    const emptyReason = browserList.status === "stale" ? "\u6D4F\u89C8\u5668\u5217\u8868\u9700\u8981\u91CD\u542F dsh web \u540E\u624D\u53EF\u7528" : browserList.status === "error" ? "\u63A2\u6D4B\u5931\u8D25\uFF1A" + browserList.error : "\u672A\u68C0\u6D4B\u5230 Chrome/Edge/Chromium/Brave/Opera";
    return el(
      "div",
      { className: "dsh-we-menu dsh-we-menuRight", role: "menu", "aria-label": "\u9009\u62E9\u6D4F\u89C8\u5668" },
      el("div", { className: "dsh-we-menuHeader" }, "\u9009\u62E9\u6D4F\u89C8\u5668\uFF08\u70B9\u300C\u6253\u5F00\u300D\u65F6\u4F7F\u7528\uFF09"),
      browserList.status === "loading" && !browserList.items.length ? el("div", { className: "dsh-we-menuEmpty" }, "\u6B63\u5728\u63A2\u6D4B\u7CFB\u7EDF\u6D4F\u89C8\u5668\u2026") : el(
        "div",
        { className: "dsh-we-menuList" },
        renderBrowserOption(null, false),
        installed.length ? installed.map(function(b) {
          return renderBrowserOption(b, !!currentPath && b.path.toLowerCase() === currentPath);
        }) : el(
          "div",
          { className: "dsh-we-menuEmpty" },
          emptyReason,
          // 探测失败/宿主未重启时给一条就地重试的出口：否则菜单只剩「自动探测」
          // 一行，用户只能关掉重开对话框碰运气（冷启动超时就是这么被撞上的）
          browserList.status === "error" || browserList.status === "stale" ? el(
            "button",
            { type: "button", className: "dsh-we-menuRetry", onClick: loadBrowsers },
            "\u91CD\u8BD5\u63A2\u6D4B"
          ) : null
        )
      )
    );
  };
  const renderContextMenu = function() {
    const items = contextItems.slice().reverse();
    return el(
      "div",
      { className: "dsh-we-menu", role: "menu" },
      el("div", { className: "dsh-we-menuHeader" }, "\u5386\u53F2\u8282\u70B9\uFF08\u70B9\u51FB\u63D2\u5165\u8F93\u5165\u6846\uFF09"),
      items.length ? el(
        "div",
        { className: "dsh-we-menuList" },
        items.map(function(item) {
          return el(
            "button",
            {
              key: item.domId,
              type: "button",
              className: "dsh-we-menuItem",
              title: item.pageUrl || item.domId,
              onClick: function() {
                insertContextItem(item);
              }
            },
            el("span", { className: "dsh-we-menuItemId" }, item.domId),
            el("span", { className: "dsh-we-menuItemLabel" }, item.label || "(\u65E0\u6807\u7B7E)")
          );
        })
      ) : el("div", { className: "dsh-we-menuEmpty" }, contextCount > 0 ? "\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u60AC\u505C\u91CD\u8BD5" : "\u6682\u65E0\u5386\u53F2\u8282\u70B9"),
      el(
        "div",
        { className: "dsh-we-menuFooter" },
        renderButton({
          variant: "outline",
          size: "sm",
          onClick: onClearClick,
          disabled: !contextCount && !clearArmed,
          title: clearArmed ? "\u518D\u6B21\u70B9\u51FB\u6E05\u7A7A\u5168\u90E8\u5386\u53F2\u8282\u70B9" : "\u6E05\u7A7A\u5168\u90E8\u5386\u53F2\u8282\u70B9",
          children: clearArmed ? "\u786E\u8BA4\u6E05\u7A7A\uFF1F" : "\u6E05\u7A7A"
        })
      )
    );
  };
  const renderDialogBody = function() {
    return el(
      "div",
      { className: "dsh-we-body" },
      el("textarea", {
        value: urlText,
        onChange: function(e) {
          setUrlText(e.target.value);
        },
        rows: 3,
        placeholder: "\u8F93\u5165\u7F51\u5740\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF0C\u4F7F\u7528\u7B2C\u4E00\u884C\uFF1B\u4E0D\u5E26 http/https \u4F1A\u81EA\u52A8\u8865 https://\uFF09\uFF0C\u4F8B\u5982\uFF1A\nhttps://example.com",
        "aria-label": "\u7F51\u5740",
        className: "dsh-we-input"
      }),
      statusLine ? el("div", { className: "dsh-we-status" }, statusLine) : null,
      notice ? el("div", { className: "dsh-we-notice " + (notice.tone === "error" ? "dsh-we-noticeError" : "dsh-we-noticeInfo"), role: "status" }, notice.text) : null,
      el(
        "div",
        { className: "dsh-we-hint" },
        "\u63D0\u793A\uFF1A\u5728\u9875\u9762\u4E2D\u70B9\u51FB\u5143\u7D20\uFF0C\u518D\u70B9\u300C\u6DFB\u52A0\u5230\u5BF9\u8BDD\u300D\uFF0C\u5373\u53EF\u5728\u8F93\u5165\u6846\u63D2\u5165 [\u6807\u7B7E][DOMn] \u5F15\u7528\u5F0F\u5360\u4F4D\u7B26\uFF1B\u5B8C\u6574\u5143\u7D20\u4FE1\u606F\u7531\u6A21\u578B\u6309\u9700\u901A\u8FC7 read_picked_element \u5DE5\u5177\u8BFB\u53D6\u3002\u6D4F\u89C8\u5668\u4F7F\u7528\u7CFB\u7EDF\u5DF2\u5B89\u88C5\u7684 Chrome/Edge \u7B49\uFF08\u9ED8\u8BA4\u81EA\u52A8\u63A2\u6D4B\uFF0C\u7EDD\u4E0D\u4E0B\u8F7D\uFF09\uFF0C\u70B9\u300C\u6253\u5F00\u300D\u53F3\u4FA7\u7BAD\u5934\u53EF\u6307\u5B9A\u7528\u54EA\u4E2A\u6D4F\u89C8\u5668\uFF08\u6362\u6D4F\u89C8\u5668\u4F1A\u5148\u5173\u6389\u5F53\u524D\u7A97\u53E3\uFF09\uFF1B\u9996\u6B21\u6253\u5F00\u9700\u5B89\u88C5\u7EA6 13MB \u7684 playwright-core \u8FD0\u884C\u65F6\uFF08\u4E0D\u542B\u6D4F\u89C8\u5668\uFF09\u5E76\u63A2\u6D4B\u7CFB\u7EDF\u6D4F\u89C8\u5668\uFF0C\u4E4B\u540E\u79D2\u5F00\u3002\u9700\u8981\u767B\u5F55\u65F6\uFF1A\u5148\u70B9\u9875\u9762\u53F3\u4E0B\u89D2\u7684\u300C\u9009\u62E9\u6A21\u5F0F\u300D\u60AC\u6D6E\u6309\u94AE\uFF08\u6216\u6309 ` \u952E\uFF09\u6682\u505C\u9009\u62E9\uFF0C\u767B\u5F55\u5B8C\u6210\u540E\u56DE\u5230\u8FD9\u91CC\u70B9\u300C\u4EC5\u91CD\u65B0\u6CE8\u5165\u300D\u5373\u53EF\u5728\u5F53\u524D\u9875\u9762\u6062\u590D\u9009\u62E9\u529F\u80FD\uFF1B\u5982\u9700\u56DE\u5230\u8F93\u5165\u7684\u7F51\u5740\u5219\u70B9\u300C\u6253\u5F00\u300D\u3002"
      )
    );
  };
  const renderOpenButton = function() {
    return el(
      "div",
      { className: "dsh-we-split", ref: splitRefCb },
      renderButton({
        variant: "primary",
        className: "dsh-we-splitMain",
        onClick: onConfirm,
        disabled: busy,
        title: "\u4F7F\u7528" + browserChoiceLabel + "\u6253\u5F00\u8F93\u5165\u7684\u7F51\u5740",
        children: busy ? "\u6253\u5F00\u4E2D\u2026" : "\u6253\u5F00"
      }),
      renderButton({
        variant: "primary",
        className: "dsh-we-splitArrow" + (browserMenuOpen ? " dsh-we-splitArrowOpen" : ""),
        onClick: toggleBrowserMenu,
        disabled: busy,
        title: "\u9009\u62E9\u6D4F\u89C8\u5668\uFF08\u5F53\u524D\uFF1A" + browserChoiceLabel + "\uFF09",
        "aria-haspopup": "menu",
        "aria-expanded": browserMenuOpen,
        "aria-label": "\u9009\u62E9\u6D4F\u89C8\u5668",
        icon: chevronDownIcon(el)
      }),
      browserMenuOpen ? renderBrowserMenu() : null
    );
  };
  const renderDialogFooter = function() {
    return el(
      "div",
      { className: "dsh-we-footer" },
      // 左区：上下文计数 + 悬浮历史菜单。菜单与计数在同一个包裹元素内，
      // 鼠标在两者间移动不触发 mouseleave，移出整个区域才关闭菜单
      el(
        "div",
        {
          className: "dsh-we-footerLeft",
          onMouseEnter: function() {
            setMenuOpen(true);
            loadContextItems();
          },
          onMouseLeave: function() {
            setMenuOpen(false);
            setClearArmed(false);
          }
        },
        el("span", { className: "dsh-we-ctxCount" }, "\u4E0A\u4E0B\u6587\uFF1A" + contextCount + " \u9879"),
        menuOpen ? renderContextMenu() : null
      ),
      el(
        "div",
        { className: "dsh-we-footerRight" },
        // 尺寸取原语默认的 md（36px 胶囊）：与 DSH 对话框底部按钮同规格
        renderButton({ variant: "outline", onClick: onReinject, disabled: busy, children: "\u4EC5\u91CD\u65B0\u6CE8\u5165" }),
        renderOpenButton()
      )
    );
  };
  const renderDialog = function() {
    return renderDialogShell({
      open: true,
      title: "\u6DFB\u52A0\u9875\u9762\u5143\u7D20",
      closeLabel: "\u5173\u95ED",
      onClose: function() {
        setOpen(false);
      },
      className: "dsh-we-dialog" + (PRIMITIVES.module ? " dsh-we-dialogPrimitive" : ""),
      // 正文与底部栏包在同一个弹性列里：卡片 gap 置 0 后由这个容器统一排版，
      // 原语可用与否都由 .dsh-we-panelBody 给出同一套 20px 节奏
      children: el("div", { className: "dsh-we-panelBody" }, renderDialogBody(), renderDialogFooter())
    });
  };
  return el(
    React.Fragment,
    null,
    el(
      "button",
      {
        type: "button",
        className: "dsh-we-iconBtn",
        onClick: function() {
          setOpen(true);
          setNotice(null);
        },
        title: buttonTitle,
        "aria-label": "\u6DFB\u52A0\u9875\u9762\u5143\u7D20",
        "aria-haspopup": "dialog",
        "aria-expanded": open ? "true" : "false"
      },
      crosshairIcon(el)
    ),
    open ? renderDialog() : null
  );
}
function apply(ctx) {
  ctx.effect(function() {
    let tag = null;
    if (typeof document !== "undefined") {
      tag = document.createElement("style");
      tag.dataset.plugin = PLUGIN_ID;
      tag.textContent = STYLE_CSS;
      document.head.appendChild(tag);
    }
    return function() {
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
    };
  }, "dsh-webpage-element-picker: styles");
  ctx.effect(function() {
    return ctx.slots.inject("conversation.input.left", function() {
      return ctx.slots.register(
        {
          name: "conversation.input.left",
          id: PLUGIN_ID,
          order: 0
        },
        PickerEntry
      );
    });
  }, "dsh-webpage-element-picker: slot registration");
  logInfo(
    PRIMITIVES.module ? "client \u63D2\u4EF6\u5DF2\u52A0\u8F7D\uFF08\u69FD\u4F4D conversation.input.left\uFF0CUI \u4F7F\u7528 DSH \u539F\u8BED Modal/Button\uFF09" : "client \u63D2\u4EF6\u5DF2\u52A0\u8F7D\uFF08\u69FD\u4F4D conversation.input.left\uFF0CUI \u539F\u8BED\u4E0D\u53EF\u7528\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u5185\u7F6E\u6837\u5F0F\uFF1A" + PRIMITIVES.error + "\uFF09"
  );
}
module.exports = {
  name: PLUGIN_ID,
  inject: ["slots"],
  apply
};

    return module.exports;
  },
});

