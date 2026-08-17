import assert from "node:assert/strict";
import {
  evaluateProjectReleaseReadiness,
  RELEASE_EVIDENCE_LOAD_SCHEMA,
  RELEASE_EVIDENCE_RECEIPT_SCHEMA,
} from "../src/projectReleaseReadiness.mjs";

const identity = "project-identity-sha256";
const now = "2026-08-13T00:05:00.000Z";
const continuity = { recoveryReady: true, conflictSlots: [], missingCriticalSlots: [] };
const receipt = {
  schemaVersion: RELEASE_EVIDENCE_RECEIPT_SCHEMA,
  receiptId: "release-evidence-0123456789abcdef0123456789abcdef",
  decision: "release_ready",
  projectIdentity: { projectId: identity },
  issuer: { id: "neutral-qa", role: "independent_release_qa" },
  issuedAt: "2026-08-13T00:00:00.000Z",
  expiresAt: "2026-08-13T00:10:00.000Z",
  gates: [{ status: "pass", sourceRefs: [{ path: "docs/acceptance.md", sha256: "a".repeat(64) }] }],
};
const verifiedEvidence = {
  schemaVersion: RELEASE_EVIDENCE_LOAD_SCHEMA,
  status: "verified",
  readOnly: true,
  project: { projectId: identity },
  receipt,
  verification: { verified: true, trackedAtHead: true, headBytesMatch: true, sourceRefsVerified: true },
};

assert.equal(evaluateProjectReleaseReadiness({ now, projectIdentity: identity, documentationStage: "testing", continuity }).status, "unknown");
assert.equal(evaluateProjectReleaseReadiness({ now, projectIdentity: identity, continuity: { ...continuity, conflictSlots: ["project_identity"] }, releaseEvidence: verifiedEvidence }).status, "blocked");
assert.equal(evaluateProjectReleaseReadiness({ now, projectIdentity: identity, continuity: { ...continuity, missingCriticalSlots: ["open_blockers"] }, releaseEvidence: verifiedEvidence }).status, "blocked");
assert.equal(evaluateProjectReleaseReadiness({ now: "2026-08-13T00:11:00.000Z", projectIdentity: identity, continuity, releaseEvidence: verifiedEvidence }).status, "unknown");
assert.equal(evaluateProjectReleaseReadiness({ now, projectIdentity: identity, continuity, releaseEvidence: { ...verifiedEvidence, project: { projectId: "other" } } }).status, "unknown");
assert.equal(evaluateProjectReleaseReadiness({ now, projectIdentity: identity, continuity, releaseEvidence: { ...verifiedEvidence, verification: { ...verifiedEvidence.verification, verified: false } } }).status, "unknown");
assert.equal(evaluateProjectReleaseReadiness({ now, projectIdentity: identity, continuity, releaseEvidence: { ...verifiedEvidence, receipt: { ...receipt, schemaVersion: "zhixia.accepted_evidence_receipt.v1" } } }).status, "unknown", "ordinary authority receipts must never satisfy release readiness");
assert.equal(evaluateProjectReleaseReadiness({ now, projectIdentity: identity, continuity, releaseEvidence: verifiedEvidence }).status, "ready");
console.log("Project release readiness tests passed.");
