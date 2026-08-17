const assert = require("node:assert/strict");
const { authorityLifecycleReview } = require("../electron/memoryAuthorityLifecycleAdapter.cjs");

const hash = "a".repeat(64);
const scan = {
  workspace: "/fixture/project",
  scanSha256: "b".repeat(64),
  projectIdentity: { projectId: "project-123", projectIdentitySha256: "c".repeat(64) },
  files: [{ relativePath: "src/a.js", sha256: hash, sizeBytes: 12 }],
  workingTree: { entries: [] },
};
const verify = {
  memoryMode: "app_owned_memory_core",
  authorityVerification: "app_owned_verified",
  current: false,
  recoveryReady: true,
  scanBinding: { matched: false, authorizedCheckpointId: "checkpoint-1" },
};
function runner(finalVerify = { ...verify, current: true, contextGenerationId: "context-2", scanBinding: { matched: true, authorizedCheckpointId: "checkpoint-2", currentScanSha256: scan.scanSha256 } }) {
  const calls = [];
  const requests = [];
  return {
    calls,
    requests,
    run(request) {
      calls.push(request.operation);
      requests.push(request);
      if (request.operation === "scan") return scan;
      if (request.operation === "verify") return calls.filter((value) => value === "verify").length > 1 ? finalVerify : verify;
      if (request.operation === "issue_accepted_evidence_receipt") throw new Error("generic runtime must not issue app-owned receipts");
      if (request.operation === "refresh_binding") return { authorizedCheckpointId: "checkpoint-2", scanSha256: scan.scanSha256, contextGenerationId: "context-2" };
      throw new Error("unexpected");
    },
  };
}

function issuer(calls = []) {
  return (request) => {
    calls.push(request);
    return { receiptId: "accepted-evidence-" + "d".repeat(32), issuer: "zhixia.app.memory-runtime", issuedAt: "2026-08-13T00:00:00.000Z", expiresAt: "2026-08-13T00:10:00.000Z" };
  };
}

const previewRunner = runner();
const preview = authorityLifecycleReview({ workspace: scan.workspace, acceptedChangedPaths: ["src/a.js"] }, { executeRuntime: previewRunner.run.bind(previewRunner) });
assert.equal(preview.status, "review_required");
assert.deepEqual(previewRunner.calls, ["scan", "verify"]);
assert.deepEqual(previewRunner.requests[0].relativePaths, ["src/a.js"], "review scan must include the exact proposed paths");
assert.equal(previewRunner.requests[1].relativePaths, undefined, "pre-review verify must validate the existing authorized baseline");
assert.equal(preview.authority.writable, false);

const baseAccept = {
  workspace: scan.workspace,
  acceptedChangedPaths: ["src/a.js"],
  execute: true,
  userConfirmed: true,
  decision: "accept",
  reviewToken: preview.reviewToken,
  expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
  expectedScanSha256: scan.scanSha256,
  previousCheckpointId: "checkpoint-1",
  sourceRefs: [{ path: "src/a.js", sha256: hash }],
  issuer: "zhixia.app.ordinary_ui",
  lane: "ordinary-ui-review",
  title: "Accepted source",
  summary: "Reviewed exact source postimage.",
};
const acceptRunner = runner();
const issuerCalls = [];
const accepted = authorityLifecycleReview(baseAccept, { executeRuntime: acceptRunner.run.bind(acceptRunner), issueAcceptedEvidenceReceipt: issuer(issuerCalls) });
assert.equal(accepted.status, "verified");
assert.deepEqual(acceptRunner.calls, ["scan", "verify", "refresh_binding", "verify"]);
assert.equal(acceptRunner.requests[1].relativePaths, undefined, "acceptance must reverify the existing baseline before mutation");
assert.deepEqual(acceptRunner.requests[3].relativePaths, ["src/a.js"], "post-refresh verify must bind the accepted exact paths");
assert.equal(issuerCalls.length, 1);
assert.equal(accepted.refresh.checkpointId, "checkpoint-2");
assert.equal(accepted.refresh.scanSha256, scan.scanSha256);
assert.equal(accepted.refresh.contextGenerationId, "context-2");
assert.equal(accepted.verification.checkpointId, accepted.refresh.checkpointId);
assert.equal(accepted.verification.scanSha256, accepted.refresh.scanSha256);
assert.equal(accepted.verification.contextGenerationId, accepted.refresh.contextGenerationId);
assert.throws(() => authorityLifecycleReview(baseAccept, { executeRuntime: runner().run }), /authority_review_app_owned_receipt_issuer_required/);
assert.throws(() => authorityLifecycleReview({ ...baseAccept, reviewToken: "tampered" }, { executeRuntime: runner().run, issueAcceptedEvidenceReceipt: issuer() }), /authority_review_token_mismatch/);
assert.throws(() => authorityLifecycleReview({ ...baseAccept, sourceRefs: [{ path: "src/a.js", sha256: "0".repeat(64) }] }, { executeRuntime: runner().run, issueAcceptedEvidenceReceipt: issuer() }), /authority_review_source_ref_mismatch/);
assert.throws(() => authorityLifecycleReview(baseAccept, { executeRuntime: runner({ ...verify, current: false, scanBinding: { matched: false, authorizedCheckpointId: "checkpoint-1" } }).run, issueAcceptedEvidenceReceipt: issuer() }), /authority_review_reverify_not_ready/);
for (const finalVerify of [
  { ...verify, current: true, contextGenerationId: "context-2", scanBinding: { matched: true, authorizedCheckpointId: "checkpoint-other", currentScanSha256: scan.scanSha256 } },
  { ...verify, current: true, contextGenerationId: "context-2", scanBinding: { matched: true, authorizedCheckpointId: "checkpoint-2", currentScanSha256: "e".repeat(64) } },
  { ...verify, current: true, contextGenerationId: "context-other", scanBinding: { matched: true, authorizedCheckpointId: "checkpoint-2", currentScanSha256: scan.scanSha256 } },
]) {
  assert.throws(
    () => authorityLifecycleReview(baseAccept, { executeRuntime: runner(finalVerify).run, issueAcceptedEvidenceReceipt: issuer() }),
    /authority_review_reverify_not_ready/,
    "refresh and reverify must describe one exact checkpoint, scan, and generation",
  );
}
console.log("Memory authority lifecycle adapter tests passed.");
