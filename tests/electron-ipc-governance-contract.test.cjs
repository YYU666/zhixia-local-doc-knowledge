const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
const archiveCandidatePolicy = fs.readFileSync(path.join(root, "electron", "archiveCandidatePolicy.cjs"), "utf8");
const agentRetrievePolicy = fs.readFileSync(path.join(root, "electron", "agentRetrievePolicy.cjs"), "utf8");
const viteEnv = fs.readFileSync(path.join(root, "src", "vite-env.d.ts"), "utf8");
const appTsx = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const signature = source.slice(start).match(/^function\s+\w+\s*\([\s\S]*?\)\s*\{/);
  assert.ok(signature, `${functionName} must have an extractable signature`);
  const bodyStart = start + signature[0].lastIndexOf("{");
  assert.notEqual(bodyStart, -1, `${functionName} must have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${functionName} body was not closed`);
}

const confirmInventory = extractFunctionSource(main, "confirmToolSkillInventorySnapshot");
const updateRecordGovernance = extractFunctionSource(main, "updateToolSkillRecordGovernance");
const attachRecordGovernance = extractFunctionSource(main, "attachToolSkillRecordGovernance");
const buildRecordContextHash = extractFunctionSource(main, "buildToolSkillRecordContextHash");
const buildLineageRecord = extractFunctionSource(main, "buildThreadLineageIndexRecord");
const makeLineageItem = extractFunctionSource(main, "makeAgentRetrieveThreadLineageIndex");

assert.match(preload, /confirmToolSkillInventory:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\("tools:confirmInventory",\s*options\)/, "preload must expose Tool/Skill snapshot confirmation IPC");
assert.match(preload, /updateToolSkillRecordGovernance:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\("tools:updateRecordGovernance",\s*options\)/, "preload must expose per-record Tool/Skill governance IPC");
assert.match(preload, /retrieveAgentContext:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\("agent:retrieveContext",\s*options\)/, "preload must pass retrieval options through to main");

assert.match(main, /ipcMain\.handle\("tools:confirmInventory"/, "main must register Tool/Skill snapshot confirmation handler");
assert.match(main, /ipcMain\.handle\("tools:updateRecordGovernance"/, "main must register per-record Tool/Skill governance handler");
assert.match(main, /ipcMain\.handle\("agent:retrieveContext"/, "main must register agent retrieval handler");

assert.match(confirmInventory, /requestedHash[\s\S]*requestedHash !== result\.snapshotHash[\s\S]*snapshot hash changed before confirmation/i, "Tool/Skill snapshot confirmation must reject stale snapshot hashes");
assert.match(updateRecordGovernance, /requestedHash[\s\S]*requestedHash !== result\.snapshotHash[\s\S]*snapshot hash changed before per-record governance update/i, "per-record governance updates must reject stale snapshot hashes");
assert.match(updateRecordGovernance, /normalizeToolSkillGovernanceStatus/, "per-record governance updates must normalize allowed statuses");
assert.match(updateRecordGovernance, /recordId[\s\S]*status[\s\S]*required/i, "per-record governance updates must require a record id and status");
assert.match(updateRecordGovernance, /record is no longer present in the live inventory/i, "per-record governance updates must reject missing live inventory records");
assert.match(updateRecordGovernance, /status === "clear"[\s\S]*DELETE FROM tool_skill_record_governance/, "clear must remove per-record governance instead of creating an active state");
assert.match(updateRecordGovernance, /ON CONFLICT\(projectPath, recordId\) DO UPDATE SET/, "per-record governance must persist updates idempotently");
assert.match(attachRecordGovernance, /reviewState[\s\S]*row\.recordContextHash === recordContextHash \? "current" : "stale"/, "record context hash changes must surface stale review state");
assert.match(buildRecordContextHash, /safeCommands[\s\S]*forbiddenCommands/, "Tool/Skill record context hash must include command boundary fields");

assert.doesNotMatch(updateRecordGovernance, /automatic_install|automatic_execution|spawn|execFile|execSync|shell\.open/i, "per-record governance update must not install, execute, or open candidate assets");
assert.doesNotMatch(archiveCandidatePolicy, /compact-session|clean-logs|prune-process-manager|restore/i, "archive candidate policy must not run Guardian/session mutation commands");

assert.match(agentRetrievePolicy, /"thread_lineage_index"/, "agent retrieval policy must allow explicit ThreadLineageIndex metadata kind");
assert.match(agentRetrievePolicy, /request\.allowedKinds\.has\("thread_lineage_index"\)/, "ThreadLineageIndex retrieval must participate in the metadata read plan");
assert.match(viteEnv, /"thread_lineage_index"/, "renderer types must include ThreadLineageIndex retrieval kind");
assert.match(appTsx, /kind === "thread_lineage_index"[\s\S]*线程族谱/, "renderer must label ThreadLineageIndex retrieval items");
assert.match(buildLineageRecord, /metadata_only_no_raw_body/, "ThreadLineageIndex records must declare metadata-only raw-session policy");
assert.match(buildLineageRecord, /read_only_no_archive_compact_restore_delete/, "ThreadLineageIndex records must declare no archive/compact/restore/delete mutation policy");
assert.match(buildLineageRecord, /evaluateArchiveCandidate/, "ThreadLineageIndex records must attach archive candidate blockers through the existing fail-closed policy");
assert.match(makeLineageItem, /requiresHumanConfirmation:\s*true/, "ThreadLineageIndex retrieval must remain human-review material");
assert.match(makeLineageItem, /policy:no-archive-compact-restore-delete/, "ThreadLineageIndex retrieval must preserve no-mutation provenance");

console.log("Electron IPC governance contract tests passed.");
