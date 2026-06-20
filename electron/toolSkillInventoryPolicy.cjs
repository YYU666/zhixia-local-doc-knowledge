const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TOOL_SKILL_INVENTORY_VERSION = "tool_skill_inventory_v1";
const MAX_TEXT_READ_CHARS = 6000;
const MAX_SCRIPT_RECORDS_PER_ROOT = 80;
const SCRIPT_EXTENSIONS = new Set([".bat", ".cmd", ".cjs", ".js", ".mjs", ".ps1", ".py", ".sh", ".ts"]);
const SKIP_DIR_NAMES = new Set([
  ".git",
  ".next",
  ".venv",
  "venv",
  "env",
  ".env",
  "build",
  "dist",
  "node_modules",
  "out",
  "release",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".cache",
  "site-packages",
]);
const SENSITIVE_FILE_PATTERNS = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.key$/i,
  /(^|[._-])(token|cookie|secret|private[_-]?key|credential|password)([._-]|$)/i,
  /shell[_-]?history/i,
];

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactText(value, maxChars = 240) {
  const text = cleanText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hashFile(filePath) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch (_error) {
    return null;
  }
}

function readSmallText(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_TEXT_READ_CHARS));
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (_error) {
    return "";
  }
}

function pathExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function isSensitiveFile(filePath) {
  const baseName = path.basename(filePath || "");
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(baseName));
}

function toForwardSlashes(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function relativeOrAbsolute(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath);
  if (!relativePath || relativePath.startsWith("..")) return filePath;
  return relativePath;
}

function parseSkillFrontmatter(text) {
  const match = String(text || "").match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*"?([^"]*)"?\s*$/);
    if (item) fields[item[1]] = item[2].trim();
  }
  return fields;
}

function extractFirstHeading(text) {
  const match = String(text || "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function uniqCompact(values, limit = 12) {
  const seen = new Set();
  const result = [];
  for (const value of values.flat().filter(Boolean)) {
    const item = compactText(value, 90);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function stableRecordId(parts) {
  return `tool-skill-${hashText(parts.filter(Boolean).join("|")).slice(0, 16)}`;
}

function collectSensitiveSkips(rootPath, maxDepth = 2) {
  const skipped = [];
  const visit = (dirPath, depth) => {
    if (depth > maxDepth || skipped.length >= 40) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name.toLowerCase())) visit(entryPath, depth + 1);
        continue;
      }
      if (entry.isFile() && isSensitiveFile(entryPath)) {
        skipped.push(toForwardSlashes(relativeOrAbsolute(rootPath, entryPath)));
      }
    }
  };
  if (isDirectory(rootPath)) visit(rootPath, 0);
  return skipped;
}

function makeSourceRef(kind, filePath, title, hash) {
  return {
    kind,
    path: filePath,
    title: title || null,
    hash: hash || null,
    updatedAt: null,
  };
}

function buildSkillRecord(skillPath, options) {
  const skillMarkdownPath = path.join(skillPath, "SKILL.md");
  if (!isFile(skillMarkdownPath)) return null;
  const text = readSmallText(skillMarkdownPath);
  const frontmatter = parseSkillFrontmatter(text);
  const name = compactText(frontmatter.name || path.basename(skillPath), 100);
  const description = compactText(frontmatter.description || extractFirstHeading(text) || `Codex Skill at ${skillPath}`, 360);
  const sourceHash = hashFile(skillMarkdownPath);
  const sensitiveScanSkipped = collectSensitiveSkips(skillPath);

  return {
    id: stableRecordId([options.discoveredBy, name, skillMarkdownPath, sourceHash]),
    name,
    kind: "codex_skill",
    projectIds: options.projectId ? [options.projectId] : [],
    workspacePaths: options.workspacePath ? [options.workspacePath] : [],
    installPath: options.installed ? skillPath : null,
    sourcePath: skillMarkdownPath,
    summary: description,
    useCases: uniqCompact([description]),
    triggerPatterns: uniqCompact([name, frontmatter.name, description], 8),
    inputs: [],
    outputs: ["Skill instructions for Codex"],
    riskBoundaries: [
      "Candidate inventory only; human confirmation required before active use.",
      "Do not install, update, or execute automatically from discovery.",
    ],
    safeCommands: [],
    forbiddenCommands: ["automatic_install", "automatic_update", "automatic_execution", "credential_access"],
    status: "candidate",
    installed: Boolean(options.installed),
    maintainer: null,
    lastVerifiedAt: null,
    sourceHash,
    sourceRefs: [makeSourceRef("codex_skill", skillMarkdownPath, name, sourceHash)],
    requiresHumanConfirmation: true,
    discoveredBy: options.discoveredBy || "skill_dir",
    sensitiveScanSkipped,
  };
}

function scanSkillRoot(rootPath, options = {}) {
  const records = [];
  const warnings = [];
  if (!rootPath) return { records, warnings };
  if (!isDirectory(rootPath)) {
    warnings.push(`missing_root:${rootPath}`);
    return { records, warnings };
  }

  const rootRecord = buildSkillRecord(rootPath, options);
  if (rootRecord) records.push(rootRecord);

  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (error) {
    warnings.push(`scan_failed:${rootPath}:${error.message}`);
    return { records, warnings };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue;
    const record = buildSkillRecord(path.join(rootPath, entry.name), options);
    if (record) records.push(record);
  }
  return { records, warnings };
}

function inferScriptKind(filePath) {
  const baseName = path.basename(filePath).toLowerCase();
  if (/test|build|package|deploy|workflow|autoflow|openclaw|guardian/.test(baseName)) return "workflow_script";
  return "cli_tool";
}

function extractScriptSummary(text, filePath) {
  const commentLines = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /^#|^\/\/|^\/\*/.test(line))
    .map((line) => line.replace(/^#\s?/, "").replace(/^\/\/\s?/, "").replace(/^\/\*\s?/, "").replace(/\*\/$/, "").trim())
    .filter(Boolean);
  return compactText(commentLines.slice(0, 3).join(" ") || `Project script ${path.basename(filePath)}`, 320);
}

function buildScriptRecord(filePath, rootPath, options) {
  if (!isFile(filePath) || isSensitiveFile(filePath)) return null;
  if (!SCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
  const text = readSmallText(filePath);
  const sourceHash = hashFile(filePath);
  const name = compactText(path.basename(filePath), 100);
  const summary = extractScriptSummary(text, filePath);
  const relativePath = toForwardSlashes(relativeOrAbsolute(rootPath, filePath));

  return {
    id: stableRecordId([options.discoveredBy, relativePath, sourceHash]),
    name,
    kind: inferScriptKind(filePath),
    projectIds: options.projectId ? [options.projectId] : [],
    workspacePaths: options.workspacePath ? [options.workspacePath] : [],
    installPath: null,
    sourcePath: filePath,
    summary,
    useCases: uniqCompact([summary, `Review ${name} before manual use`]),
    triggerPatterns: uniqCompact([name, path.basename(filePath, path.extname(filePath)), summary], 8),
    inputs: [],
    outputs: [],
    riskBoundaries: [
      "Path and compact summary only; script is not executed by inventory discovery.",
      "Manual review or an explicit CEO task card is required before running commands.",
    ],
    safeCommands: [],
    forbiddenCommands: ["automatic_execution", "destructive_file_operation", "credential_access"],
    status: "candidate",
    installed: false,
    maintainer: null,
    lastVerifiedAt: null,
    sourceHash,
    sourceRefs: [makeSourceRef("workflow_script", filePath, name, sourceHash)],
    requiresHumanConfirmation: true,
    discoveredBy: options.discoveredBy || "project_script",
    sensitiveScanSkipped: [],
  };
}

function scanScriptRoot(rootPath, options = {}) {
  const records = [];
  const warnings = [];
  const sensitiveScanSkipped = [];
  if (!rootPath) return { records, warnings, sensitiveScanSkipped };
  if (!isDirectory(rootPath)) {
    warnings.push(`missing_root:${rootPath}`);
    return { records, warnings, sensitiveScanSkipped };
  }

  const visit = (dirPath, depth) => {
    if (depth > 2 || records.length >= MAX_SCRIPT_RECORDS_PER_ROOT) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
      warnings.push(`scan_failed:${dirPath}:${error.message}`);
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name.toLowerCase())) visit(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSensitiveFile(entryPath)) {
        sensitiveScanSkipped.push(toForwardSlashes(relativeOrAbsolute(rootPath, entryPath)));
        continue;
      }
      const record = buildScriptRecord(entryPath, rootPath, options);
      if (record) records.push(record);
    }
  };

  visit(rootPath, 0);
  return { records, warnings, sensitiveScanSkipped };
}

function dedupeRecords(records) {
  const seen = new Set();
  const result = [];
  for (const record of records) {
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    result.push(record);
  }
  return result;
}

function buildToolSkillInventory(options = {}) {
  const workspacePath = options.workspacePath || null;
  const projectId = options.projectId || null;
  const sourceRoots = [];
  const warnings = [];
  let records = [];
  let sensitiveScanSkipped = [];

  const addRoot = (kind, rootPath, exists) => {
    if (!rootPath) return;
    sourceRoots.push({ kind, path: rootPath, exists: Boolean(exists) });
  };

  const skillRoots = [
    ...((options.codexSkillRoots || []).map((rootPath) => ({ rootPath, installed: true, discoveredBy: "skill_dir" }))),
    ...((options.projectSkillRoots || []).map((rootPath) => ({ rootPath, installed: false, discoveredBy: "project_skill_dir" }))),
  ];
  for (const root of skillRoots) {
    addRoot(root.discoveredBy, root.rootPath, isDirectory(root.rootPath));
    const result = scanSkillRoot(root.rootPath, { ...root, workspacePath, projectId });
    records.push(...result.records);
    warnings.push(...result.warnings);
  }

  const scriptRoots = [
    ...((options.scriptRoots || []).map((rootPath) => ({ rootPath, discoveredBy: "project_script" }))),
    ...((options.workflowRoots || []).map((rootPath) => ({ rootPath, discoveredBy: "workflow_script" }))),
  ];
  for (const root of scriptRoots) {
    addRoot(root.discoveredBy, root.rootPath, isDirectory(root.rootPath));
    const result = scanScriptRoot(root.rootPath, { ...root, workspacePath, projectId });
    records.push(...result.records);
    warnings.push(...result.warnings);
    sensitiveScanSkipped.push(...result.sensitiveScanSkipped.map((item) => `${root.rootPath}:${item}`));
  }

  records = dedupeRecords(records);
  const inventory = {
    id: `skill-inventory-${hashText([workspacePath, projectId, sourceRoots.map((root) => root.path).join("|")].filter(Boolean).join("|")).slice(0, 16)}`,
    contractVersion: TOOL_SKILL_INVENTORY_VERSION,
    scope: workspacePath ? "project" : "global",
    workspacePath,
    projectId,
    scannedAt: options.scannedAt || new Date().toISOString(),
    indexVersion: 1,
    sourceRoots,
    recordIds: records.map((record) => record.id),
    candidateCount: records.filter((record) => record.status === "candidate").length,
    activeCount: records.filter((record) => record.status === "active").length,
    blockedCount: records.filter((record) => record.status === "blocked").length,
    warnings,
    status: warnings.some((warning) => warning.startsWith("scan_failed")) ? "partial" : "ready",
    sensitiveScanSkipped,
  };

  return { inventory, records };
}

function buildToolSkillInventoryJson(snapshot) {
  return {
    inventory: snapshot.inventory,
    records: (snapshot.records || []).map((record) => ({
      ...record,
      summary: compactText(record.summary, 360),
      useCases: uniqCompact(record.useCases || [], 10),
      riskBoundaries: uniqCompact(record.riskBoundaries || [], 10),
    })),
  };
}

function buildToolSkillInventoryMarkdown(snapshot) {
  const inventory = snapshot.inventory || {};
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const lines = [
    "# Codex Tool and Skill Inventory",
    "",
    `GeneratedAt: ${inventory.scannedAt || "unknown"}`,
    `Scope: ${inventory.scope || "unknown"}`,
    `WorkspacePath: ${inventory.workspacePath || "global"}`,
    `CandidateCount: ${inventory.candidateCount || 0}`,
    "",
    "This inventory is read-only candidate material. It never installs, enables, or executes discovered tools automatically.",
    "",
  ];
  if ((inventory.sensitiveScanSkipped || []).length) {
    lines.push("## Sensitive Files Skipped", "");
    for (const item of inventory.sensitiveScanSkipped.slice(0, 30)) lines.push(`- ${item}`);
    lines.push("");
  }
  lines.push("## Records", "");
  for (const record of records.slice(0, 80)) {
    lines.push(`### ${record.name}`);
    lines.push("");
    lines.push(`- Id: ${record.id}`);
    lines.push(`- Kind: ${record.kind}`);
    lines.push(`- Status: ${record.status}`);
    lines.push(`- Installed: ${record.installed ? "true" : "false"}`);
    lines.push(`- RequiresHumanConfirmation: ${record.requiresHumanConfirmation ? "true" : "false"}`);
    lines.push(`- SourcePath: ${record.sourcePath || "unknown"}`);
    lines.push(`- SourceHash: ${record.sourceHash || "unknown"}`);
    lines.push(`- DiscoveredBy: ${record.discoveredBy || "unknown"}`);
    lines.push(`- TriggerPatterns: ${(record.triggerPatterns || []).join(", ") || "none"}`);
    lines.push(`- RiskBoundaries: ${(record.riskBoundaries || []).join("; ") || "none"}`);
    lines.push("");
    lines.push(compactText(record.summary, 360) || "No summary.");
    lines.push("");
  }
  return lines.join("\n");
}

module.exports = {
  TOOL_SKILL_INVENTORY_VERSION,
  buildToolSkillInventory,
  buildToolSkillInventoryJson,
  buildToolSkillInventoryMarkdown,
  isSensitiveFile,
};
