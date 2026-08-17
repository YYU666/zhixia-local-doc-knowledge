const { boundaryError, requireFunction, requireNonEmptyString } = require("./contracts.cjs");

function assertReview(result) {
  if (result?.status !== "review_required" || result?.authority?.writable !== false || result?.authority?.receiptIssued !== false) {
    throw boundaryError("ERR_AUTHORITY_REVIEW_RESULT_INVALID", "Authority review must remain non-writable and issue no receipt.");
  }
  requireNonEmptyString(result.reviewToken, "ERR_AUTHORITY_REVIEW_TOKEN_REQUIRED", "reviewToken");
  if (!result.binding?.scanSha256 || !result.binding?.projectIdentitySha256 || !result.binding?.previousCheckpointId) {
    throw boundaryError("ERR_AUTHORITY_REVIEW_BINDING_INVALID", "Authority review must bind scan, project identity, and checkpoint.");
  }
  return result;
}

function assertReady(result) {
  const verification = result?.verification || {};
  const ready = result?.status === "verified"
    && verification.memoryMode === "app_owned_memory_core"
    && verification.authorityVerification === "app_owned_verified"
    && verification.current === true
    && verification.recoveryReady === true
    && verification.matched === true
    && Boolean(result?.receipt?.receiptId)
    && Boolean(result?.refresh?.checkpointId);
  if (!ready) throw boundaryError("ERR_AUTHORITY_REVERIFY_NOT_READY", "Authority acceptance did not finish with a verified current checkpoint.");
  return result;
}

function createAuthorityLifecyclePort(adapter = {}) {
  const reviewAdapter = requireFunction(adapter.review, "authorityLifecycle.review");
  const acceptAdapter = requireFunction(adapter.acceptRefreshReverify, "authorityLifecycle.acceptRefreshReverify");

  async function review(request = {}) {
    if (request.execute === true || request.userConfirmed === true) {
      throw boundaryError("ERR_AUTHORITY_REVIEW_MUST_BE_READONLY", "Review cannot carry execution or confirmation authority.");
    }
    return assertReview(await reviewAdapter({ ...request, execute: false, userConfirmed: false }));
  }

  async function acceptRefreshReverify(request = {}) {
    if (request.userConfirmed !== true || request.decision !== "accept") {
      throw boundaryError("ERR_AUTHORITY_EXPLICIT_ACCEPTANCE_REQUIRED", "Explicit user-confirmed acceptance is required.");
    }
    for (const field of ["reviewToken", "expectedProjectIdentitySha256", "expectedScanSha256", "previousCheckpointId"]) {
      requireNonEmptyString(request[field], "ERR_AUTHORITY_ACCEPT_BINDING_REQUIRED", field);
    }
    if (!Array.isArray(request.sourceRefs) || request.sourceRefs.length === 0) {
      throw boundaryError("ERR_AUTHORITY_SOURCE_REFS_REQUIRED", "Source-backed acceptance requires sourceRefs.");
    }
    return assertReady(await acceptAdapter({ ...request, execute: true }));
  }

  return Object.freeze({ review, acceptRefreshReverify });
}

module.exports = { assertReady, assertReview, createAuthorityLifecyclePort };
