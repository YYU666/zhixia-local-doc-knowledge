const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveElectronExecutable } = require("./electron-test-runtime.cjs");

const root = path.resolve(__dirname, "..");
const electronExe = resolveElectronExecutable(root);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-electron-visual-e2e-"));
const userData = path.join(tempRoot, "user-data");
const codexHome = path.join(tempRoot, "codex-home");
const projectPath = path.join(tempRoot, "project-alpha");
const nonreadyProjectPath = path.join(tempRoot, "project-nonready");
const projectSkillPath = path.join(projectPath, "codex-skills", "e2e-review-skill");
const projectScriptsPath = path.join(projectPath, "scripts");
const projectDocsPath = path.join(projectPath, "docs");
const codexSessionsPath = path.join(codexHome, "sessions", "2026", "06", "01");
const oldThreadId = "11111111-2222-7333-8444-555555555555";
const captureVisuals = process.env.ZHIXIA_CAPTURE_VISUALS === "1";
const visualOutputDir = path.join(root, "artifacts", "visual-checks", "memory-core-project-ui-01");

function writeFixture() {
  fs.mkdirSync(projectSkillPath, { recursive: true });
  fs.mkdirSync(projectScriptsPath, { recursive: true });
  fs.mkdirSync(projectDocsPath, { recursive: true });
  fs.mkdirSync(path.join(nonreadyProjectPath, "docs"), { recursive: true });
  fs.writeFileSync(path.join(nonreadyProjectPath, "docs", "NONREADY.md"), "# Non-ready authority fixture\n", "utf8");
  fs.mkdirSync(codexSessionsPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectSkillPath, "SKILL.md"),
    [
      "---",
      "name: e2e-review-skill",
      "description: Review Zhixia visual behavior in Electron DOM tests.",
      "---",
      "",
      "# E2E Review Skill",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(projectScriptsPath, "package-release.cjs"),
    "// Release package helper. Review before manual use.\nconsole.log('manual only');\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(projectDocsPath, "CEO_FLOW_HANDOFF.md"),
    [
      "# CEO Flow Handoff",
      "",
      "Thread 11111111-2222-7333-8444-555555555555 coordinates worker and reviewer lanes.",
      "Decision: accept metadata-only ThreadLineage governance; no archive, compact, restore, or delete mutation.",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(projectDocsPath, "RELEASE_NOTES.md"),
    "# Release Notes\n\nVisual behavior e2e fixture for project release verification.\n",
    "utf8",
  );
  const sessionPath = path.join(codexSessionsPath, `rollout-e2e-${oldThreadId}.jsonl`);
  const sessionLines = [
    JSON.stringify({ type: "session_meta", payload: { id: oldThreadId, cwd: projectPath, timestamp: "2026-05-01T00:00:00.000Z" } }),
    JSON.stringify({ type: "event", payload: { type: "message", role: "user", content: "Archive candidate visual behavior test is complete and accepted." } }),
    JSON.stringify({ type: "event", payload: { type: "message", role: "assistant", content: "Done. This thread is paused and ready for read-only archive candidate review." } }),
    ...Array.from({ length: 157 }, (_, index) =>
      JSON.stringify({ type: "event", payload: { type: "message", role: "assistant", content: `Small archive candidate fixture line ${index}.` } }),
    ),
    JSON.stringify({ type: "event", payload: { type: "message", role: "assistant", content: "Archive candidate fixture padding. " + "x".repeat(9 * 1024 * 1024) } }),
  ].join("\n");
  fs.writeFileSync(sessionPath, sessionLines + "\n", "utf8");
  const oldTime = new Date("2026-05-01T00:00:00.000Z");
  fs.utimesSync(sessionPath, oldTime, oldTime);
  const guardianToolsDir = path.join(userData, "tools");
  fs.mkdirSync(guardianToolsDir, { recursive: true });
  const escapedSessionPath = sessionPath.replace(/'/g, "''");
  fs.writeFileSync(
    path.join(guardianToolsDir, "codex-history-guardian.ps1"),
    [
      "$result = @{",
      "  largest_session_files = @(",
      "    @{",
      `      path = '${escapedSessionPath}'`,
      "      size_bytes = 9437184",
      "      last_write_time = '2026-05-01T00:00:00.000Z'",
      "    }",
      "  )",
      "  provenance = @{ guardianInventoryPath = '' }",
      "}",
      "$result | ConvertTo-Json -Depth 8",
    ].join("\n"),
    "utf8",
  );
}

function rendererScript() {
  return `
(async () => {
  const projectPath = ${JSON.stringify(projectPath)};
  const phaseKey = "zhixia-visual-e2e-phase";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => document.body.innerText.replace(/\\s+/g, " ");
  const click = (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error("Missing clickable selector: " + selector);
    if (element.disabled) throw new Error("Clickable selector is disabled: " + selector);
    element.scrollIntoView({ block: "center", inline: "center" });
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  };
  const clickButtonText = (label) => {
    const element = Array.from(document.querySelectorAll("button")).find((button) => button.innerText.trim().includes(label));
    if (!element) throw new Error("Missing button text: " + label + ". Body: " + bodyText().slice(0, 1200));
    if (element.disabled) throw new Error("Button is disabled: " + label);
    element.scrollIntoView({ block: "center", inline: "center" });
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  };
  const waitFor = async (predicate, label, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return;
      await sleep(100);
    }
    throw new Error("Timed out waiting for " + label + ". Body: " + bodyText().slice(0, 2000));
  };
  const waitForSelector = (selector) => waitFor(() => document.querySelector(selector), selector);
  const waitForText = (text) => waitFor(() => bodyText().includes(text), text);
  const assertNoHorizontalOverflow = (label) => {
    const rootOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
    if (rootOverflow > 2) {
      throw new Error(label + " root has horizontal overflow: " + rootOverflow + "px");
    }
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(element);
        if (style.position === "fixed" || style.position === "absolute") return false;
        if (element.classList.contains("detail-code") || element.classList.contains("skill-draft-preview")) return false;
        const elementOverflow = element.scrollWidth - element.clientWidth;
        const viewportOverflow = rect.right - window.innerWidth;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return viewportOverflow > 3;
        if (["hidden", "clip"].includes(style.overflowX)) return viewportOverflow > 3;
        return elementOverflow > 3 || viewportOverflow > 3;
      })
      .slice(0, 5)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: String(element.className || ""),
          text: element.textContent.replace(/\\s+/g, " ").slice(0, 100),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          right: Math.round(rect.right),
        };
      });
    if (offenders.length > 0) {
      throw new Error(label + " has horizontally overflowing elements: " + JSON.stringify(offenders));
    }
  };

  if (sessionStorage.getItem(phaseKey) !== "dom") {
    const nonreadyProjectPath = ${JSON.stringify(nonreadyProjectPath)};
    const setup = await window.docKnowledge.e2eProbe({ projectPath, nonreadyProjectPath, seedAuthorityBaseline: true });
    if (!setup.ok) throw new Error("setup probe failed");
    if (setup.memoryCardCount < 1) throw new Error("setup probe did not create project memory cards");
    let nonreadyAuthorityRejected = false;
    try {
      await window.docKnowledge.reviewMemoryRuntimeAuthority({ workspace: nonreadyProjectPath, acceptedChangedPaths: ["docs/NONREADY.md"] });
    } catch (error) {
      nonreadyAuthorityRejected = /authority_review_(?:app_owned_verification_required|checkpoint_required)/.test(String(error));
    }
    if (!nonreadyAuthorityRejected) throw new Error("Non-ready authority review did not fail closed through real Electron IPC");
    const seededAuthority = setup.seededAuthority;
    if (seededAuthority.current !== true || seededAuthority.recoveryReady !== true || seededAuthority.scanBinding?.matched !== true) {
      throw new Error("E2E authority baseline did not become current and recovery-ready");
    }
    sessionStorage.setItem(phaseKey, "dom");
    window.location.reload();
    return { __zhixiaE2EReload: true };
  }

  await waitForText("知匣 Local Doc Knowledge");
  await waitForText("智能优化");
  assertNoHorizontalOverflow("primary shell");
  for (const label of ["项目", "个人库", "工具", "智能优化", "设置"]) {
    if (!bodyText().includes(label)) throw new Error("Missing nav label: " + label);
  }
  await waitForText("按项目查看历史、知识、记忆和工具");
  await waitForText("project-alpha");
  clickButtonText("project-alpha");
  await waitForText("项目历史");
  await waitForText("项目记忆");

  clickButtonText("工具");
  await waitForText("这里只整理，不安装、不启用、不执行");
  await waitForText("只整理，不执行");
  const toolDetailsSummary = Array.from(document.querySelectorAll(".tool-record-details summary")).find((summary) => summary.innerText.trim().includes("查看详情"));
  if (!toolDetailsSummary) throw new Error("Missing tool record details summary");
  toolDetailsSummary.click();
  await waitForText("创建 / 更新");
  await waitForText("干什么用");
  await waitForText("使用项目");
  const toolsText = bodyText();
  if (!toolsText.includes("不安装 / 不执行")) throw new Error("Tools page did not expose no-install/no-execute safety copy");
  assertNoHorizontalOverflow("tools workspace");

  click('[data-e2e-nav="project"]');
  await waitForText("project-alpha");
  clickButtonText("project-alpha");
  await waitForText("项目记忆");
  clickButtonText("项目记忆");
  await waitForSelector('[data-e2e="project-memory-core"]');
  await waitForText("连续性概览");
  await waitForText("项目身份");
  await waitForText("最近有效检查点");
  await waitForText("待复核内容");
  await waitForSelector('[data-e2e="authority-lifecycle-review"]');
  await waitForText("正式来源验收");
  await waitForText("先只读执行 exact scan 与 verify");
  const authorityPathInput = document.querySelector('[data-e2e="lifecycle-changed-paths"]');
  if (!authorityPathInput) throw new Error("Missing authority changed-path input");
  const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  inputSetter.call(authorityPathInput, "docs/CEO_FLOW_HANDOFF.md");
  authorityPathInput.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => !document.querySelector('[data-e2e="lifecycle-review"]').disabled, "enabled authority review");
  const directReview = await window.docKnowledge.reviewMemoryRuntimeAuthority({
    workspace: projectPath,
    acceptedChangedPaths: ["docs/CEO_FLOW_HANDOFF.md"],
  });
  let tamperedAuthorityRejected = false;
  try {
    await window.docKnowledge.acceptMemoryRuntimeAuthority({
      workspace: projectPath,
      acceptedChangedPaths: directReview.binding.acceptedChangedPaths,
      execute: true,
      userConfirmed: true,
      decision: "accept",
      reviewToken: "0".repeat(64),
      expectedProjectIdentitySha256: directReview.binding.projectIdentitySha256,
      expectedScanSha256: directReview.binding.scanSha256,
      previousCheckpointId: directReview.binding.previousCheckpointId,
      sourceRefs: directReview.files.map((file) => ({ path: file.relativePath, sha256: file.sha256 })),
      lane: "ordinary-ui-review",
    });
  } catch {
    tamperedAuthorityRejected = true;
  }
  if (!tamperedAuthorityRejected) throw new Error("Tampered authority review token was accepted");
  click('[data-e2e="lifecycle-review"]');
  await waitFor(() => !document.querySelector('[data-e2e="lifecycle-accept"]').disabled, "reviewed authority acceptance", 30000);
  click('[data-e2e="lifecycle-accept"]');
  await waitForSelector('[data-e2e="lifecycle-verified-result"]');
  await waitForText("已重新验证");
  const verifiedAuthority = document.querySelector('[data-e2e="lifecycle-verified-result"]');
  const verifiedGeneration = verifiedAuthority.dataset.contextGeneration || "";
  const verifiedScan = verifiedAuthority.dataset.scanSha256 || "";
  const verifiedCheckpoint = verifiedAuthority.dataset.checkpointId || "";
  if (!/^context-[a-f0-9]{24}$/.test(verifiedGeneration)
      || verifiedScan !== directReview.binding.scanSha256
      || !/^checkpoint-[A-Za-z0-9-]+$/.test(verifiedCheckpoint)
      || verifiedCheckpoint === directReview.binding.previousCheckpointId) {
    throw new Error("Authority result did not expose an advanced exact generation, scan, and checkpoint: " + JSON.stringify({ verifiedGeneration, verifiedScan, verifiedCheckpoint, review: directReview.binding }));
  }
  await waitForText("为什么会想起这些内容");
  await waitForText("已有经验记忆");
  const projectLayout = document.querySelector(".project-layout--solo");
  if (!projectLayout) throw new Error("Missing solo project detail layout");
  if (window.innerWidth <= 1480 && getComputedStyle(projectLayout).gridTemplateColumns.trim().split(/\s+/).length !== 1) {
    throw new Error("Project detail must use one full-width column in non-maximized desktop windows");
  }
  const memoryText = bodyText();
  for (const label of ["保留", "合并", "拒绝", "归档", "重审"]) {
    const action = Array.from(document.querySelectorAll('[data-e2e="project-memory-core"] button')).find((button) => button.innerText.trim() === label);
    if (action) throw new Error("Project memory view must remain read-only: " + label);
  }
  if (!memoryText.includes("最多返回 4 条") || !memoryText.includes("700 个令牌")) throw new Error("Project memory recall bounds were not shown");
  assertNoHorizontalOverflow("memory workspace");

  clickButtonText("记忆图谱");
  await waitForSelector('[data-e2e="memory-graph-explorer"]');
  await waitFor(() => Number(document.querySelector('[data-e2e="memory-graph-node-count"]')?.textContent || 0) > 0, "non-empty semantic graph", 30000);
  await waitFor(() => {
    const canvases = Array.from(document.querySelectorAll('[data-e2e="memory-graph-canvas"] canvas'));
    return canvases.some((canvas) => {
      if (!canvas.width || !canvas.height) return false;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const step = Math.max(4, Math.floor(pixels.length / 12000 / 4) * 4);
      for (let index = 3; index < pixels.length; index += step) {
        if (pixels[index] > 0) return true;
      }
      return false;
    });
  }, "nonblank Cytoscape canvas", 30000);
  if (${JSON.stringify(captureVisuals)}) {
    window.__ZHIXIA_E2E_GRAPH_CAPTURE_READY = true;
    await waitFor(() => window.__ZHIXIA_E2E_GRAPH_CAPTURE_DONE === true, "memory graph screenshot capture", 20000);
  }
  const graphExplorer = document.querySelector('[data-e2e="memory-graph-explorer"]');
  const listModeButton = Array.from(graphExplorer.querySelectorAll("button")).find((button) => button.innerText.trim().endsWith("列表"));
  if (!listModeButton) throw new Error("Missing graph/list mode control");
  listModeButton.click();
  await waitForSelector('[data-e2e="memory-graph-node-row"]');
  click('[data-e2e="memory-graph-node-row"]');
  await waitForSelector('[data-e2e="memory-graph-inspector"]');
  await waitForText("来源证据");
  assertNoHorizontalOverflow("memory graph workspace");

  clickButtonText("智能优化");
  await waitForText("一键优化规则");
  await waitForText("不需要再单独点入库或整理");
  await waitForText("CEO 创建的实现、审计、准备、回调线程 3 天未复用");
  await waitForText("超过冷却期的 CEO 子线程");
  await waitForText("归档队列生成");
  await waitForText("AI 调取规则");
  await waitForText("记忆运行状态");
  await waitForSelector('[data-e2e="memory-runtime-diagnostics"]');
  await waitFor(() => document.querySelector('[data-e2e="agent-retrieval-contract"]')?.innerText.includes("strict read-only"), "strict read-only Agent UI contract", 30000);
  clickButtonText("运行记忆检索");
  await waitFor(() => document.querySelector('[data-e2e="memory-runtime-diagnostics"]')?.innerText.includes("FTS5 + BM25F"), "Memory Runtime diagnostics result", 30000);
  assertNoHorizontalOverflow("agent workspace");
  const advancedSummary = Array.from(document.querySelectorAll("summary")).find((summary) => summary.innerText.trim().includes("高级操作"));
  if (!advancedSummary) throw new Error("Missing old-thread advanced actions summary");
  advancedSummary.click();
  await waitForSelector('[data-e2e="archive-candidate-scan"]');
  const guardianSupported = window.docKnowledge.platformCapabilities.guardian.supported;
  if (!guardianSupported) {
    await waitForSelector('[data-e2e="guardian-platform-unavailable"]');
    const unavailableText = document.querySelector('[data-e2e="guardian-platform-unavailable"]').innerText;
    if (!unavailableText.includes("仅支持 Windows PowerShell")) throw new Error("Guardian platform boundary was not disclosed: " + unavailableText);
    if (!document.querySelector('[data-e2e="archive-candidate-scan"]').disabled) throw new Error("Guardian scan remained enabled on an unsupported platform");
    const managerControls = Array.from(document.querySelectorAll(".old-thread-manager button, .old-thread-manager input"));
    if (managerControls.some((control) => !control.disabled)) throw new Error("A Guardian control remained enabled on an unsupported platform");
  } else {
    click('[data-e2e="archive-candidate-scan"]');
    try {
      await waitFor(() => document.querySelector('[data-e2e="old-thread-row"]'), "old archive thread row", 30000);
    } catch (error) {
      const managerText = document.querySelector(".old-thread-manager")?.innerText.replace(/\\s+/g, " ").slice(0, 1400) || "missing old-thread-manager";
      const directScan = await window.docKnowledge.listLongCodexThreads({
        limit: 8,
        tokenBudget: 900,
        minBytes: 8 * 1024 * 1024,
        minAgeMinutes: 30,
      });
      throw new Error(
        error.message +
          ". DirectScan: " +
          JSON.stringify({ ok: directScan.ok, count: directScan.result?.items?.length || 0, error: directScan.error, warnings: directScan.result?.warnings || [] }).slice(0, 900) +
          ". OldThreadManager: " +
          managerText,
      );
    }
    click('[data-e2e="old-thread-row"]');
    await waitFor(() => document.querySelector('[data-e2e="archive-candidate-panel"]'), "archive candidate panel", 30000);
    const archiveText = document.querySelector('[data-e2e="archive-candidate-panel"]').innerText.replace(/\\s+/g, " ");
    if (!archiveText.includes("暂不可归档") && !archiveText.includes("可归档候选")) throw new Error("Archive candidate state was not shown: " + archiveText);
    if (!archiveText.includes("归档前证据判断")) throw new Error("Archive candidate panel did not state pre-archive evidence policy in product copy: " + archiveText);
    if (!archiveText.includes("侧栏归档只通过归档队列交给 Codex 宿主执行")) throw new Error("Archive candidate panel did not show host-bridge archive boundary: " + archiveText);
    assertNoHorizontalOverflow("archive candidate panel");
  }

  return {
    ok: true,
    navChecked: true,
    toolsChecked: true,
    memoryChecked: true,
    memoryGraphChecked: true,
    agentChecked: true,
    archiveChecked: guardianSupported,
    archiveUnavailableChecked: !guardianSupported,
    viewportWidth: window.innerWidth,
    noHorizontalOverflowChecked: true,
    projectPath,
  };
})()
`;
}

async function waitForDevToolsTarget(port) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // Electron may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Electron DevTools target on ${port}`);
}

async function captureMemoryGraphScreenshot(port, filePath, viewport) {
  const deadline = Date.now() + 30000;
  let lastError = null;

  // The fixture reloads once after seeding app data. Reconnect when that reload
  // closes the first DevTools socket instead of leaving a pending promise alive.
  while (Date.now() < deadline) {
    let socket = null;
    const pending = new Map();
    let nextId = 0;
    try {
      const target = await waitForDevToolsTarget(port);
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      const rejectPending = (error) => {
        for (const request of pending.values()) request.reject(error);
        pending.clear();
      };
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (!message.id || !pending.has(message.id)) return;
        const request = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result || {});
      });
      socket.addEventListener("close", () => rejectPending(new Error("Electron DevTools socket closed")));
      socket.addEventListener("error", () => rejectPending(new Error("Electron DevTools socket failed")));
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
          reject(new Error("Electron DevTools socket is not open"));
          return;
        }
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Electron DevTools command timed out: ${method}`));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });

      await send("Runtime.enable");
      while (Date.now() < deadline) {
        const result = await send("Runtime.evaluate", {
          expression: `window.__ZHIXIA_E2E_GRAPH_CAPTURE_READY === true && Number(document.querySelector('[data-e2e="memory-graph-node-count"]')?.textContent || 0) > 0 && Boolean(document.querySelector('[data-e2e="memory-graph-canvas"] canvas'))`,
          returnByValue: true,
        });
        if (result.result?.value === true) {
          await send("Emulation.setDeviceMetricsOverride", {
            width: viewport.captureWidth || viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await new Promise((resolve) => setTimeout(resolve, 180));
          const page = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, Buffer.from(page.data, "base64"));
          await send("Runtime.evaluate", {
            expression: `window.__ZHIXIA_E2E_GRAPH_CAPTURE_DONE = true`,
            returnByValue: true,
          });
          return filePath;
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Electron DevTools screenshot attempt ended"));
      }
      pending.clear();
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    }
  }
  throw new Error(`Project Memory Graph screenshot capture failed: ${lastError?.message || "timed out"}`);
}

function runElectronVisualProbe(viewport = {}, index = 0) {
  return new Promise((resolve, reject) => {
    const port = 9320 + index;
    const screenshotPath = path.join(
      visualOutputDir,
      `memory-graph-project-${viewport.captureWidth || viewport.width}x${viewport.height}.png`,
    );
    const child = spawn(electronExe, [
      root,
      "--user-data-dir=" + userData,
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--ozone-platform=headless",
      ...(captureVisuals ? [`--remote-debugging-port=${port}`] : []),
    ], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        ELECTRON_DISABLE_GPU: "1",
        ELECTRON_ENABLE_LOGGING: "1",
        ZHIXIA_E2E_PROBE: "1",
        ZHIXIA_E2E_RENDERER_SCRIPT: rendererScript(),
        ...(viewport.width ? { ZHIXIA_E2E_VIEWPORT_WIDTH: String(viewport.width) } : {}),
        ...(viewport.height ? { ZHIXIA_E2E_VIEWPORT_HEIGHT: String(viewport.height) } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let screenshotError = null;
    const screenshotPromise = captureVisuals
      ? captureMemoryGraphScreenshot(port, screenshotPath, viewport).catch((error) => {
          screenshotError = error;
          return null;
        })
      : Promise.resolve(null);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron visual behavior e2e timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 45000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", async (code) => {
      clearTimeout(timer);
      const matches = [...stdout.matchAll(/ZHIXIA_E2E_RESULT (.+)/g)];
      const match = matches[matches.length - 1];
      if (!match) {
        reject(new Error(`Electron visual behavior e2e did not return a result. Exit ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(match[1]);
        result.screenshotPath = await screenshotPromise;
        if (screenshotError) throw screenshotError;
        resolve(result);
      } catch (error) {
        reject(new Error(`Electron visual behavior e2e returned invalid JSON: ${error.message}\n${match[1]}`));
      }
    });
  });
}

function cleanupTempRoot() {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  if (fs.existsSync(tempRoot)) {
    throw new Error(`Electron visual behavior e2e temp directory was not removed: ${tempRoot}`);
  }
}

(async () => {
  try {
    writeFixture();
    const results = [
      await runElectronVisualProbe({ width: 1920, height: 1080 }, 0),
      await runElectronVisualProbe({ width: 1366, height: 768 }, 1),
      await runElectronVisualProbe({ width: 960, captureWidth: 960, height: 640 }, 2),
    ];
    for (const result of results) {
      assert.equal(result.ok, true, "Electron visual behavior probe should complete");
      assert.equal(result.navChecked, true, "visual probe should exercise primary navigation");
      assert.equal(result.toolsChecked, true, "visual probe should check Tools safety copy");
      assert.equal(result.memoryChecked, true, "visual probe should check Memory curation UI");
      assert.equal(result.memoryGraphChecked, true, "visual probe should check the on-demand Memory Graph UI");
      assert.equal(result.agentChecked, true, "visual probe should check Agent/runtime monitor UI");
      assert.equal(
        result.archiveChecked || result.archiveUnavailableChecked,
        true,
        "visual probe should check either the real archive journey or the explicit unavailable boundary",
      );
      assert.notEqual(result.archiveChecked, result.archiveUnavailableChecked, "archive capability evidence must be exactly one supported state");
      assert.equal(result.noHorizontalOverflowChecked, true, "visual probe should check horizontal overflow");
    }
    assert.ok(results.some((result) => result.viewportWidth <= 1000), "visual probe should cover narrow desktop viewport");
    console.log("Electron visual behavior e2e tests passed.");
  } finally {
    cleanupTempRoot();
  }
})().catch((error) => {
  console.error(error);
  cleanupTempRoot();
  process.exit(1);
});
