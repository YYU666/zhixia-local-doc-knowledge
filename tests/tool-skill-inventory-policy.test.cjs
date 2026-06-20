const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TOOL_SKILL_INVENTORY_VERSION,
  buildToolSkillInventory,
  buildToolSkillInventoryJson,
  buildToolSkillInventoryMarkdown,
  isSensitiveFile,
} = require("../electron/toolSkillInventoryPolicy.cjs");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-tool-skill-"));

try {
  const workspacePath = path.join(tempRoot, "project-alpha");
  const userSkillsRoot = path.join(tempRoot, "user-skills");
  const globalSkillPath = path.join(userSkillsRoot, "writer-skill");
  const projectSkillPath = path.join(workspacePath, "codex-skills", "review-skill");
  const projectScriptsPath = path.join(workspacePath, "scripts");
  const workflowPath = path.join(tempRoot, "workflow");

  fs.mkdirSync(globalSkillPath, { recursive: true });
  fs.mkdirSync(projectSkillPath, { recursive: true });
  fs.mkdirSync(projectScriptsPath, { recursive: true });
  fs.mkdirSync(workflowPath, { recursive: true });

  fs.writeFileSync(
    path.join(globalSkillPath, "SKILL.md"),
    [
      "---",
      "name: writer-skill",
      "description: Draft release-note and documentation writing helper for Codex.",
      "---",
      "",
      "# Writer Skill",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(globalSkillPath, ".env"), "API_KEY=do-not-copy", "utf8");

  fs.writeFileSync(
    path.join(projectSkillPath, "SKILL.md"),
    [
      "---",
      "name: review-skill",
      "description: Review Zhixia project memory governance outputs.",
      "---",
      "",
      "# Review Skill",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(projectSkillPath, "private-key.pem"), "-----BEGIN PRIVATE KEY-----\nsecret\n", "utf8");

  fs.writeFileSync(
    path.join(projectScriptsPath, "package-release.cjs"),
    "// Package the Windows release after explicit human approval.\nconsole.log('package');\n",
    "utf8",
  );
  fs.writeFileSync(path.join(projectScriptsPath, "token.txt"), "secret-token", "utf8");
  fs.mkdirSync(path.join(projectScriptsPath, "node_modules", "hidden-tool"), { recursive: true });
  fs.writeFileSync(
    path.join(projectScriptsPath, "node_modules", "hidden-tool", "hidden.cjs"),
    "// dependency helper should not become a user tool\n",
    "utf8",
  );
  fs.mkdirSync(path.join(projectScriptsPath, "Site-Packages", "hidden_tool"), { recursive: true });
  fs.writeFileSync(
    path.join(projectScriptsPath, "Site-Packages", "hidden_tool", "hidden.py"),
    "# dependency helper should not become a user tool\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(workflowPath, "autoflow-helper.ps1"),
    "# AutoFlow helper for completion ledger inspection only.\nWrite-Output 'inspect'\n",
    "utf8",
  );
  fs.writeFileSync(path.join(workflowPath, ".env.local"), "COOKIE=secret-cookie", "utf8");

  assert.equal(isSensitiveFile(path.join(projectScriptsPath, ".env")), true, "env files should be sensitive");
  assert.equal(isSensitiveFile(path.join(projectScriptsPath, "private-key.pem")), true, "private keys should be sensitive");
  assert.equal(isSensitiveFile(path.join(projectScriptsPath, "normal-script.cjs")), false, "ordinary scripts should be scannable");

  const snapshot = buildToolSkillInventory({
    workspacePath,
    projectId: "project-alpha",
    codexSkillRoots: [userSkillsRoot],
    projectSkillRoots: [path.join(workspacePath, "codex-skills")],
    scriptRoots: [projectScriptsPath],
    workflowRoots: [workflowPath],
    scannedAt: "2026-06-13T00:00:00.000Z",
  });

  assert.equal(snapshot.inventory.contractVersion, TOOL_SKILL_INVENTORY_VERSION, "inventory contract version should be explicit");
  assert.equal(snapshot.inventory.scope, "project", "workspace inventories should be project scoped");
  assert.equal(snapshot.inventory.workspacePath, workspacePath, "workspace path should be preserved");
  assert.equal(snapshot.inventory.projectId, "project-alpha", "project id should be preserved");
  assert.equal(snapshot.inventory.status, "ready", "fixture roots should produce a ready inventory");
  assert.equal(snapshot.inventory.candidateCount, 4, "all discovered assets should default to candidates");
  assert.equal(snapshot.inventory.activeCount, 0, "automatic discovery must not mark records active");
  assert.equal(snapshot.inventory.blockedCount, 0, "fixture should not fabricate blocked records");
  assert.deepEqual(
    snapshot.inventory.recordIds,
    snapshot.records.map((record) => record.id),
    "inventory recordIds should match records",
  );
  assert.ok(
    snapshot.inventory.sourceRoots.some((root) => root.kind === "skill_dir" && root.exists),
    "global skill root should be listed",
  );
  assert.ok(
    snapshot.inventory.sourceRoots.some((root) => root.kind === "project_script" && root.exists),
    "project script root should be listed",
  );

  const names = snapshot.records.map((record) => record.name).sort();
  assert.deepEqual(
    names,
    ["autoflow-helper.ps1", "package-release.cjs", "review-skill", "writer-skill"].sort(),
    "inventory should include global skill, project skill, project script, and workflow helper",
  );
  assert.ok(!names.includes("hidden.cjs"), "inventory should skip node_modules tools");
  assert.ok(!names.includes("hidden.py"), "inventory should skip Python site-packages tools case-insensitively");

  const globalSkill = snapshot.records.find((record) => record.name === "writer-skill");
  assert.equal(globalSkill.kind, "codex_skill", "skill directories should become codex_skill records");
  assert.equal(globalSkill.installed, true, "user skill roots represent installed assets");
  assert.equal(globalSkill.status, "candidate", "skills should default to candidate");
  assert.equal(globalSkill.requiresHumanConfirmation, true, "skills require human confirmation");
  assert.ok(globalSkill.sensitiveScanSkipped.includes(".env"), "sensitive files near skills should be listed, not read");
  assert.ok(globalSkill.forbiddenCommands.includes("automatic_install"), "records should forbid automatic install");
  assert.ok(globalSkill.forbiddenCommands.includes("automatic_execution"), "records should forbid automatic execution");

  const projectSkill = snapshot.records.find((record) => record.name === "review-skill");
  assert.equal(projectSkill.installed, false, "project skill roots are source assets, not automatically installed");
  assert.ok(
    projectSkill.sensitiveScanSkipped.includes("private-key.pem"),
    "private keys should be skipped in project skill directories",
  );

  const releaseScript = snapshot.records.find((record) => record.name === "package-release.cjs");
  assert.equal(releaseScript.kind, "workflow_script", "release/package scripts should be workflow scripts");
  assert.equal(releaseScript.installed, false, "scripts are not installed tools");
  assert.ok(
    releaseScript.riskBoundaries.some((item) => /not executed/i.test(item)),
    "script records should state they are not executed by discovery",
  );

  assert.ok(
    snapshot.inventory.sensitiveScanSkipped.some((item) => item.includes("token.txt")),
    "sensitive project script files should be represented as skipped",
  );
  assert.ok(
    snapshot.inventory.sensitiveScanSkipped.some((item) => item.includes(".env.local")),
    "sensitive workflow files should be represented as skipped",
  );

  const exportJson = buildToolSkillInventoryJson(snapshot);
  const exportMarkdown = buildToolSkillInventoryMarkdown(snapshot);
  const serialized = JSON.stringify(exportJson) + "\n" + exportMarkdown;
  assert.equal(exportJson.records.length, 4, "compact JSON should include discovered records");
  assert.match(exportMarkdown, /read-only candidate material/i, "markdown should state read-only candidate boundary");
  assert.match(exportMarkdown, /RequiresHumanConfirmation: true/, "markdown should expose confirmation boundary");
  assert.doesNotMatch(serialized, /do-not-copy|secret-token|secret-cookie|BEGIN PRIVATE KEY/, "exports must not contain secret contents");
  assert.match(serialized, /token\.txt|\.env\.local|private-key\.pem/, "exports may list skipped sensitive paths");
  assert.doesNotMatch(serialized, /execSync|spawnSync|child_process/, "inventory exports should not imply execution code paths");

  console.log("Tool skill inventory policy tests passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
