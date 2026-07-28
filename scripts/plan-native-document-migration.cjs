const path = require("node:path");
const { executeNativeDocumentMigration } = require("../electron/nativeDocumentSidecarMigration.cjs");

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function main() {
  try {
    const argv = process.argv.slice(2);
    const source = valueAfter(argv, "--source");
    const output = valueAfter(argv, "--out");
    if (!source || !output) throw new Error("usage: --source <sqlite> --out <migration-dir> [--execute]");
    const result = executeNativeDocumentMigration(path.resolve(source), path.resolve(output), { execute: argv.includes("--execute") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

main();
