const fs = require("node:fs");
const path = require("node:path");

const RELEASE_CORPUS_SCHEMA = "zhixia.memory_release_corpus.v1";
const RELEASE_CORPUS_ID = "zhixia-memory-release-corpus-20260813-v1";
const RELEASE_CORPUS_PATH = path.join(__dirname, "memory-release-corpus.v1.json");

function buildMemoryReleaseCorpus() {
  const corpus = JSON.parse(fs.readFileSync(RELEASE_CORPUS_PATH, "utf8"));
  if (corpus.schemaVersion !== RELEASE_CORPUS_SCHEMA) throw new Error("memory_release_static_corpus_schema_invalid");
  if (corpus.corpusId !== RELEASE_CORPUS_ID) throw new Error("memory_release_static_corpus_id_invalid");
  if (!Array.isArray(corpus.cases) || corpus.cases.length !== 120) throw new Error("memory_release_static_corpus_case_count_invalid");
  return corpus;
}

module.exports = {
  RELEASE_CORPUS_ID,
  RELEASE_CORPUS_PATH,
  RELEASE_CORPUS_SCHEMA,
  buildMemoryReleaseCorpus,
};
