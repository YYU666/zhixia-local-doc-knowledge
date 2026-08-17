const fs = require("node:fs");
const path = require("node:path");

function resolveElectronExecutable(root, platform = process.platform) {
  const distRoot = path.join(root, "node_modules", "electron", "dist");
  const executable = platform === "win32"
    ? path.join(distRoot, "electron.exe")
    : platform === "darwin"
      ? path.join(distRoot, "Electron.app", "Contents", "MacOS", "Electron")
      : path.join(distRoot, "electron");
  if (!fs.existsSync(executable)) throw new Error(`electron_test_executable_missing:${platform}:${executable}`);
  return executable;
}

module.exports = { resolveElectronExecutable };
