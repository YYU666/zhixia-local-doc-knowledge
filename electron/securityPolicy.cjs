const path = require("node:path");

const MASKED_SETTING_VALUE = "••••••••";
const DEFAULT_AI_PROVIDER_BASE_URL = "https://api.deepseek.com";
const DEFAULT_ALLOWED_AI_PROVIDER_HOSTS = new Set([
  "api.deepseek.com",
]);

const RENDERER_SETTINGS_UPDATE_SCHEMA = {
  autoDetectChanges: "boolean",
  autoWatchChanges: "boolean",
  autoInstallSkill: "boolean",
  maxFileSizeMb: "number",
  aiProviderApiKey: "sensitive_string",
  aiProviderModel: "string",
  aiProviderBaseUrl: "trusted_ai_base_url",
  autoflowWorkflowPath: "string",
  bugFixMemoryPath: "string",
  projectResumeConfirmations: "object",
  projectArtifactConfirmations: "object",
  projectRecordOverrides: "object",
  toolSkillInventoryConfirmations: "object",
};

function compactPolicyText(value, maxChars = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function normalizeTrustedAiProviderBaseUrl(baseUrl, options = {}) {
  const raw = String(baseUrl || "").trim().replace(/\/+$/, "") || DEFAULT_AI_PROVIDER_BASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("AI Provider Base URL 必须是有效的 HTTPS 地址。");
  }
  if (url.protocol !== "https:") {
    throw new Error("AI Provider Base URL 只允许 HTTPS，已拦截非加密或本地地址。");
  }
  if (url.username || url.password) {
    throw new Error("AI Provider Base URL 不允许包含用户名或密码。");
  }
  const allowedHosts = new Set([
    ...DEFAULT_ALLOWED_AI_PROVIDER_HOSTS,
    ...String(options.allowedHosts || process.env.ZHIXIA_ALLOWED_AI_PROVIDER_HOSTS || "")
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  ]);
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`AI Provider Base URL host 未在允许列表中：${url.hostname}`);
  }
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  const allowedPaths = new Set(["", "/", "/v1", "/v1/chat/completions", "/chat/completions"]);
  if (!allowedPaths.has(normalizedPath || "")) {
    throw new Error("AI Provider Base URL 只能指向 provider 根路径、/v1 或 chat/completions。");
  }
  url.hash = "";
  url.search = "";
  url.pathname = normalizedPath || "";
  return url.toString().replace(/\/+$/, "");
}

function sanitizeRendererSettingsPatch(patch = {}) {
  const sanitized = {};
  const ignoredKeys = [];
  const blockedKeys = [];
  for (const [key, value] of Object.entries(patch || {})) {
    const kind = RENDERER_SETTINGS_UPDATE_SCHEMA[key];
    if (!kind) {
      blockedKeys.push(key);
      continue;
    }
    if (kind === "sensitive_string") {
      if (value === MASKED_SETTING_VALUE) {
        ignoredKeys.push(key);
        continue;
      }
      sanitized[key] = compactPolicyText(value, 4000);
      continue;
    }
    if (kind === "trusted_ai_base_url") {
      sanitized[key] = normalizeTrustedAiProviderBaseUrl(value);
      continue;
    }
    if (kind === "boolean") {
      sanitized[key] = value === true;
      continue;
    }
    if (kind === "number") {
      const next = Number(value);
      if (!Number.isFinite(next)) {
        blockedKeys.push(key);
        continue;
      }
      sanitized[key] = next;
      continue;
    }
    if (kind === "string") {
      sanitized[key] = compactPolicyText(value, 2000);
      continue;
    }
    if (kind === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        blockedKeys.push(key);
        continue;
      }
      sanitized[key] = value;
    }
  }
  return {
    sanitized,
    ignoredKeys,
    blockedKeys,
  };
}

function isDestructiveGuardianConfirmation(value = {}) {
  return value.userConfirmed === true || value.confirmed === true || value.confirmDestructiveGuardianAction === true;
}

function resolveRegisteredWorkspacePath(inputPath, registeredPaths = []) {
  const raw = String(inputPath || "").trim();
  if (!raw) throw new Error("缺少 projectPath。");
  const resolved = path.resolve(raw);
  const allowed = registeredPaths
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  if (!allowed.includes(resolved)) {
    throw new Error("projectPath 未在已导入/已扫描项目白名单内，请先通过知匣导入或扫描该项目。");
  }
  return resolved;
}

function buildRendererCsp(devServerUrl = "") {
  const isDev = Boolean(devServerUrl);
  const devConnect = isDev ? " http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*" : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "img-src 'self' data: file:",
    "font-src 'self' data:",
    `connect-src 'self'${devConnect}`,
    `script-src 'self'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");
}

module.exports = {
  DEFAULT_AI_PROVIDER_BASE_URL,
  MASKED_SETTING_VALUE,
  buildRendererCsp,
  isDestructiveGuardianConfirmation,
  normalizeTrustedAiProviderBaseUrl,
  resolveRegisteredWorkspacePath,
  sanitizeRendererSettingsPatch,
};
