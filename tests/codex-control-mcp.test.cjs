const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const serverPath = path.join(appRoot, "codex-skills", "zhixia-local-docs", "scripts", "codex-control-mcp.cjs");
const runtimePath = path.join(appRoot, "electron", "memoryRuntimeCli.cjs");

function createClient(env) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: appRoot,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message);
  });
  let nextId = 1;
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP timeout for ${method}; stderr=${stderr}`));
        }, 10_000);
        pending.set(id, { resolve: (message) => { clearTimeout(timer); resolve(message); } });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      child.stdin.end();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`MCP server did not exit; stderr=${stderr}`));
        }, 3000);
        child.once("exit", (code) => {
          clearTimeout(timer);
          assert.equal(code, 0, `MCP server failed: ${stderr}`);
          resolve();
        });
      });
    },
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-codex-control-"));
  const workspace = path.join(root, "workspace");
  const storeRoot = path.join(root, "memory-runtime");
  const fakeApp = path.join(root, "知匣.app");
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.mkdirSync(fakeApp, { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "PRD.md"), "# Codex control MCP acceptance\n", "utf8");
  const client = createClient({
    ZHIXIA_MEMORY_RUNTIME_CLI: runtimePath,
    ZHIXIA_MEMORY_RUNTIME_ROOT: storeRoot,
    ZHIXIA_CONTROL_APP_PATH: fakeApp,
    ZHIXIA_CONTROL_DISABLE_APP_OPEN: "1",
  });

  try {
    const initialize = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex-control-test", version: "1.0.0" },
    });
    assert.equal(initialize.result.serverInfo.name, "zhixia-control");
    client.notify("notifications/initialized");

    const listed = await client.request("tools/list");
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["open_app", "scan_workspace", "verify_project", "retrieve_context", "prepare_takeover", "writeback_evidence", "refresh_binding"],
    );

    const opened = await client.request("tools/call", {
      name: "open_app",
      arguments: { workspace },
    });
    assert.equal(opened.result.isError, false);
    assert.equal(opened.result.structuredContent.status, "disabled_for_test");

    const scanned = await client.request("tools/call", {
      name: "scan_workspace",
      arguments: { workspace },
    });
    assert.equal(scanned.result.isError, false);
    assert.equal(scanned.result.structuredContent.operation, "scan");
    assert.equal(scanned.result.structuredContent.app.status, "disabled_for_test");
    assert.match(scanned.result.structuredContent.scanSha256, /^[a-f0-9]{64}$/);

    const verified = await client.request("tools/call", {
      name: "verify_project",
      arguments: { workspace, taskGoal: "Verify Codex control" },
    });
    assert.equal(verified.result.isError, false);
    assert.equal(verified.result.structuredContent.operation, "verify");
    assert.equal(verified.result.structuredContent.current, false);

    const source = scanned.result.structuredContent.sourceRefs.find((ref) => ref.title === "docs/PRD.md");
    const writeback = await client.request("tools/call", {
      name: "writeback_evidence",
      arguments: {
        workspace,
        execute: true,
        expectedProjectIdentitySha256: scanned.result.structuredContent.projectIdentity.projectIdentitySha256,
        expectedScanSha256: scanned.result.structuredContent.scanSha256,
        decision: "accept",
        title: "Codex control MCP accepted",
        summary: "The app-owned MCP accepted exact source-backed evidence.",
        sourceRefs: [{ path: source.path, hash: source.hash }],
      },
    });
    assert.equal(writeback.result.isError, false, JSON.stringify(writeback));
    assert.equal(writeback.result.structuredContent.operation, "writeback_evidence");
    assert.equal(writeback.result.structuredContent.accepted, true);

    const arbitraryUri = await client.request("tools/call", {
      name: "writeback_evidence",
      arguments: {
        workspace,
        execute: true,
        expectedProjectIdentitySha256: scanned.result.structuredContent.projectIdentity.projectIdentitySha256,
        expectedScanSha256: scanned.result.structuredContent.scanSha256,
        decision: "accept",
        title: "Reject arbitrary URI",
        summary: "An external URI must not become app-owned evidence.",
        sourceRefs: [{ path: "https://example.invalid/evidence", hash: source.hash }],
      },
    });
    assert.equal(arbitraryUri.result.isError, true);
    assert.match(arbitraryUri.result.content[0].text, /lifecycle_non_file_source_ref_not_trusted/);

    const serialized = JSON.stringify({ opened, scanned, verified, writeback, arbitraryUri });
    assert.doesNotMatch(serialized, /data:image|\.codex[\\/]sessions|BEGIN PRIVATE KEY|A{240}/);
    console.log("Zhixia Codex control MCP tests passed.");
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
