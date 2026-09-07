// src/host/index.ts
import { fileURLToPath } from "url";
var name = "dsh-webpage-element-picker";
var inject = ["subprocess", "webServer", "sandboxPolicy", "fs", "tools", "systemPrompt", "timer"];
var LOG_PREFIX = "[dsh-webpage-element-picker]";
var DEBUG_ENABLED = typeof process !== "undefined" && !!(process.env && process.env.DSH_WE_DEBUG);
function logDebug(msg) {
  if (DEBUG_ENABLED) console.debug(LOG_PREFIX + " [DEBUG] " + msg);
}
function logInfo(msg) {
  console.info(LOG_PREFIX + " [INFO] " + msg);
}
function logWarn(msg) {
  console.warn(LOG_PREFIX + " [WARN] " + msg);
}
function logError(msg, err) {
  const e = err;
  const detail = e && e.stack ? e.stack : String(e && e.message || err || "");
  console.error(LOG_PREFIX + " [ERROR] " + msg + (detail ? "\n" + detail : ""));
}
function apply(ctx) {
  const subprocess = ctx.get("subprocess");
  const webServer = ctx.get("webServer");
  const timer = ctx.get("timer");
  const fs = ctx.get("fs");
  const tools = ctx.get("tools");
  const systemPrompt = ctx.get("systemPrompt");
  const workspaceRoot = ctx.get("sandboxPolicy").workspaceRoot;
  let handle = null;
  let starting = null;
  let payloadSent = false;
  let cmdSeq = 0;
  const waiters = /* @__PURE__ */ new Map();
  let lastSeq = 0;
  let pending = [];
  let status = { state: "idle", message: "\u6D4F\u89C8\u5668\u672A\u542F\u52A8" };
  let lineBuf = "";
  let lastBrowserName = "";
  let domCounter = 0;
  let domRegistry = [];
  const pkgResourceDir = (() => {
    try {
      return fileURLToPath(new URL("../resources/", import.meta.url));
    } catch {
      return "";
    }
  })();
  let homeProbePromise = null;
  const discoverHome = () => {
    if (homeProbePromise) return homeProbePromise;
    homeProbePromise = (async () => {
      try {
        const node = await subprocess.resolveExecutable("node");
        const probe = subprocess.spawn({
          argv: [node, "-e", "console.log(process.env.USERPROFILE || process.env.HOME || '')"],
          cwd: workspaceRoot,
          stdio: { stdin: "ignore", stdout: "pipe", stderr: "ignore" },
          graceMs: 3e3
        });
        return await new Promise((resolve) => {
          let buf = "";
          let done = false;
          const finish = (v) => {
            if (!done) {
              done = true;
              resolve(v);
            }
          };
          (async () => {
            for await (const chunk of probe.stdout) {
              buf += String(chunk);
              const i = buf.indexOf("\n");
              if (i >= 0) {
                finish(buf.slice(0, i).replace(/\r$/, "").trim());
                break;
              }
            }
          })().catch(() => finish(""));
          probe.done.then(
            () => {
              if (buf.length === 0) finish("");
              else finish(buf.split("\n")[0].replace(/\r$/, "").trim());
            },
            () => finish("")
          );
        });
      } catch {
        logDebug("\u5BB6\u76EE\u5F55\u63A2\u6D4B\u5931\u8D25\uFF0C\u8DF3\u8FC7\u5BB6\u76EE\u5F55\u8D44\u6E90\u5019\u9009\uFF08\u4E0D\u5F71\u54CD\u5305\u5185\u8D44\u6E90\u89E3\u6790\uFF09");
        return "";
      }
    })();
    return homeProbePromise;
  };
  const resourceDirCandidates = async () => {
    const dirs = [];
    if (pkgResourceDir) dirs.push(pkgResourceDir);
    const home = await discoverHome();
    if (home) {
      dirs.push(home + "/.dsh/_dsh-webpage-element-picker");
      dirs.push(home + "/.dph/_dsh-webpage-element-picker");
    }
    dirs.push(workspaceRoot + "/_dsh-webpage-element-picker");
    return dirs;
  };
  const resolveResourceDir = async () => {
    const needFiles = ["bootstrap.cjs", "helper-playwright.js", "inspector.js", "browser-probe.cjs"];
    const candidates = await resourceDirCandidates();
    for (const c of candidates) {
      let ok = true;
      for (const name2 of needFiles) {
        try {
          const target = await fs.resolve(c + "/" + name2);
          const info = await fs.stat(target);
          if (!info) {
            ok = false;
            break;
          }
        } catch {
          ok = false;
          break;
        }
      }
      if (ok) {
        logInfo("\u8D44\u6E90\u76EE\u5F55: " + c);
        return c;
      }
      logDebug("\u8D44\u6E90\u5019\u9009\u4E0D\u5B8C\u6574\uFF0C\u8DF3\u8FC7: " + c);
    }
    throw new Error(
      "\u672A\u627E\u5230\u9875\u9762\u5143\u7D20\u9009\u62E9\u5668\u7684\u8D44\u6E90\u76EE\u5F55\uFF08\u9700\u8981 4 \u4E2A\u6587\u4EF6: " + needFiles.join(" / ") + "\uFF1B\u5DF2\u5C1D\u8BD5: " + candidates.join(" | ") + "\uFF09"
    );
  };
  const loadResources = async (resourceDir) => {
    const readFile = async (name2) => {
      const target = await fs.resolve(resourceDir + "/" + name2);
      return await fs.readText(target);
    };
    return {
      helper: await readFile("helper-playwright.js"),
      inspector: await readFile("inspector.js")
    };
  };
  const pollWaiters = [];
  const commandQueue = [];
  const sendCommand = (cmd) => {
    const c = cmd;
    if (pollWaiters.length > 0) {
      pollWaiters.shift().finish(cmd);
      logDebug("\u547D\u4EE4\u76F4\u63A8\u957F\u8F6E\u8BE2: id=" + String(c.id) + " method=" + String(c.method));
      return;
    }
    commandQueue.push(cmd);
    if (commandQueue.length > 100) commandQueue.splice(0, commandQueue.length - 100);
    logDebug("\u547D\u4EE4\u5165\u961F\u7B49\u5F85 /poll: id=" + String(c.id) + " method=" + String(c.method) + "\uFF08\u961F\u5217\u957F\u5EA6 " + commandQueue.length + "\uFF09");
  };
  const registryLabel = (p) => {
    const short = (s) => {
      const t = String(s || "").replace(/\s+/g, " ").trim();
      return t.length > 10 ? t.slice(0, 10) + "\u2026" : t;
    };
    if (p.textContent) return short(p.textContent);
    const attrs = p.attributes || {};
    for (const key of ["aria-label", "placeholder", "alt", "title", "value"]) {
      const t = short(attrs[key]);
      if (t) return t;
    }
    const tag = String(p.tagName || "?");
    if (p.id) return tag + "#" + String(p.id);
    const cls = String(p.className || "").trim().split(/\s+/).slice(0, 2).join(".");
    if (cls) return tag + "." + cls;
    return tag;
  };
  const buildSummary = () => {
    if (domRegistry.length === 0) return "";
    const lines = ["\u9875\u9762\u5143\u7D20\u5217\u8868\uFF08\u7528\u6237\u6D88\u606F\u4E2D\u7684 [DOMn] \u5360\u4F4D\u7B26\u4E0E\u4E0B\u5217\u7F16\u53F7\u4E00\u4E00\u5BF9\u5E94\uFF09\uFF1A"];
    for (const e of domRegistry) {
      const p = e.payload || {};
      const parts = [String(p.tagName || "?")];
      if (p.id) parts.push("#" + p.id);
      if (p.textContent) parts.push("\u201C" + String(p.textContent).slice(0, 40) + "\u201D");
      lines.push(e.id + "=" + parts.join(" ") + " (" + (p.pageUrl || "") + ")");
    }
    lines.push(
      '\u9700\u8981\u67D0\u4E2A\u5143\u7D20\u7684\u5B8C\u6574\u4FE1\u606F\uFF08HTML/CSS\u9009\u62E9\u5668/\u5C5E\u6027/\u4F4D\u7F6E\u5C3A\u5BF8\uFF09\u65F6\uFF0C\u8C03\u7528 read_picked_element \u5DE5\u5177\uFF0C\u53C2\u6570\u5982 {"id":"DOM1"}\u3002'
    );
    return lines.join("\n");
  };
  try {
    ctx.effect(() => systemPrompt.context({
      name: "webpage-element-picker",
      order: 60,
      text: () => buildSummary()
    }));
  } catch (err) {
    logError("\u7CFB\u7EDF\u63D0\u793A\u4E0A\u4E0B\u6587\u6CE8\u518C\u5931\u8D25\uFF08\u9875\u9762\u5143\u7D20\u5217\u8868\u5C06\u4E0D\u4F1A\u51FA\u73B0\u5728\u7CFB\u7EDF\u63D0\u793A\u4E2D\uFF09", err);
  }
  try {
    ctx.effect(() => tools.register({
      name: "read_picked_element",
      description: "\u8BFB\u53D6\u300C\u6DFB\u52A0\u9875\u9762\u5143\u7D20\u300D\u529F\u80FD\u4ECE\u5185\u7F6E\u6D4F\u89C8\u5668\u4E2D\u9009\u4E2D\u7684\u9875\u9762\u5143\u7D20\u5B8C\u6574\u4FE1\u606F\uFF08HTML\u3001CSS\u9009\u62E9\u5668\u3001DOM\u8DEF\u5F84\u3001\u5C5E\u6027\u3001\u4F4D\u7F6E\u5C3A\u5BF8\u3001\u9875\u9762URL\u7B49\uFF09\u3002\u7CFB\u7EDF\u63D0\u793A\u4E2D\u7684\u9875\u9762\u5143\u7D20\u5217\u8868\u7ED9\u51FA\u4E86\u53EF\u7528\u7684 DOM \u7F16\u53F7\uFF0C\u7528\u6237\u6D88\u606F\u4E2D\u7684 [DOMn] \u5360\u4F4D\u7B26\u4E0E\u4E4B\u4E00\u4E00\u5BF9\u5E94\uFF1B\u9700\u8981\u5143\u7D20\u7EC6\u8282\u65F6\u6309\u7F16\u53F7\u8BFB\u53D6\u3002",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "DOM \u7F16\u53F7\uFF0C\u5982 DOM1\uFF08\u89C1\u7CFB\u7EDF\u63D0\u793A\u4E2D\u7684\u9875\u9762\u5143\u7D20\u5217\u8868\uFF09" }
        },
        required: ["id"]
      },
      output: {
        schema: {},
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
      },
      async execute(args) {
        const id = String(args && args.id || "");
        logInfo("\u5DE5\u5177\u8C03\u7528 read_picked_element: id=" + (id || "(\u7A7A)"));
        if (!id) throw new Error("read_picked_element \u9700\u8981\u53C2\u6570 id\uFF08\u5982 DOM1\uFF09");
        const entry = domRegistry.find((e) => e.id === id);
        if (!entry) {
          logDebug("\u5143\u7D20\u7F16\u53F7\u672A\u547D\u4E2D: " + id + "\uFF08\u5F53\u524D\u53EF\u7528 " + domRegistry.length + " \u4E2A\uFF09");
          return { ok: false, error: "\u672A\u627E\u5230\u5143\u7D20 " + id + "\uFF0C\u53EF\u7528\u7F16\u53F7: " + domRegistry.map((e) => e.id).join(", ") };
        }
        return { ok: true, id: entry.id, element: entry.payload };
      }
    }));
    logInfo("\u52A8\u6001\u5DE5\u5177 read_picked_element \u5DF2\u6CE8\u518C");
  } catch (err) {
    logError("\u5DE5\u5177\u6CE8\u518C\u5931\u8D25\uFF08\u6A21\u578B\u5C06\u65E0\u6CD5\u8BFB\u53D6\u9875\u9762\u5143\u7D20\u8BE6\u60C5\uFF09", err);
  }
  const handleEvent = (ev) => {
    if (!ev || typeof ev.type !== "string") return;
    if (ev.type === "reply") {
      const w = waiters.get(ev.id);
      if (w) {
        waiters.delete(ev.id);
        logDebug("\u6536\u5230 reply: id=" + ev.id + " ok=" + ev.ok + " \u8017\u65F6 " + (Date.now() - w.at) + "ms");
        if (ev.ok) w.resolve(ev);
        else w.reject(new Error(ev.error || "\u5185\u7F6E\u6D4F\u89C8\u5668\u8FD4\u56DE\u9519\u8BEF"));
      }
      return;
    }
    if (ev.type === "element-selected") {
      domCounter += 1;
      const domId = "DOM" + domCounter;
      domRegistry.push({ id: domId, payload: ev.data || {} });
      if (domRegistry.length > 200) domRegistry = domRegistry.slice(-200);
      pending.push({ seq: ++lastSeq, domId, payload: ev.data || {} });
      if (pending.length > 100) pending = pending.slice(-100);
      const p = ev.data || {};
      logInfo("\u9875\u9762\u5143\u7D20\u5DF2\u9009\u4E2D: " + domId + " " + String(p.tagName || "?") + " (" + String(p.pageUrl || "") + ")");
      return;
    }
    if (ev.type === "browser") {
      lastBrowserName = ev.name || "\u6D4F\u89C8\u5668";
      logInfo("\u5DF2\u63A2\u6D4B\u5230\u7CFB\u7EDF\u6D4F\u89C8\u5668: " + lastBrowserName);
      status = { state: "starting", message: "\u6B63\u5728\u542F\u52A8 " + lastBrowserName + "\u2026", browser: lastBrowserName };
      return;
    }
    if (ev.type === "status") {
      logDebug("\u9875\u9762\u72B6\u6001\u66F4\u65B0: " + String(ev.url || ""));
      status = { state: "open", url: ev.url, title: ev.title, browser: lastBrowserName };
      return;
    }
    if (ev.type === "injected") {
      logDebug("inspector \u5DF2\u6CE8\u5165: " + String(ev.url || ""));
      status = { state: "open", url: ev.url, title: ev.title, injected: true, browser: lastBrowserName };
      return;
    }
    if (ev.type === "mode-exited") {
      logInfo("\u9009\u62E9\u6A21\u5F0F\u5DF2\u9000\u51FA: " + String(ev.url || ""));
      status = { state: "open", url: ev.url, title: ev.title, modeExited: true, browser: lastBrowserName };
      return;
    }
    if (ev.type === "window-closed") {
      logInfo("\u6D4F\u89C8\u5668\u7A97\u53E3\u5DF2\u5173\u95ED");
      status = { state: "closed", message: "\u6D4F\u89C8\u5668\u7A97\u53E3\u5DF2\u5173\u95ED\uFF0C\u53EF\u91CD\u65B0\u70B9\u51FB\u6253\u5F00\u6309\u94AE\u6253\u5F00" };
      return;
    }
    if (ev.type === "helper-ready") {
      logInfo("\u6D4F\u89C8\u5668\u5DF2\u5C31\u7EEA" + (lastBrowserName ? "\uFF08" + lastBrowserName + "\uFF09" : ""));
      status = { state: "ready", message: "\u6D4F\u89C8\u5668\u5DF2\u5C31\u7EEA" + (lastBrowserName ? "\uFF08" + lastBrowserName + "\uFF09" : ""), browser: lastBrowserName };
      return;
    }
    if (ev.type === "error") {
      logError("\u6D4F\u89C8\u5668\u4FA7\u9519\u8BEF: " + ev.message);
      status = { state: "error", message: ev.message };
      return;
    }
  };
  const handlers = /* @__PURE__ */ new Map();
  ctx.effect(() => {
    const disposers = [];
    try {
      disposers.push(webServer.register({
        kind: "exact",
        path: "/dsh-webpage-element-picker/poll",
        handler: (req, res) => {
          if (commandQueue.length > 0) {
            const cmd = commandQueue.shift();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(cmd));
            return;
          }
          let finished = false;
          let timeoutDisposer = null;
          const entry = {
            finish: (cmd) => {
              if (finished) return;
              finished = true;
              if (timeoutDisposer) timeoutDisposer();
              const idx = pollWaiters.indexOf(entry);
              if (idx >= 0) pollWaiters.splice(idx, 1);
              try {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(cmd === null ? "null" : JSON.stringify(cmd));
              } catch {
              }
            }
          };
          timeoutDisposer = timer.timeout(() => entry.finish(null), 25e3);
          pollWaiters.push(entry);
          logDebug("\u957F\u8F6E\u8BE2\u6302\u8D77\uFF08\u5F53\u524D\u7B49\u5F85\u8005 " + pollWaiters.length + "\uFF09");
          req.on("close", () => entry.finish(null));
        }
      }));
      disposers.push(webServer.register({
        kind: "exact",
        path: "/dsh-webpage-element-picker/events",
        handler: (req, res) => {
          let body = "";
          let overflow = false;
          req.on("data", (d) => {
            if (overflow) return;
            body += String(d);
            if (body.length > 1e6) {
              overflow = true;
              body = "";
              logWarn("\u4E8B\u4EF6\u8F7D\u8377\u8D85\u8FC7 1MB\uFF0C\u5DF2\u4E22\u5F03");
            }
          });
          req.on("end", () => {
            if (!overflow) {
              let msg = null;
              try {
                msg = JSON.parse(body || "{}");
              } catch {
              }
              if (msg && msg.event) handleEvent(msg.event);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
          });
        }
      }));
      disposers.push(webServer.register({
        kind: "exact",
        path: "/dsh-webpage-element-picker/invoke",
        handler: (req, res) => {
          let body = "";
          let overflow = false;
          req.on("data", (d) => {
            if (overflow) return;
            body += String(d);
            if (body.length > 1e6) {
              overflow = true;
              body = "";
              logWarn("\u8C03\u7528\u8F7D\u8377\u8D85\u8FC7 1MB\uFF0C\u5DF2\u4E22\u5F03");
            }
          });
          req.on("end", () => {
            let msg = null;
            try {
              msg = JSON.parse(body || "{}");
            } catch {
            }
            const method = msg && typeof msg.method === "string" ? msg.method : "";
            const params = msg && typeof msg.params === "object" && msg.params !== null ? msg.params : {};
            if (method === "picker-status" || method === "picker-pull") {
              logDebug("\u8BF7\u6C42\u5165\u53E3 /invoke: " + method);
            } else {
              logInfo("\u8BF7\u6C42\u5165\u53E3 /invoke: " + method + (method === "picker-navigate" ? " url=" + String(params.url || "") : ""));
            }
            const handler = handlers.get(method);
            if (!handler) {
              logWarn("\u672A\u77E5\u8C03\u7528\u65B9\u6CD5: " + (method || "(\u7A7A)"));
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "\u672A\u77E5\u65B9\u6CD5: " + method }));
              return;
            }
            Promise.resolve().then(() => handler(params)).then((result) => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            }).catch((err) => {
              logError("\u8C03\u7528 " + method + " \u5931\u8D25", err);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
            });
          });
        }
      }));
      logInfo("HTTP \u8DEF\u7531\u5DF2\u6CE8\u518C: /poll /events /invoke");
    } catch (err) {
      logError("\u8DEF\u7531\u6CE8\u518C\u5931\u8D25\uFF08\u53EF\u80FD\u88AB\u672C\u63D2\u4EF6\u7684\u53E6\u4E00\u4E2A\u5B9E\u4F8B\u5360\u7528\uFF09", err);
    }
    return () => {
      for (const d of disposers) {
        try {
          d();
        } catch {
        }
      }
    };
  });
  const readStdout = async (boot, payloadText) => {
    try {
      if (!boot || !boot.stdout) return;
      for await (const chunk of boot.stdout) {
        lineBuf += String(chunk);
        let i;
        while ((i = lineBuf.indexOf("\n")) >= 0) {
          const line = lineBuf.slice(0, i).replace(/\r$/, "");
          lineBuf = lineBuf.slice(i + 1);
          if (!line) continue;
          if (!payloadSent && line === "READY") {
            payloadSent = true;
            logDebug("\u6536\u5230 READY \u63E1\u624B\uFF0C\u56DE\u5199\u8D44\u6E90\u8F7D\u8377\uFF08" + payloadText.length + " \u5B57\u7B26\uFF09");
            try {
              boot.stdin.write(payloadText);
            } catch (err) {
              logError("\u53D1\u9001\u8D44\u6E90\u6587\u4EF6\u5931\u8D25\uFF08helper \u5C06\u6536\u4E0D\u5230\u6E90\u7801\uFF0C\u542F\u52A8\u4F1A\u5931\u8D25\uFF09", err);
            }
          }
        }
      }
    } catch {
      logDebug("helper stdout \u6D41\u7ED3\u675F");
    }
  };
  const stderrTail = (boot) => {
    try {
      const c = boot.collected && boot.collected.stderr;
      if (!c) return "";
      const read = c.readFrom(0);
      const lines = String(read.text || "").split("\n").map((s) => s.trim()).filter(Boolean);
      return lines.length ? lines[lines.length - 1].slice(0, 300) : "";
    } catch {
      logDebug("\u8BFB\u53D6 helper stderr \u5C3E\u90E8\u5931\u8D25");
      return "";
    }
  };
  const ensureHelper = async () => {
    if (handle !== null) return handle;
    if (starting) {
      logDebug("helper \u6B63\u5728\u542F\u52A8\u4E2D\uFF0C\u590D\u7528\u8FDB\u884C\u4E2D\u7684\u542F\u52A8 Promise");
      return starting;
    }
    starting = (async () => {
      try {
        const startedAt = Date.now();
        const resourceDir = await resolveResourceDir();
        const res = await loadResources(resourceDir);
        const payloadText = res.helper + "\n<<<DSH_SPLIT>>>\n" + res.inspector + "\n<<<DSH_END>>>\n";
        const node = await subprocess.resolveExecutable("node");
        const npmCli = node.replace(/[^\\/]+$/, "node_modules/npm/bin/npm-cli.js");
        let launcher = null;
        try {
          await subprocess.resolveExecutable(npmCli);
          launcher = npmCli;
        } catch {
        }
        if (!launcher) throw new Error("\u672A\u627E\u5230 npm \u7684\u811A\u672C\u5165\u53E3\uFF08" + npmCli + "\uFF09\uFF0C\u8BF7\u786E\u8BA4 Node.js \u5B89\u88C5\u5B8C\u6574");
        const port = typeof webServer.port === "number" && webServer.port > 0 ? webServer.port : 0;
        if (port === 0) throw new Error("DSH web \u670D\u52A1\u5668\u7AEF\u53E3\u4E0D\u53EF\u7528");
        logDebug("\u542F\u52A8\u53C2\u6570: node=" + node + " npmCli=" + npmCli + " webPort=" + port);
        const boot = subprocess.spawn({
          argv: [node, resourceDir + "/bootstrap.cjs", launcher, String(port)],
          cwd: workspaceRoot,
          stdio: { stdin: "pipe", stdout: "pipe", stderr: { maxBytes: 65536 } },
          graceMs: 3e3
        });
        handle = boot;
        payloadSent = false;
        lineBuf = "";
        logInfo("helper \u5B50\u8FDB\u7A0B\u5DF2\u542F\u52A8\uFF08\u8017\u65F6 " + (Date.now() - startedAt) + "ms\uFF0C\u540E\u7EED READY \u63E1\u624B\u4E0E\u6D4F\u89C8\u5668\u63A2\u6D4B\u7531 bootstrap \u9A71\u52A8\uFF09");
        boot.done.then((outcome) => {
          if (handle === boot) {
            handle = null;
            const tail = stderrTail(boot);
            const detail = "\u6D4F\u89C8\u5668\u8FDB\u7A0B\u5DF2\u9000\u51FA (code " + outcome.exitCode + ")" + (tail ? " \xB7 " + tail : "");
            if (outcome.exitCode === 0) logInfo(detail);
            else logWarn(detail);
            status = { state: "closed", message: detail };
            for (const [id, w] of Array.from(waiters)) {
              waiters.delete(id);
              w.reject(new Error("\u6D4F\u89C8\u5668\u8FDB\u7A0B\u5DF2\u9000\u51FA"));
            }
          }
        }, () => {
        });
        readStdout(boot, payloadText);
        return boot;
      } catch (err) {
        logError("\u542F\u52A8 helper \u5931\u8D25\uFF08\u8D44\u6E90\u76EE\u5F55: " + pkgResourceDir + "\uFF09", err);
        status = { state: "error", message: String(err && err.message || err) };
        throw err;
      } finally {
        starting = null;
      }
    })();
    return starting;
  };
  const request = (method, params, timeoutMs) => {
    const id = ++cmdSeq;
    return new Promise((resolve, reject) => {
      if (handle === null) {
        reject(new Error("\u6D4F\u89C8\u5668\u672A\u8FD0\u884C"));
        return;
      }
      waiters.set(id, { resolve, reject, at: Date.now() });
      sendCommand({ id, method, params: params || {} });
      timer.timeout(() => {
        const w = waiters.get(id);
        if (w) {
          waiters.delete(id);
          logWarn("\u547D\u4EE4\u8D85\u65F6: " + method + "\uFF08id=" + id + "\uFF0C" + (timeoutMs || 6e4) + "ms \u672A\u6536\u5230 reply\uFF09");
          w.reject(new Error(method + " \u8D85\u65F6"));
        }
      }, timeoutMs || 6e4);
    });
  };
  const pickerNavigate = async (args) => {
    const url = String(args && args.url || "");
    if (!/^https?:\/\//i.test(url)) {
      logDebug("\u7F51\u5740\u6821\u9A8C\u672A\u901A\u8FC7\uFF08\u9700 http/https\uFF09: " + url);
      return { ok: false, error: "\u7F51\u5740\u9700\u4EE5 http:// \u6216 https:// \u5F00\u5934" };
    }
    try {
      await ensureHelper();
      const r = await request("open", { url }, 12e4);
      return r && r.ok ? { ok: true, status: Object.assign({ state: "open" }, r.status || { url }) } : { ok: false, error: r && r.error || "\u6253\u5F00\u5931\u8D25" };
    } catch (err) {
      logError("\u6253\u5F00\u7F51\u5740\u5931\u8D25: " + url, err);
      return { ok: false, error: String(err && err.message || err) };
    }
  };
  const pickerReinject = async () => {
    try {
      await ensureHelper();
      const r = await request("reinject", {}, 15e3);
      return r && r.ok ? { ok: true, status: Object.assign({ state: "open" }, r.status || {}) } : { ok: false, error: r && r.error || "\u91CD\u65B0\u6CE8\u5165\u5931\u8D25" };
    } catch (err) {
      logError("\u91CD\u65B0\u6CE8\u5165\u5931\u8D25", err);
      return { ok: false, error: String(err && err.message || err) };
    }
  };
  const pickerStatus = async () => {
    if (handle === null) return { ok: true, status };
    try {
      const r = await request("status", {}, 8e3);
      return r && r.ok ? { ok: true, status: r.status } : { ok: true, status };
    } catch {
      logDebug("helper \u72B6\u6001\u67E5\u8BE2\u5931\u8D25\uFF0C\u964D\u7EA7\u4E3A\u672C\u5730\u7F13\u5B58\u72B6\u6001");
      return { ok: true, status };
    }
  };
  const pickerClose = async () => {
    if (handle !== null) {
      try {
        await request("close", {}, 5e3);
      } catch {
        logDebug("close \u547D\u4EE4\u672A\u83B7\u786E\u8BA4\uFF08helper \u53EF\u80FD\u5DF2\u9000\u51FA\uFF09\uFF0C\u5FFD\u7565");
      }
    }
    status = { state: "closed", message: "\u6D4F\u89C8\u5668\u7A97\u53E3\u5DF2\u5173\u95ED" };
    return { ok: true, status };
  };
  const pickerPull = async (args) => {
    const after = Number(args && args.afterSeq || 0);
    const elements = pending.filter((e) => e.seq > after).map((e) => ({ seq: e.seq, domId: e.domId, payload: e.payload }));
    if (elements.length) logDebug("picker-pull \u6295\u9012 " + elements.length + " \u4E2A\u5143\u7D20\uFF08afterSeq=" + after + "\uFF09");
    return { ok: true, elements, status, lastSeq, contextCount: domRegistry.length };
  };
  const pickerContextList = async () => {
    const items = domRegistry.map((e) => {
      const p = e.payload || {};
      return { domId: e.id, label: registryLabel(p), pageUrl: String(p.pageUrl || "") || void 0 };
    });
    logDebug("picker-context-list \u8FD4\u56DE " + items.length + " \u4E2A\u5386\u53F2\u8282\u70B9");
    return { ok: true, items, contextCount: domRegistry.length };
  };
  const pickerClearContext = async () => {
    const removed = domRegistry.length;
    domRegistry = [];
    pending = [];
    logInfo("\u4E0A\u4E0B\u6587\u5DF2\u6E05\u7A7A\uFF08\u79FB\u9664 " + removed + " \u4E2A\u8282\u70B9\uFF1B\u7F16\u53F7\u8BA1\u6570\u4FDD\u7559\uFF0C\u4E0B\u4E00\u5143\u7D20\u4E3A DOM" + (domCounter + 1) + "\uFF09");
    return { ok: true, contextCount: 0 };
  };
  handlers.set("picker-navigate", pickerNavigate);
  handlers.set("picker-reinject", pickerReinject);
  handlers.set("picker-status", pickerStatus);
  handlers.set("picker-close", pickerClose);
  handlers.set("picker-pull", pickerPull);
  handlers.set("picker-context-list", pickerContextList);
  handlers.set("picker-clear-context", pickerClearContext);
  ctx.effect(() => () => {
    if (handle) {
      try {
        if (handle.stdin) handle.stdin.end();
      } catch {
      }
      handle.terminate();
      handle = null;
      logInfo("\u63D2\u4EF6\u5378\u8F7D\uFF0Chelper \u5B50\u8FDB\u7A0B\u5DF2\u7EC8\u6B62");
    }
  });
}
export {
  apply,
  inject,
  name
};
