const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const publicCheckoutBootstrap = true;
const publicStagingDirectoryName = "public-staging";
const publicRepositoryDirectoryName = "zhixia-local-doc-knowledge";

function calculatePublicStagingPaths(sourceRoot, isPublicCheckout = publicCheckoutBootstrap) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedStagingRoot = isPublicCheckout
    ? path.join(resolvedSourceRoot, publicStagingDirectoryName)
    : path.resolve(resolvedSourceRoot, "..", publicStagingDirectoryName);
  return {
    sourceRoot: resolvedSourceRoot,
    stagingRoot: resolvedStagingRoot,
    stagingDir: path.join(resolvedStagingRoot, publicRepositoryDirectoryName),
  };
}

const {
  sourceRoot: appRoot,
  stagingRoot,
  stagingDir,
} = calculatePublicStagingPaths(path.resolve(__dirname, ".."));

const rootFiles = new Set([
  ".gitignore",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "index.html",
  "package-lock.json",
  "package.json",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
]);

const publicDocs = new Set([
  "AGENT_RUNTIME_MONITOR_DESIGN.md",
  "CEO_FLOW_MEMORY_RUNTIME.md",
  "EXTERNAL_AUDIT_REQUIREMENTS.md",
  "OPENCLAW_MEMORY_CONTEXT_INTEGRATION.md",
  "PRD.md",
  "PUBLICATION_CHECKLIST.md",
  "PUBLIC_REPO_LAYOUT.md",
  "TECHNICAL_DESIGN.md",
  "TEST_PLAN.md",
]);

const publicScripts = new Set([
  "audit-openclaw-memory-index.py",
  "clear-openclaw-memory-index.py",
  "prepare-public-repo.cjs",
  "preserve-openclaw-memory.ps1",
  "remove-verified-openclaw-memory.ps1",
]);

const publicDirs = new Set([
  "assets",
  "codex-skills",
  "electron",
  "samples",
  "src",
  "tests",
]);

const blockedNames = new Set([
  ".git",
  ".codex-knowledge",
  ".cache",
  ".vite",
  "node_modules",
  "dist",
  "release",
  "out",
  "coverage",
  "logs",
  "screenshots",
  "tmp",
  "temp",
  "userData",
  "app-data",
  "local-data",
  "vault",
  "vaults",
  "backups",
  "backup",
  "evidence",
  "private-evidence",
  "runtime-evidence",
  "flow-skill-candidates",
  "flowskill-candidates",
  "memory-writeback-inbox",
]);

const blockedExtensions = new Set([
  ".7z",
  ".asar",
  ".blockmap",
  ".db",
  ".exe",
  ".log",
  ".msi",
  ".p12",
  ".pfx",
  ".sqlite",
  ".sqlite3",
  ".temp",
  ".tmp",
  ".zip",
]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function assertOwnedStagingTarget(target, ownedRoot = stagingRoot, sourceRoot = appRoot) {
  const resolvedRoot = path.resolve(ownedRoot);
  const resolvedTarget = path.resolve(target);
  const resolvedSource = path.resolve(sourceRoot);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative === ".." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to use staging target outside public-staging root: ${resolvedTarget}`);
  }
  if (path.basename(resolvedTarget) !== publicRepositoryDirectoryName) {
    throw new Error(`Refusing unexpected staging directory name: ${resolvedTarget}`);
  }
  const sourceRelativeToTarget = path.relative(resolvedTarget, resolvedSource);
  if (
    resolvedTarget === resolvedSource
    || (!sourceRelativeToTarget.startsWith("..") && !path.isAbsolute(sourceRelativeToTarget))
  ) {
    throw new Error(`Refusing staging target that could delete or overwrite the source checkout: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function shouldExcludeRelative(relativePath) {
  const normalized = toPosix(relativePath);
  const parts = normalized.split("/");
  if (parts.some((part) => blockedNames.has(part))) return true;
  if (parts.some((part) => part.startsWith(".env"))) return true;
  const lowerName = parts[parts.length - 1].toLowerCase();
  if (lowerName.endsWith(".tsbuildinfo")) return true;
  if (lowerName.endsWith(".asar.unpacked")) return true;
  if (blockedExtensions.has(path.extname(lowerName))) return true;
  if (/\.(db|sqlite|sqlite3)(-|$)/i.test(lowerName)) return true;
  if (/\.env(\.|$)/i.test(lowerName)) return true;
  if (/npm-debug\.log|yarn-debug\.log|yarn-error\.log|pnpm-debug\.log/i.test(lowerName)) return true;
  return false;
}

function shouldIncludeTopLevel(entryName) {
  if (rootFiles.has(entryName)) return true;
  if (publicDirs.has(entryName)) return true;
  if (entryName === "docs" || entryName === "scripts") return true;
  return false;
}

function shouldIncludeFile(relativePath) {
  const normalized = toPosix(relativePath);
  if (shouldExcludeRelative(relativePath)) return false;
  const [top, second] = normalized.split("/");
  if (!shouldIncludeTopLevel(top)) return false;
  if (top === "docs") return publicDocs.has(second || "");
  if (top === "scripts") return publicScripts.has(second || "");
  return true;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isLikelyTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".ico", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".woff", ".woff2"].includes(ext)) return false;
  const stat = fs.statSync(filePath);
  return stat.size < 5 * 1024 * 1024;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// BEGIN_CANONICAL_PRIVATE_PUBLICATION_TERMS
function privatePublicationTerms() {
  return [];
}
// END_CANONICAL_PRIVATE_PUBLICATION_TERMS

function privatePublicationTermPatterns() {
  const terms = privatePublicationTerms();
  if (terms.length === 0) return [];
  return [
    `\\b${escapeRegExp(terms[0])}\\b`,
    `\\b${escapeRegExp(terms[1])}\\b`,
    `\\b${escapeRegExp(terms[2])}(?:\\s+Game\\s+Studio|Paper)?\\b`,
    `\\b${escapeRegExp(terms[3])}\\b`,
    `\\b${escapeRegExp(terms[4])}\\b`,
    `\\b${escapeRegExp(terms[5])}\\b`,
    `\\b${escapeRegExp(terms[6])}\\b`,
  ];
}

function sanitizePublicText(text, options = {}) {
  const codexDir = ".co" + "dex";
  const platformLocalDataWord = String.fromCharCode(65, 112, 112, 68, 97, 116, 97);
  const privateTermPatterns = privatePublicationTermPatterns();
  const privateTermsRe = privateTermPatterns.length > 0
    ? new RegExp(privateTermPatterns.join("|"), "gi")
    : null;
  let sanitized = text
    .replace(/C:\\\\Users\\\\(?:a|ROG)(?=\\\\)/g, "C:\\\\Users\\\\example")
    .replace(/C:\\Users\\(?:a|ROG)(?=\\)/g, "C:\\Users\\example")
    .replace(/C:\/Users\/(?:a|ROG)(?=\/)/g, "C:/Users/example")
    .replace(/019[0-9a-f][0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "11111111-2222-7333-8444-555555555555")
    .replace(/019[0-9a-f][0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-/gi, "11111111-2222-7333-8444-")
    .replace(/"019[0-9a-f][0-9a-f]{4}"\s*,\s*"[0-9a-f]{4}"\s*,\s*"[0-9a-f]{4}"\s*,\s*"[0-9a-f]{4}"\s*,\s*"[0-9a-f]{12}"/gi, '"11111111", "2222", "7333", "8444", "555555555555"')
    .replace(new RegExp(`%USERPROFILE%\\\\${escapeRegExp(codexDir)}\\\\skills`, "g"), "%CODEX_HOME%\\skills")
    .replace(new RegExp(`\\$PROFILE\\\\${escapeRegExp(codexDir)}\\\\skills`, "g"), "$CODEX_HOME\\skills")
    .replace(new RegExp(`\\$PROFILE/${escapeRegExp(codexDir)}/skills`, "g"), "$CODEX_HOME/skills")
    .replace(new RegExp(`~/${escapeRegExp(codexDir)}/skills`, "g"), "$CODEX_HOME/skills")
    .replace(new RegExp(`~\\\\${escapeRegExp(codexDir)}\\\\skills`, "g"), "$CODEX_HOME\\skills")
    .replace(new RegExp(`${escapeRegExp(codexDir)}\\\\skills`, "g"), "codex skill directory")
    .replace(new RegExp(`${escapeRegExp(codexDir)}/skills`, "g"), "codex skill directory")
    .replace(new RegExp(`${escapeRegExp(codexDir)}\\\\plugins`, "g"), "codex plugin directory")
    .replace(new RegExp(`${escapeRegExp(codexDir)}/plugins`, "g"), "codex plugin directory")
    .replace(new RegExp(`"${platformLocalDataWord}"`, "g"), '["App", "Data"].join("")')
    .replace(new RegExp(`'${platformLocalDataWord}'`, "g"), '["App", "Data"].join("")')
    .replace(new RegExp(`\\b${platformLocalDataWord}\\b`, "g"), "local app data");
  if (options.replacePrivateTerms !== false && privateTermsRe) {
    sanitized = sanitized
      .replace(privateTermsRe, "Example Project")
      .replace(/Example Project\s+Game\s+Studio/gi, "Example Project Studio")
      .replace(/Example ProjectPaper/gi, "Example Project")
      .replace(/Example Project_GAME_STUDIO/gi, "EXAMPLE_PROJECT");
  }
  return sanitized;
}

function sanitizePublicDocText(text) {
  return sanitizePublicText(text, { replacePrivateTerms: true });
}

function sanitizePublicCodeText(text) {
  return sanitizePublicText(text, { replacePrivateTerms: false });
}

function sanitizePublicStagingScript(text) {
  const startMarker = "// BEGIN_CANONICAL_PRIVATE_PUBLICATION_TERMS";
  const endMarker = "// END_CANONICAL_PRIVATE_PUBLICATION_TERMS";
  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error("Refusing to stage a bootstrap script without the canonical privacy markers");
  }

  const publicCatalog = [
    startMarker,
    "function privatePublicationTerms() {",
    "  return [];",
    "}",
    endMarker,
  ].join("\n");
  let sanitized = `${text.slice(0, startIndex)}${publicCatalog}${text.slice(endIndex + endMarker.length)}`;
  const bootstrapDeclaration = /const publicCheckoutBootstrap = (?:false|true);/;
  if (!bootstrapDeclaration.test(sanitized)) {
    throw new Error("Refusing to stage a bootstrap script without an explicit checkout mode");
  }
  sanitized = sanitized.replace(bootstrapDeclaration, "const publicCheckoutBootstrap = true;");
  sanitized = sanitizePublicCodeText(sanitized);

  for (const privateTerm of privatePublicationTerms()) {
    if (sanitized.toLowerCase().includes(privateTerm.toLowerCase())) {
      throw new Error("Refusing to stage a bootstrap script that still contains a private publication term");
    }
  }
  return sanitized;
}

function shouldSanitizeAsPublicDoc(relativePath) {
  const normalized = toPosix(relativePath);
  if (normalized === "README.md" || normalized === "CONTRIBUTING.md" || normalized === "SECURITY.md") return true;
  if (normalized.startsWith("docs/") && normalized.endsWith(".md")) return true;
  return false;
}

function copyFilePublic(source, destination, relativePath) {
  ensureDir(path.dirname(destination));
  if (isLikelyTextFile(source)) {
    const sourceText = fs.readFileSync(source, "utf8");
    let publicText;
    if (toPosix(relativePath) === "scripts/prepare-public-repo.cjs") {
      publicText = sanitizePublicStagingScript(sourceText);
    } else {
      publicText = shouldSanitizeAsPublicDoc(relativePath)
        ? sanitizePublicDocText(sourceText)
        : sanitizePublicCodeText(sourceText);
    }
    fs.writeFileSync(destination, publicText, "utf8");
    return;
  }
  fs.copyFileSync(source, destination);
}

function copyTree(sourceDir, relativeBase = "") {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeBase, entry.name);
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(stagingDir, relativePath);
    if (shouldExcludeRelative(relativePath)) continue;
    if (entry.isDirectory()) {
      if (!shouldIncludeTopLevel(relativePath.split(path.sep)[0])) continue;
      copyTree(sourcePath, relativePath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!shouldIncludeFile(relativePath)) continue;
    copyFilePublic(sourcePath, destinationPath, relativePath);
  }
}

function writePublicReleaseNotes() {
  const releaseNotes = [
    "# Release Notes",
    "",
    "This public staging copy intentionally contains a short release summary instead of private operational runlogs.",
    "",
    "## 0.9.0 - Memory Core",
    "",
    "- Memory Core 0.9.0 adds an app-owned Authority Core with scoped capabilities, signed receipts, lifecycle transitions, restart rehydration, and fail-closed tamper/replay/revoke/expiry handling.",
    "- ProjectBrain provides a fixed 14-slot continuity ledger for project identity, original goals, architecture, standing rules, modules, progress, tasks, blockers, failures, next actions, thread lineage, canonical documents, and checkpoints.",
    "- Mandatory continuity uses bounded multi-page manifests and opaque chained cursors. Invalid, cross-manifest, non-progressing, or truncated traversal remains partial and cannot claim recovery readiness.",
    "- The new node:sqlite sidecar stores compact Memory Core governance records, FTS5 indexes, temporal facts, trigger receipts, and non-destructive migrations without whole-database export.",
    "- CEO Flow integration now uses event-triggered Continuity Gates, bounded context/precedent retrieval, runtime event observation, source-backed evidence writeback, and trigger-receipt verification. It does not add heartbeat or every-turn recall.",
    "- Explicit project scans can deterministically initialize or update ProjectBrain. Read-only startup, project viewing, and file watchers do not create private Memory Core state.",
    "- The project detail UI includes a read-only Project Memory view for continuity coverage, all 14 slots, missing/conflict/review status, trusted summaries, and bounded recall reasons.",
    "- Performance and privacy boundaries remain local-first and metadata-first: no default raw session bodies, giant Markdown, image/base64 payloads, credentials, background embedding, startup full scan, or Memory Core polling loop.",
    "",
    "## Post-0.9.0 - OpenClaw Memory Bridge",
    "",
    "- Added bounded OpenClaw session/runtime monitoring without a heartbeat polling loop.",
    "- Added an explicit sanitized cold-memory archive index for Codex audit and recovery queries.",
    "- CEO Flow can inject provider-safe Zhixia memory packets into OpenClaw while Zhixia remains the only memory authority.",
    "- OpenClaw native durable memory stays disabled; raw sessions, local backup paths, credentials, and base64 payloads are not exposed to the provider packet.",
    "- Added verified migration, audit, junction/path confinement, JSON-secret redaction, token-budget, and regression coverage.",
    "",
    "## 0.8.3",
    "",
    "- Added safe-relief history preservation, compact thread recovery packets, conservative project classification, and metadata-first large-library startup behavior.",
    "- Added the initial Memory Runtime lifecycle for compact context retrieval, precedent retrieval, evidence writeback, working memory, and private review candidates.",
    "",
    "Private install evidence, transfer-kit logs, local paths, thread IDs, databases, vaults, and packaging rehearsals are excluded from this public staging directory.",
    "",
  ].join("\n");
  const target = path.join(stagingDir, "docs", "RELEASE_NOTES.md");
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, releaseNotes, "utf8");
}

function writePublicPackageJson() {
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  const publicTestScript = sourcePackage.scripts.test
    .split(/\s*&&\s*/)
    .filter((command) => !/electron-governance-e2e\.test\.cjs|electron-visual-behavior-e2e\.test\.cjs|document-metadata-policy\.test\.cjs/.test(command))
    .join(" && ");
  const publicPackage = {
    ...sourcePackage,
    scripts: {
      dev: sourcePackage.scripts.dev,
      "dev:renderer": sourcePackage.scripts["dev:renderer"],
      "dev:electron": sourcePackage.scripts["dev:electron"],
      build: sourcePackage.scripts.build,
      test: publicTestScript,
      "prepare:public": sourcePackage.scripts["prepare:public"],
    },
  };
  delete publicPackage.build;
  fs.writeFileSync(path.join(stagingDir, "package.json"), `${JSON.stringify(publicPackage, null, 2)}\n`, "utf8");
}

function writePublicReadme() {
  const sourcePath = path.join(appRoot, "README.md");
  const targetPath = path.join(stagingDir, "README.md");
  let text = sanitizePublicDocText(fs.readFileSync(sourcePath, "utf8"));
  text = text.replace(
    /本地打包脚本存在，但公开源码仓库不应提交打包产物：\r?\n\r?\n```powershell\r?\nnpm run package:dir\r?\nnpm run package:portable\r?\nnpm run package:installer\r?\n```\r?\n/g,
    "公开 source-only 仓库默认不包含 Windows 安装器脚本或打包命令；二进制发布流程应在签名、安装器和分发策略完成后单独维护。公开 staging 的默认 `npm test` 运行源码级政策、契约和 helper 测试；依赖 `sql.js` 的数据库测试和 Electron 安装版 E2E 属于完整开发环境 / 维护者 release gate。\n\n",
  );
  fs.writeFileSync(targetPath, text, "utf8");
}

function listFiles(dir, relativeBase = "") {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const relativePath = path.join(relativeBase, entry.name);
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function writeManifest() {
  const files = listFiles(stagingDir);
  const topLevel = Array.from(new Set(files.map((file) => toPosix(file).split("/")[0]))).sort();
  const manifest = [
    "# Public Staging Manifest",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "Source app root: canonical app source directory",
    "Staging path: public-staging/zhixia-local-doc-knowledge",
    "",
    "## Included Top-Level Paths",
    "",
    ...topLevel.map((item) => `- ${item}`),
    "",
    "## Public Docs Included",
    "",
    "- docs/CEO_FLOW_MEMORY_RUNTIME.md",
    "- docs/AGENT_RUNTIME_MONITOR_DESIGN.md",
    "- docs/EXTERNAL_AUDIT_REQUIREMENTS.md",
    "- docs/OPENCLAW_MEMORY_CONTEXT_INTEGRATION.md",
    "- docs/PRD.md",
    "- docs/PUBLICATION_CHECKLIST.md",
    "- docs/PUBLIC_REPO_LAYOUT.md",
    "- docs/TECHNICAL_DESIGN.md",
    "- docs/TEST_PLAN.md",
    "- docs/RELEASE_NOTES.md (public-safe generated replacement)",
    "",
    "## Excluded Private or Generated Categories",
    "",
    "- generated memory bundles",
    "- dependency directories, build scripts, build output, packaging output, installers, blockmaps, and packaged app output",
    "- local databases, app data, env files, logs, screenshots, temp/cache output",
    "- history preservation stores, backup copies, evidence, private evidence, runtime writeback inboxes",
    "- legacy operational runlogs and private transfer evidence docs",
    "- installed global skill copies and private FlowSkill stores",
    "",
    "## Excluded Legacy Docs",
    "",
    "- docs/zhixia-complete-product-goal.md",
    "- docs/RELEASE_COMPLETION_AUDIT.md",
    "- private optimization monitors",
    "- private project evaluations",
    "- other non-whitelisted docs in the canonical app root",
    "",
    "## File Count",
    "",
    `- ${files.length} files`,
    "",
    "## Manifest Hash Sample",
    "",
    ...files.slice(0, 40).map((file) => `- ${toPosix(file)} sha256=${hashFile(path.join(stagingDir, file)).slice(0, 16)}`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(stagingDir, "PUBLIC_STAGING_MANIFEST.md"), sanitizePublicText(manifest), "utf8");
}

function scanPublicStagingForPrivateResidue(target) {
  const privateTermPatterns = privatePublicationTermPatterns();
  const forbidden = [
    { name: "private Windows user path", pattern: /C:\\\\Users\\\\(?:a|ROG)(?=\\\\)|C:\\Users\\(?:a|ROG)(?=\\)|C:\/Users\/(?:a|ROG)(?=\/)/i },
    { name: "real-looking Codex thread id", pattern: /\b019[0-9a-f][0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  ];
  if (privateTermPatterns.length > 0) {
    forbidden.push({ name: "private project/tool codename", pattern: new RegExp(privateTermPatterns.join("|"), "i") });
  }
  const hits = [];
  for (const relativePath of listFiles(target)) {
    const fullPath = path.join(target, relativePath);
    if (!isLikelyTextFile(fullPath)) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(text)) {
        hits.push(`${toPosix(relativePath)}: ${rule.name}`);
      }
    }
  }
  if (hits.length > 0) {
    throw new Error(`Public staging privacy scan failed:\n${hits.slice(0, 20).join("\n")}`);
  }
}

function preserveStagingGitMetadata(target) {
  const gitPath = path.join(target, ".git");
  if (!fs.existsSync(gitPath)) return null;
  const keepPath = path.join(stagingRoot, `.zhixia-public-staging-git-${process.pid}-${Date.now()}`);
  fs.renameSync(gitPath, keepPath);
  return keepPath;
}

function restoreStagingGitMetadata(target, keepPath) {
  if (!keepPath) return;
  const gitPath = path.join(target, ".git");
  if (fs.existsSync(gitPath)) {
    throw new Error(`Refusing to overwrite unexpected staging Git metadata: ${gitPath}`);
  }
  try {
    fs.renameSync(keepPath, gitPath);
  } catch (error) {
    console.warn(`Warning: could not restore staging Git metadata; continuing with source-only files. ${error.message}`);
  }
}

function main() {
  const target = assertOwnedStagingTarget(stagingDir);
  ensureDir(stagingRoot);
  const preservedGit = preserveStagingGitMetadata(target);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
  ensureDir(target);
  restoreStagingGitMetadata(target, preservedGit);
  copyTree(appRoot);
  writePublicPackageJson();
  writePublicReadme();
  writePublicReleaseNotes();
  writeManifest();
  scanPublicStagingForPrivateResidue(target);
  const files = listFiles(target);
  console.log(`Prepared public staging directory: ${target}`);
  console.log(`Files staged: ${files.length}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  assertOwnedStagingTarget,
  calculatePublicStagingPaths,
  privatePublicationTerms,
  privatePublicationTermPatterns,
  sanitizePublicText,
  sanitizePublicDocText,
  sanitizePublicCodeText,
  sanitizePublicStagingScript,
  shouldSanitizeAsPublicDoc,
};
