const { inspectSkillReleaseParity } = require("../electron/skillReleaseManifest.cjs");

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

try {
  const receipt = inspectSkillReleaseParity(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.verified) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
}
