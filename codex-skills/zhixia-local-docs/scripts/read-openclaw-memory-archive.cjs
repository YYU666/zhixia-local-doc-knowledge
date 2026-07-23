#!/usr/bin/env node

const {
  buildOpenClawMemoryArchiveIndex,
  queryOpenClawMemoryArchive,
  resolveDefaultVaultRoot,
} = require("./openclaw-memory-archive-index.cjs");

function parseArgs(argv) {
  const options = {
    build: false,
    query: "",
    limit: 6,
    tokenBudget: 1200,
    vaultRoot: "",
    indexPath: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--build") options.build = true;
    else if (arg === "--query") options.query = String(argv[++index] || "");
    else if (arg === "--limit") options.limit = Number(argv[++index] || 6);
    else if (arg === "--token-budget") options.tokenBudget = Number(argv[++index] || 1200);
    else if (arg === "--vault-root") options.vaultRoot = String(argv[++index] || "");
    else if (arg === "--index-path") options.indexPath = String(argv[++index] || "");
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Zhixia OpenClaw cold archive helper

Usage:
  node scripts/read-openclaw-memory-archive.cjs --build --json
  node scripts/read-openclaw-memory-archive.cjs --query "audit topic" --limit 6 --token-budget 1200 --json

The build is explicit and bounded. Query reads only the sanitized SQLite index.
OpenClaw native memory remains disabled; packets are intended for Codex/CEO Flow injection.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const common = {
    vaultRoot: options.vaultRoot || resolveDefaultVaultRoot(),
    indexPath: options.indexPath || undefined,
  };
  let result;
  if (options.build) result = buildOpenClawMemoryArchiveIndex(common);
  else if (options.query) {
    result = queryOpenClawMemoryArchive({
      ...common,
      query: options.query,
      limit: options.limit,
      tokenBudget: options.tokenBudget,
    });
  } else throw new Error("Use --build or provide --query.");

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.schemaVersion}: ${result.sourceCount ?? result.items?.length ?? 0}`);
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    schemaVersion: "zhixia.openclaw_cold_archive_error.v1",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 2;
}
