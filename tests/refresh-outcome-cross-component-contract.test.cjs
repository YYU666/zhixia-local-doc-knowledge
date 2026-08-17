const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  acceptedPathDigest,
  buildQueryBasis,
  buildRefreshKey,
} = require("../electron/completedRefreshOutcomeStore.cjs");

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "refresh-outcome-v2-contract.json"),
  "utf8",
));

assert.equal(fixture.schemaVersion, "zhixia.refresh_outcome_cross_component_fixture.v1");
assert.equal(acceptedPathDigest(fixture.request.acceptedChangedPaths), fixture.acceptedPathDigest);
assert.equal(buildQueryBasis(fixture.request).acceptedPathDigest, fixture.acceptedPathDigest);
assert.equal(buildRefreshKey(buildQueryBasis(fixture.request)), fixture.refreshKey);

console.log("Zhixia refresh outcome v2 cross-component fixture passed.");
