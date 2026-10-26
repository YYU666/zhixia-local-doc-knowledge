const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { execute, scanExactWorkspace } = require("../electron/memoryRuntimeCli.cjs");

function git(workspace, ...args) {
  execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
}

function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-scan-integrity-"));
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-scan-integrity-store-"));
  try {
    git(workspace, "init", "-q");
    fs.writeFileSync(path.join(workspace, "README.md"), "# Scan integrity fixture\n");
    git(workspace, "add", "README.md");
    git(workspace, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
    fs.mkdirSync(path.join(workspace, "src"));
    for (let index = 0; index < 129; index += 1) {
      fs.writeFileSync(path.join(workspace, "src", `f${String(index).padStart(3, "0")}.ts`), `export const value = ${index};\n`);
    }

    const first = scanExactWorkspace({ workspace });
    assert.equal(first.workingTree.truncated, true);
    assert.equal(first.workingTree.integrityComplete, true);
    fs.mkdirSync(path.join(workspace, "evidence"));
    fs.writeFileSync(path.join(workspace, "evidence", "run.json"), '{"generated":true}\n');
    fs.mkdirSync(path.join(workspace, "docs"));
    fs.writeFileSync(path.join(workspace, "docs", "review.png"), Buffer.from([0, 1, 2]));
    const afterExcluded = scanExactWorkspace({ workspace });
    assert.equal(afterExcluded.scanSha256, first.scanSha256);
    assert.equal(afterExcluded.workingTree.exclusions.generated, 1);
    assert.equal(afterExcluded.workingTree.exclusions.documentVisual, 1);
    assert.throws(() => scanExactWorkspace({ workspace, relativePaths: ["evidence/run.json"] }), /workspace_required_source_not_canonical_text/);
    assert.throws(() => scanExactWorkspace({ workspace, relativePaths: ["docs/review.png"] }), /workspace_required_source_not_canonical_text/);
    fs.writeFileSync(path.join(workspace, "src", "private-key.ts"), "export const marker = true;\n");
    const afterSensitive = scanExactWorkspace({ workspace });
    assert.equal(afterSensitive.scanSha256, first.scanSha256);
    assert.equal(afterSensitive.workingTree.exclusions.sensitive, 1);
    assert.throws(() => scanExactWorkspace({ workspace, relativePaths: ["src/private-key.ts"] }), /workspace_required_source_not_canonical_text/);
    fs.rmSync(path.join(workspace, "src", "private-key.ts"));
    assert.throws(() => scanExactWorkspace({ workspace, relativePaths: ["src/missing.ts"] }), /workspace_required_source_missing/);
    assert.throws(() => scanExactWorkspace({ workspace, relativePaths: Array(49).fill("README.md") }), /workspace_required_source_limit_exceeded/);
    fs.writeFileSync(path.join(workspace, "src", "source.swift"), "let value = 1\n");
    const withSource = scanExactWorkspace({ workspace, relativePaths: ["src/source.swift"] });
    assert.equal(withSource.workingTree.integrityComplete, true);
    assert.ok(withSource.files.some((file) => file.relativePath === "src/source.swift"));
    const required = Array.from({ length: 48 }, (_, index) => `src/f${String(index).padStart(3, "0")}.ts`);
    const bounded = scanExactWorkspace({ workspace, relativePaths: required });
    assert.deepEqual(bounded.files.map((file) => file.relativePath), required);
    fs.rmSync(path.join(workspace, "src", "source.swift"));
    assert.equal(scanExactWorkspace({ workspace }).scanSha256, first.scanSha256);
    const seeded = execute({
      operation: "seed",
      workspace,
      storeRoot,
      execute: true,
      expectedScanSha256: first.scanSha256,
      projectName: "Scan integrity fixture",
      moduleId: "scan-integrity",
      continuity: {
        originalGoal: "Retain exact source-backed project memory.",
        phase: "scan integrity regression",
        projectSummary: "A bounded local fixture for exact-scan verification.",
        architectureAnchors: ["All changed text postimages contribute to the scan digest."],
        standingRules: ["Incomplete scans never authorize memory."],
        acceptanceCriteria: ["A changed overflow path invalidates the checkpoint."],
        safetyRules: ["Never treat generated compatibility files as source authority."],
        acceptedProgress: ["The initial fixture was accepted."],
        openTasks: ["Verify overflow invalidation."],
        nextActions: ["Change the last source file."],
        threadLineage: ["scan-integrity-test"],
      },
    });
    assert.equal(seeded.current, true);
    fs.writeFileSync(path.join(workspace, "src", "f128.ts"), "export const value = 999;\n");
    const second = scanExactWorkspace({ workspace });
    assert.notEqual(second.scanSha256, first.scanSha256, "a change after the preview limit must change the exact scan");
    const stale = execute({ operation: "verify", workspace, storeRoot });
    assert.equal(stale.current, false, "the previously authorized checkpoint must not survive overflow postimage drift");

    fs.mkdirSync(path.join(workspace, ".codex-knowledge"));
    fs.writeFileSync(path.join(workspace, ".codex-knowledge", "project-resume.md"), "Generated compatibility packet\n");
    const afterGeneratedPacket = scanExactWorkspace({ workspace });
    assert.equal(afterGeneratedPacket.scanSha256, second.scanSha256, "generated compatibility files must not change source authority");

    fs.writeFileSync(path.join(workspace, "src", "f128.ts"), Buffer.from([0x66, 0x6f, 0xff]));
    const firstBytes = scanExactWorkspace({ workspace });
    fs.writeFileSync(path.join(workspace, "src", "f128.ts"), Buffer.from([0x66, 0x6f, 0xfe]));
    const secondBytes = scanExactWorkspace({ workspace });
    assert.notEqual(secondBytes.scanSha256, firstBytes.scanSha256, "postimage hashing must use file bytes, not lossy UTF-8 decoding");

    fs.writeFileSync(path.join(workspace, "src", "unverifiable.png"), Buffer.from([0, 1, 2]));
    const incomplete = scanExactWorkspace({ workspace });
    assert.equal(incomplete.workingTree.integrityComplete, false);
    const incompleteVerification = execute({ operation: "verify", workspace, storeRoot });
    assert.equal(incompleteVerification.current, false);
    assert.equal(incompleteVerification.scanBinding.integrityComplete, false);
    assert.ok(incompleteVerification.warnings.includes("workspace_scan_integrity_incomplete"));
    const rejectedStoreRoot = path.join(workspace, "private-store");
    assert.throws(() => execute({
      operation: "seed",
      workspace,
      storeRoot: rejectedStoreRoot,
      execute: true,
      expectedScanSha256: incomplete.scanSha256,
    }), /workspace_scan_integrity_incomplete/);
    assert.equal(fs.existsSync(rejectedStoreRoot), false, "an incomplete scan must be rejected before private state is opened");

    console.log("Memory Runtime exact-scan integrity tests passed.");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
}

main();
