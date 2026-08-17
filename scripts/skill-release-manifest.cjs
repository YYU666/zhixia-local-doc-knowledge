const releaseManifest = require("../electron/skillReleaseManifest.cjs");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--repo", "--bundled", "--installed", "--rollback"].includes(argument)) {
      throw new Error(`skill_release_argument_invalid:${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`skill_release_argument_value_missing:${argument}`);
    options[`${argument.slice(2)}Path`] = value;
    index += 1;
  }
  return options;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "generate") {
    const options = parseArgs(args.slice(1));
    if (!options.repoPath || options.bundledPath || options.installedPath || options.rollbackPath) {
      throw new Error("usage: generate --repo <repo-skill-root>");
    }
    const result = releaseManifest.writeSkillReleaseManifest(options.repoPath);
    process.stdout.write(`${JSON.stringify({
      manifestPath: result.target,
      manifestSha256: result.manifestSha256,
      releaseGeneration: result.manifest.releaseGeneration,
      entryCount: result.manifest.entryCount,
    })}\n`);
    return;
  }
  if (args[0] === "verify") {
    const receipt = releaseManifest.inspectSkillReleaseParity(parseArgs(args.slice(1)));
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (!receipt.verified) process.exitCode = 1;
    return;
  }
  throw new Error("usage: <generate|verify> --repo <repo-skill-root> [--bundled <root>] [--installed <root>] [--rollback <root>]");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = releaseManifest;
