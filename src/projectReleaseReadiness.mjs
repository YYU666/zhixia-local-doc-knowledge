export const RELEASE_READINESS_SCHEMA = "zhixia.project_release_readiness.v1";
export const RELEASE_EVIDENCE_RECEIPT_SCHEMA = "zhixia.release_evidence_receipt.v1";
export const RELEASE_EVIDENCE_LOAD_SCHEMA = "zhixia.release_evidence_load.v1";

function validIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateProjectReleaseReadiness(input = {}) {
  const nowMs = validIso(input.now) ?? Date.now();
  const continuity = input.continuity || {};
  const evidence = input.releaseEvidence || null;
  const receipt = evidence?.receipt || null;
  const blockers = [];
  if (!input.projectIdentity) blockers.push("project_identity_unknown");
  if ((continuity.conflictSlots || []).length > 0) blockers.push("continuity_conflict");
  if ((continuity.missingCriticalSlots || []).length > 0) blockers.push("critical_continuity_missing");
  if (continuity.recoveryReady !== true) blockers.push("continuity_not_recovery_ready");

  const issuedAt = validIso(receipt?.issuedAt);
  const expiresAt = validIso(receipt?.expiresAt);
  const receiptValid = Boolean(
    evidence
      && evidence.schemaVersion === RELEASE_EVIDENCE_LOAD_SCHEMA
      && evidence.status === "verified"
      && evidence.readOnly === true
      && evidence.verification?.verified === true
      && evidence.verification?.trackedAtHead === true
      && evidence.verification?.headBytesMatch === true
      && evidence.verification?.sourceRefsVerified === true
      && receipt
      && receipt.schemaVersion === RELEASE_EVIDENCE_RECEIPT_SCHEMA
      && receipt.decision === "release_ready"
      && receipt.projectIdentity?.projectId === input.projectIdentity
      && evidence.project?.projectId === input.projectIdentity
      && receipt.issuer?.role === "independent_release_qa"
      && issuedAt !== null
      && expiresAt !== null
      && issuedAt <= nowMs
      && expiresAt > nowMs
      && Array.isArray(receipt.gates)
      && receipt.gates.length > 0
      && receipt.gates.every((gate) => gate?.status === "pass" && Array.isArray(gate.sourceRefs) && gate.sourceRefs.length > 0),
  );
  if (!receipt) blockers.push("release_receipt_missing");
  else if (!receiptValid) blockers.push("release_receipt_invalid_or_expired");

  const continuityBlocked = blockers.some((value) => value.startsWith("continuity_") || value === "critical_continuity_missing");
  const ready = blockers.length === 0 && receiptValid;
  return Object.freeze({
    schemaVersion: RELEASE_READINESS_SCHEMA,
    status: ready ? "ready" : continuityBlocked ? "blocked" : "unknown",
    ready,
    documentationStage: input.documentationStage || "unknown",
    productCompletion: input.productCompletion || "unknown",
    continuityReady: continuity.recoveryReady === true && !continuityBlocked,
    receipt: receiptValid
      ? { receiptId: receipt.receiptId, issuer: receipt.issuer.id, issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt, gateCount: receipt.gates.length }
      : null,
    blockers: [...new Set(blockers)],
  });
}
