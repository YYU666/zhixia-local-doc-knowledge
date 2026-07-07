const assert = require("node:assert/strict");
const path = require("node:path");

const {
  normalizeTrustedAiProviderBaseUrl,
  resolveRegisteredWorkspacePath,
  sanitizeRendererSettingsPatch,
} = require("../electron/securityPolicy.cjs");

assert.equal(
  normalizeTrustedAiProviderBaseUrl("https://api.deepseek.com/v1/"),
  "https://api.deepseek.com/v1",
  "trusted provider URLs should normalize to HTTPS roots or /v1",
);

assert.throws(
  () => normalizeTrustedAiProviderBaseUrl("http://api.deepseek.com"),
  /HTTPS/,
  "AI provider URLs must reject plaintext HTTP",
);

assert.throws(
  () => normalizeTrustedAiProviderBaseUrl("https://attacker.example/v1"),
  /允许列表/,
  "AI provider URLs must reject untrusted hosts before forwarding document text or API keys",
);

const settingsPatch = sanitizeRendererSettingsPatch({
  aiProviderBaseUrl: "https://api.deepseek.com/v1",
  aiProviderModel: "deepseek-chat",
  aiProviderApiKey: "secret-key",
  autoWatchChanges: "truthy",
  unknownSetting: "blocked",
  projectRecordOverrides: { demo: { displayName: "Demo" } },
});

assert.deepEqual(
  settingsPatch.blockedKeys,
  ["unknownSetting"],
  "renderer settings updates should reject unknown keys",
);
assert.equal(settingsPatch.sanitized.aiProviderBaseUrl, "https://api.deepseek.com/v1");
assert.equal(settingsPatch.sanitized.aiProviderModel, "deepseek-chat");
assert.equal(settingsPatch.sanitized.aiProviderApiKey, "secret-key");
assert.equal(settingsPatch.sanitized.autoWatchChanges, false, "boolean settings should be normalized, not stored as arbitrary strings");
assert.deepEqual(settingsPatch.sanitized.projectRecordOverrides, { demo: { displayName: "Demo" } });

const workspace = path.resolve("C:/Users/example/Documents/project-a");
assert.equal(
  resolveRegisteredWorkspacePath(workspace, [workspace]),
  workspace,
  "registered workspace paths should pass unchanged after normalization",
);
assert.throws(
  () => resolveRegisteredWorkspacePath("C:/Users/example/Documents/project-b", [workspace]),
  /白名单/,
  "renderer-controlled projectPath values must stay inside the registered workspace set",
);

console.log("security-policy tests passed");
