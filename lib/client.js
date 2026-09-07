window.__ModuleLoader__.load({
  id: "dsh-webpage-element-picker",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

"use strict";

// src/client/react.ts
var React = require("react");
var h = React.createElement;

// src/client/index.ts
var PLUGIN_ID = "dsh-webpage-element-picker";
var INVOKE_PATH = "/dsh-webpage-element-picker/invoke";
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
var STYLE_CSS = ".dsh-we-icon-btn { background: transparent; border: none; color: #9a9aa6; padding: 5px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }.dsh-we-icon-btn:hover { background: rgba(255,255,255,0.08); color: #d8d8e0; }.dsh-we-icon-btn:disabled { opacity: 0.5; cursor: default; }.dsh-we-ctx-count { color: #8b8b96; font-size: 12px; padding: 4px 8px; border-radius: 6px; cursor: default; user-select: none; }.dsh-we-ctx-count:hover { background: rgba(255,255,255,0.06); color: #d8d8e0; }.dsh-we-ctx-item { background: transparent; border: none; width: 100%; text-align: left; cursor: pointer; display: flex; gap: 8px; align-items: baseline; padding: 6px 10px; font-family: inherit; }.dsh-we-ctx-item:hover { background: rgba(255,255,255,0.07); }";
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
var S = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1e6, display: "flex", alignItems: "center", justifyContent: "center" },
  panel: { width: 560, maxWidth: "92vw", background: "#1b1b22", border: "1px solid #34343e", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #2a2a33" },
  title: { color: "#e6e6eb", fontSize: 14, fontWeight: 600 },
  closeBtn: { background: "none", border: "none", color: "#8b8b96", fontSize: 18, cursor: "pointer", padding: "0 4px", lineHeight: 1 },
  body: { padding: 16, display: "flex", flexDirection: "column", gap: 10 },
  textarea: { width: "100%", boxSizing: "border-box", background: "#121218", color: "#e6e6eb", border: "1px solid #34343e", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none", minHeight: 84, lineHeight: 1.5 },
  statusLine: { color: "#9fd0ff", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  notice: { color: "#f5c56b", fontSize: 12 },
  hint: { color: "#8b8b96", fontSize: 11, lineHeight: 1.6 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 16px", borderTop: "1px solid #2a2a33" },
  footerLeft: { position: "relative", display: "flex", alignItems: "center" },
  footerRight: { display: "flex", gap: 8 },
  contextMenu: { position: "absolute", left: 0, bottom: "100%", width: 280, background: "#121218", border: "1px solid #34343e", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" },
  menuHeader: { color: "#8b8b96", fontSize: 11, padding: "8px 10px 6px", borderBottom: "1px solid #2a2a33" },
  menuList: { overflowY: "auto", maxHeight: 200 },
  menuItemId: { color: "#9fd0ff", fontSize: 12, flexShrink: 0 },
  menuItemLabel: { color: "#c9c9d1", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  menuEmpty: { color: "#8b8b96", fontSize: 12, padding: "12px 10px", textAlign: "center" },
  menuFooter: { borderTop: "1px solid #2a2a33", padding: "6px 10px", display: "flex", justifyContent: "flex-end" },
  clearBtn: { background: "transparent", color: "#c9c9d1", border: "1px solid #34343e", borderRadius: 6, padding: "3px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  clearBtnArmed: { background: "#b33939", color: "#fff", border: "1px solid #d64545", borderRadius: 6, padding: "3px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  ghostBtn: { background: "transparent", color: "#c9c9d1", border: "1px solid #34343e", borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  primaryBtn: { background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }
};
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
  const noticeState = React.useState("");
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
  const statusState = status ? status.state : null;
  const showNotice = function(text) {
    setNotice(text);
    window.setTimeout(function() {
      setNotice(function(cur) {
        return cur === text ? "" : cur;
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
        showNotice("\u6E05\u7A7A\u5931\u8D25\uFF1A" + (res && res.error || "\u672A\u77E5\u9519\u8BEF"));
      }
    }).catch(function(err) {
      logError("\u6E05\u7A7A\u4E0A\u4E0B\u6587\u5931\u8D25", err);
      showNotice("\u6E05\u7A7A\u5931\u8D25\uFF1A" + String(err && err.message || err));
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
  const onConfirm = function() {
    const url = String(urlText || "").split("\n").map(function(s) {
      return s.trim();
    }).filter(Boolean)[0] || "";
    if (!url) {
      showNotice("\u8BF7\u5148\u8F93\u5165\u7F51\u5740");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      logDebug("\u7F51\u5740\u6821\u9A8C\u672A\u901A\u8FC7\uFF08\u9700 http/https\uFF09: " + url);
      showNotice("\u7F51\u5740\u9700\u4EE5 http:// \u6216 https:// \u5F00\u5934");
      return;
    }
    logInfo("\u7528\u6237\u8BF7\u6C42\u6253\u5F00\u7F51\u5740: " + url);
    setBusy(true);
    hostCall("picker-navigate", { url }).then(function(res) {
      if (res && res.ok) {
        setStatus(Object.assign({ state: "open" }, res.status || { url }));
        setOpen(false);
      } else {
        showNotice("\u6253\u5F00\u5931\u8D25\uFF1A" + (res && res.error || "\u672A\u77E5\u9519\u8BEF"));
      }
    }).catch(function(err) {
      logError("\u6253\u5F00\u7F51\u5740\u5931\u8D25: " + url, err);
      showNotice("\u6253\u5F00\u5931\u8D25\uFF1A" + String(err && err.message || err));
    }).finally(function() {
      setBusy(false);
    });
  };
  const onReinject = function() {
    logInfo("\u7528\u6237\u8BF7\u6C42\u91CD\u65B0\u6CE8\u5165\u9009\u62E9\u529F\u80FD");
    setBusy(true);
    hostCall("picker-reinject", {}).then(function(res) {
      if (res && res.ok) {
        setStatus(Object.assign({ state: "open" }, res.status || status));
        showNotice("\u5DF2\u91CD\u65B0\u6CE8\u5165\u9009\u62E9\u529F\u80FD");
      } else {
        showNotice("\u91CD\u65B0\u6CE8\u5165\u5931\u8D25\uFF1A" + (res && res.error || "\u672A\u77E5\u9519\u8BEF"));
      }
    }).catch(function(err) {
      logError("\u91CD\u65B0\u6CE8\u5165\u5931\u8D25", err);
      showNotice("\u91CD\u65B0\u6CE8\u5165\u5931\u8D25\uFF1A" + String(err && err.message || err));
    }).finally(function() {
      setBusy(false);
    });
  };
  const browserLabel = status && status.browser ? "\u6D4F\u89C8\u5668: " + status.browser + " \xB7 " : "";
  const tooltip = status ? status.message || (status.state === "open" ? browserLabel + "\u5DF2\u6253\u5F00: " + (status.title || status.url || "") + (status.modeExited ? " \xB7 \u9009\u62E9\u6A21\u5F0F\u5DF2\u9000\u51FA\uFF08\u70B9\u51FB\u56FE\u6807\u53EF\u91CD\u65B0\u6253\u5F00\uFF09" : status.injected ? " \xB7 \u5DF2\u6CE8\u5165\u9009\u62E9\u529F\u80FD" : "") : "") : "";
  const buttonTitle = tooltip || "\u6253\u5F00\u6D4F\u89C8\u5668\u5E76\u9009\u62E9\u9875\u9762\u5143\u7D20";
  const renderContextMenu = function() {
    const items = contextItems.slice().reverse();
    return el(
      "div",
      { style: S.contextMenu },
      el("div", { style: S.menuHeader }, "\u5386\u53F2\u8282\u70B9\uFF08\u70B9\u51FB\u63D2\u5165\u8F93\u5165\u6846\uFF09"),
      items.length ? el(
        "div",
        { style: S.menuList },
        items.map(function(item) {
          return el(
            "button",
            {
              key: item.domId,
              className: "dsh-we-ctx-item",
              title: item.pageUrl || item.domId,
              onClick: function() {
                insertContextItem(item);
              }
            },
            el("span", { style: S.menuItemId }, item.domId),
            el("span", { style: S.menuItemLabel }, item.label || "(\u65E0\u6807\u7B7E)")
          );
        })
      ) : el("div", { style: S.menuEmpty }, contextCount > 0 ? "\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u60AC\u505C\u91CD\u8BD5" : "\u6682\u65E0\u5386\u53F2\u8282\u70B9"),
      el(
        "div",
        { style: S.menuFooter },
        el(
          "button",
          { onClick: onClearClick, disabled: !contextCount && !clearArmed, style: clearArmed ? S.clearBtnArmed : S.clearBtn },
          clearArmed ? "\u786E\u8BA4\u6E05\u7A7A\uFF1F" : "\u6E05\u7A7A"
        )
      )
    );
  };
  const renderDialog = function() {
    return el(
      "div",
      {
        style: S.backdrop,
        onMouseDown: function(e) {
          if (e.target === e.currentTarget) setOpen(false);
        }
      },
      el(
        "div",
        { style: S.panel },
        el(
          "div",
          { style: S.header },
          el("div", { style: S.title }, "\u6DFB\u52A0\u9875\u9762\u5143\u7D20"),
          el("button", { onClick: function() {
            setOpen(false);
          }, style: S.closeBtn }, "\xD7")
        ),
        el(
          "div",
          { style: S.body },
          el("textarea", {
            value: urlText,
            onChange: function(e) {
              setUrlText(e.target.value);
            },
            rows: 4,
            placeholder: "\u8F93\u5165\u7F51\u5740\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF0C\u4F7F\u7528\u7B2C\u4E00\u884C\uFF09\uFF0C\u4F8B\u5982\uFF1A\nhttps://example.com",
            style: S.textarea
          }),
          status ? el(
            "div",
            { style: S.statusLine },
            "\u72B6\u6001\uFF1A" + (status.message || (status.state === "open" ? browserLabel + "\u5DF2\u6253\u5F00 " + (status.url || "") + (status.modeExited ? " \xB7 \u9009\u62E9\u6A21\u5F0F\u5DF2\u9000\u51FA" : status.injected ? " \xB7 \u5DF2\u6CE8\u5165\u9009\u62E9\u529F\u80FD" : "") : status.state === "ready" ? "\u6D4F\u89C8\u5668\u5DF2\u5C31\u7EEA" : status.state))
          ) : null,
          notice ? el("div", { style: S.notice }, notice) : null,
          el(
            "div",
            { style: S.hint },
            "\u63D0\u793A\uFF1A\u5728\u9875\u9762\u4E2D\u70B9\u51FB\u5143\u7D20\uFF0C\u518D\u70B9\u300C\u6DFB\u52A0\u5230\u5BF9\u8BDD\u300D\uFF0C\u5373\u53EF\u5728\u8F93\u5165\u6846\u63D2\u5165 [\u6807\u7B7E][DOMn] \u5F15\u7528\u5F0F\u5360\u4F4D\u7B26\uFF1B\u5B8C\u6574\u5143\u7D20\u4FE1\u606F\u7531\u6A21\u578B\u6309\u9700\u901A\u8FC7 read_picked_element \u5DE5\u5177\u8BFB\u53D6\u3002\u6D4F\u89C8\u5668\u4F7F\u7528\u7CFB\u7EDF\u5DF2\u5B89\u88C5\u7684 Chrome/Edge \u7B49\uFF08\u81EA\u52A8\u63A2\u6D4B\uFF0C\u7EDD\u4E0D\u4E0B\u8F7D\uFF09\uFF1B\u9996\u6B21\u6253\u5F00\u9700\u5B89\u88C5\u7EA6 13MB \u7684 playwright-core \u8FD0\u884C\u65F6\uFF08\u4E0D\u542B\u6D4F\u89C8\u5668\uFF09\u5E76\u63A2\u6D4B\u7CFB\u7EDF\u6D4F\u89C8\u5668\uFF0C\u4E4B\u540E\u79D2\u5F00\u3002\u9700\u8981\u767B\u5F55\u65F6\uFF1A\u5148\u70B9\u9875\u9762\u53F3\u4E0B\u89D2\u7684\u300C\u9009\u62E9\u6A21\u5F0F\u300D\u60AC\u6D6E\u6309\u94AE\uFF08\u6216\u6309 ` \u952E\uFF09\u6682\u505C\u9009\u62E9\uFF0C\u767B\u5F55\u5B8C\u6210\u540E\u56DE\u5230\u8FD9\u91CC\u70B9\u300C\u4EC5\u91CD\u65B0\u6CE8\u5165\u300D\u5373\u53EF\u5728\u5F53\u524D\u9875\u9762\u6062\u590D\u9009\u62E9\u529F\u80FD\uFF1B\u5982\u9700\u56DE\u5230\u8F93\u5165\u7684\u7F51\u5740\u5219\u70B9\u300C\u6253\u5F00\u300D\u3002"
          )
        ),
        el(
          "div",
          { style: S.footer },
          // 左区：上下文计数 + 悬浮历史菜单。菜单与计数在同一个包裹元素内，
          // 鼠标在两者间移动不触发 mouseleave，移出整个区域才关闭菜单
          el(
            "div",
            {
              style: S.footerLeft,
              onMouseEnter: function() {
                setMenuOpen(true);
                loadContextItems();
              },
              onMouseLeave: function() {
                setMenuOpen(false);
                setClearArmed(false);
              }
            },
            el("span", { className: "dsh-we-ctx-count" }, "\u4E0A\u4E0B\u6587\uFF1A" + contextCount + " \u9879"),
            menuOpen ? renderContextMenu() : null
          ),
          // 右区：原操作按钮组
          el(
            "div",
            { style: S.footerRight },
            el("button", { onClick: function() {
              setOpen(false);
            }, style: S.ghostBtn }, "\u5173\u95ED"),
            el("button", { onClick: onReinject, disabled: busy, style: S.ghostBtn }, "\u4EC5\u91CD\u65B0\u6CE8\u5165"),
            el("button", { onClick: onConfirm, disabled: busy, style: S.primaryBtn }, busy ? "\u6253\u5F00\u4E2D\u2026" : "\u6253\u5F00")
          )
        )
      )
    );
  };
  return el(
    React.Fragment,
    null,
    el(
      "button",
      {
        className: "dsh-we-icon-btn",
        onClick: function() {
          setOpen(true);
          setNotice("");
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
  logInfo("client \u63D2\u4EF6\u5DF2\u52A0\u8F7D\uFF08\u69FD\u4F4D conversation.input.left\uFF09");
}
module.exports = {
  name: PLUGIN_ID,
  inject: ["slots"],
  apply
};

    return module.exports;
  },
});

