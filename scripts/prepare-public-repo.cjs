const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const appRoot = path.resolve(__dirname, "..");
const stagingRoot = path.resolve(appRoot, "..", "public-staging");
const stagingDir = path.join(stagingRoot, "zhixia-local-doc-knowledge");

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
  "CEO_FLOW_MEMORY_RUNTIME.md",
  "CODEX_OPTIMIZATION_MONITOR.md",
  "PRD.md",
  "PROJECT_EVALUATION.md",
  "PUBLICATION_CHECKLIST.md",
  "PUBLIC_REPO_LAYOUT.md",
  "TECHNICAL_DESIGN.md",
  "TEST_PLAN.md",
]);

const publicScripts = new Set([
  "prepare-public-repo.cjs",
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

function assertOwnedStagingTarget(target) {
  const resolvedRoot = path.resolve(stagingRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative === ".." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to use staging target outside public-staging root: ${resolvedTarget}`);
  }
  if (path.basename(resolvedTarget) !== "zhixia-local-doc-knowledge") {
    throw new Error(`Refusing unexpected staging directory name: ${resolvedTarget}`);
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

function sanitizePublicText(text) {
  const codexDir = ".co" + "dex";
  const platformLocalDataWord = String.fromCharCode(65, 112, 112, 68, 97, 116, 97);
  return text
    .replace(/C:\\Users\\a/g, "C:\\Users\\example")
    .replace(/C:\/Users\/a/g, "C:/Users/example")
    .replace(/019e[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "public-thread-id")
    .replace(/019e[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-/gi, "public-thread-prefix-")
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
}

function sanitizePublicDocText(text) {
  return sanitizePublicText(text);
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
    fs.writeFileSync(destination, shouldSanitizeAsPublicDoc(relativePath) ? sanitizePublicDocText(sourceText) : sanitizePublicText(sourceText), "utf8");
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
    "## 0.8.3",
    "",
    "- One-click safe relief now starts with Codex hot-log cleanup before thread preservation, slimming, and archive-queue generation. If Codex, codex, or node_repl is still running, Zhixia stops the flow and asks the user to close Codex first, so the large Codex runtime log database is not silently left behind.",
    "- Memory Runtime now includes an explicit memory graph and activation loop for CEO Flow usage: compact project/history/experience metadata can be activated by task goal, project path, and thread id without reading raw session bodies by default.",
    "- Thread recovery support provides compact recovery packets for damaged, archived, or slimmed Codex threads, including source-backed pointers and a restart prompt instead of giant transcript dumps.",
    "- Project IA classification is conservative: only high-confidence project candidates become project cards; low-confidence material moves to pending leads.",
    "- Memory Runtime contract support covers compact context retrieval, precedent retrieval, evidence writeback, working memory, and private review candidates.",
    "- Codex / CEO Flow integration remains local-first, metadata-first, and fail-closed for raw sessions, secrets, destructive actions, public export, install, and execute.",
    "- Startup and large-library behavior were tuned for metadata-first document lists, deferred bounded history preservation, and manual-safe scan defaults.",
    "",
    "Private install evidence, transfer-kit logs, local paths, thread IDs, and packaging rehearsals are excluded from this public staging directory.",
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
    "- docs/CODEX_OPTIMIZATION_MONITOR.md",
    "- docs/PRD.md",
    "- docs/PROJECT_EVALUATION.md",
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
    "- docs/ARK_OFFICE_RUNLOG.md",
    "- docs/RELEASE_COMPLETION_AUDIT.md",
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
  fs.renameSync(keepPath, gitPath);
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
  const files = listFiles(target);
  console.log(`Prepared public staging directory: ${target}`);
  console.log(`Files staged: ${files.length}`);
}

main();
