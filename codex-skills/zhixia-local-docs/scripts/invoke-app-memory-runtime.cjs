#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAX_REQUEST_BYTES = 128 * 1024;

function readRequest(argv = process.argv.slice(2)) {
  const index = argv.indexOf("--request-json");
  const raw = index >= 0 ? String(argv[index + 1] || "") : fs.readFileSync(0, "utf8");
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new Error("request_json_missing_or_too_large");
  const request = JSON.parse(raw);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("request_json_object_required");
  return { raw: JSON.stringify(request), request };
}

function sourceCandidates(env = process.env) {
  const explicit = env.ZHIXIA_MEMORY_RUNTIME_CLI ? [path.resolve(env.ZHIXIA_MEMORY_RUNTIME_CLI)] : [];
  const appRoot = env.ZHIXIA_APP_ROOT ? [path.join(path.resolve(env.ZHIXIA_APP_ROOT), "electron", "memoryRuntimeCli.cjs")] : [];
  return [...new Set([
    ...explicit,
    ...appRoot,
    path.resolve(__dirname, "..", "..", "..", "electron", "memoryRuntimeCli.cjs"),
    path.resolve(process.cwd(), "electron", "memoryRuntimeCli.cjs"),
    path.join(os.homedir(), "Documents", "Zhixia-Local-Doc-Knowledge", "app", "electron", "memoryRuntimeCli.cjs"),
  ])];
}

function packagedCandidates(env = process.env) {
  const candidates = [];
  if (process.platform === "win32") {
    const localPrograms = path.join(env.LOCALAPPDATA || path.join(os.homedir(), ["App", "Data"].join(""), "Local"), "Programs");
    for (const folder of ["local-doc-knowledge", "知匣 Local Doc Knowledge"]) {
      const root = path.join(localPrograms, folder);
      candidates.push({
        executable: path.join(root, "知匣 Local Doc Knowledge.exe"),
        asar: path.join(root, "resources", "app.asar"),
      });
    }
  } else if (process.platform === "darwin") {
    for (const applications of [path.join(os.homedir(), "Applications"), "/Applications"]) {
      for (const appName of ["知匣.app", "知匣 Local Doc Knowledge.app"]) {
        const root = path.join(applications, appName, "Contents");
        const executableName = appName === "知匣.app" ? "知匣" : "知匣 Local Doc Knowledge";
        candidates.push({
          executable: path.join(root, "MacOS", executableName),
          asar: path.join(root, "Resources", "app.asar"),
        });
      }
    }
  }
  return candidates;
}

function run(command, args, raw, env) {
  return spawnSync(command, args, {
    input: raw,
    encoding: "utf8",
    env,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

function validStrictJson(stdout) {
  if (!stdout?.trim()) return false;
  try {
    const value = JSON.parse(stdout);
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  } catch {
    return false;
  }
}

function invoke(raw, env = process.env) {
  const diagnostics = [];
  for (const cliPath of sourceCandidates(env)) {
    if (!fs.existsSync(cliPath) || !fs.statSync(cliPath).isFile()) continue;
    const result = run(process.execPath, [cliPath], raw, env);
    if (result.status === 0 && validStrictJson(result.stdout)) return result.stdout.trim();
    diagnostics.push({ route: "source", path: cliPath, status: result.status, error: String(result.stderr || result.error?.message || "invalid_json").slice(0, 500) });
  }
  for (const candidate of packagedCandidates(env)) {
    if (!fs.existsSync(candidate.executable) || !fs.existsSync(candidate.asar)) continue;
    const cliPath = path.join(candidate.asar, "electron", "memoryRuntimeCli.cjs");
    const result = run(candidate.executable, [cliPath], raw, { ...env, ELECTRON_RUN_AS_NODE: "1" });
    if (result.status === 0 && validStrictJson(result.stdout)) return result.stdout.trim();
    diagnostics.push({ route: "packaged", path: candidate.asar, status: result.status, error: String(result.stderr || result.error?.message || "invalid_json").slice(0, 500) });
  }
  const error = new Error("verified_app_owned_memory_runtime_cli_unavailable");
  error.diagnostics = diagnostics;
  throw error;
}

function main() {
  try {
    const { raw } = readRequest();
    process.stdout.write(`${invoke(raw)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: error.message || String(error),
      diagnostics: Array.isArray(error.diagnostics) ? error.diagnostics : [],
      fallback: "Use read-project-knowledge.cjs only as fallback_stale advisory context.",
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { invoke, packagedCandidates, sourceCandidates };
