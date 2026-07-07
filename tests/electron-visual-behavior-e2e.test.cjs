const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const electronExe = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-electron-visual-e2e-"));
const userData = path.join(tempRoot, "user-data");
const codexHome = path.join(tempRoot, "codex-home");
const projectPath = path.join(tempRoot, "project-alpha");
const projectSkillPath = path.join(projectPath, "codex-skills", "e2e-review-skill");
const projectScriptsPath = path.join(projectPath, "scripts");
const projectDocsPath = path.join(projectPath, "docs");
const codexSessionsPath = path.join(codexHome, "sessions", "2026", "06", "01");
const oldThreadId = "11111111-2222-7333-8444-555555555555";

function writeFixture() {
  fs.mkdirSync(projectSkillPath, { recursive: true });
  fs.mkdirSync(projectScriptsPath, { recursive: true });
  fs.mkdirSync(projectDocsPath, { recursive: true });
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
    const setup = await window.docKnowledge.e2eProbe({ projectPath });
    if (!setup.ok) throw new Error("setup probe failed");
    if (setup.memoryCardCount < 1) throw new Error("setup probe did not create project memory cards");
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
  await waitForText("经验记忆");

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
  await waitForText("经验记忆");
  clickButtonText("经验记忆");
  await waitForText("项目历史记忆");
  await waitForText("来源签名");
  await waitForText("重复治理");
  await waitForText("合并目标");
  const memoryText = bodyText();
  for (const label of ["保留", "合并", "拒绝", "归档", "重审"]) {
    if (!memoryText.includes(label)) throw new Error("Memory curation action missing: " + label);
  }
  assertNoHorizontalOverflow("memory workspace");

  clickButtonText("智能优化");
  await waitForText("一键优化规则");
  await waitForText("不需要再单独点入库或整理");
  await waitForText("CEO 创建的实现、审计、准备、回调线程 3 天未复用");
  await waitForText("超过冷却期的 CEO 子线程");
  await waitForText("归档队列生成");
  await waitForText("AI 调取规则");
  assertNoHorizontalOverflow("agent workspace");
  const advancedSummary = Array.from(document.querySelectorAll("summary")).find((summary) => summary.innerText.trim().includes("高级操作"));
  if (!advancedSummary) throw new Error("Missing old-thread advanced actions summary");
  advancedSummary.click();
  await waitForSelector('[data-e2e="archive-candidate-scan"]');
  if (!document.querySelector('[data-e2e="archive-candidate-scan"]').disabled) {
    click('[data-e2e="archive-candidate-scan"]');
  }
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

  return {
    ok: true,
    navChecked: true,
    toolsChecked: true,
    memoryChecked: true,
    agentChecked: true,
    archiveChecked: true,
    viewportWidth: window.innerWidth,
    noHorizontalOverflowChecked: true,
    projectPath,
  };
})()
`;
}

function runElectronVisualProbe(viewport = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronExe, [
      root,
      "--user-data-dir=" + userData,
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--ozone-platform=headless",
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
    child.on("exit", (code) => {
      clearTimeout(timer);
      const matches = [...stdout.matchAll(/ZHIXIA_E2E_RESULT (.+)/g)];
      const match = matches[matches.length - 1];
      if (!match) {
        reject(new Error(`Electron visual behavior e2e did not return a result. Exit ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(match[1]));
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
      await runElectronVisualProbe(),
      await runElectronVisualProbe({ width: 980, height: 720 }),
    ];
    for (const result of results) {
      assert.equal(result.ok, true, "Electron visual behavior probe should complete");
      assert.equal(result.navChecked, true, "visual probe should exercise primary navigation");
      assert.equal(result.toolsChecked, true, "visual probe should check Tools safety copy");
      assert.equal(result.memoryChecked, true, "visual probe should check Memory curation UI");
      assert.equal(result.agentChecked, true, "visual probe should check Agent/runtime monitor UI");
      assert.equal(result.archiveChecked, true, "visual probe should check archive candidate read-only UI");
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
