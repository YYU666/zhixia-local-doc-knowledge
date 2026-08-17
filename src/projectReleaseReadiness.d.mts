export const RELEASE_READINESS_SCHEMA: "zhixia.project_release_readiness.v1";
export const RELEASE_EVIDENCE_RECEIPT_SCHEMA: "zhixia.release_evidence_receipt.v1";
export const RELEASE_EVIDENCE_LOAD_SCHEMA: "zhixia.release_evidence_load.v1";
export type ProjectReleaseReadiness = {
  schemaVersion: typeof RELEASE_READINESS_SCHEMA;
  status: "ready" | "blocked" | "unknown";
  ready: boolean;
  documentationStage: string;
  productCompletion: string;
  continuityReady: boolean;
  receipt: { receiptId: string; issuer: string; issuedAt: string; expiresAt: string; gateCount: number } | null;
  blockers: string[];
};
export function evaluateProjectReleaseReadiness(input?: {
  now?: string;
  projectIdentity?: string | null;
  documentationStage?: string;
  productCompletion?: string;
  continuity?: { recoveryReady?: boolean; conflictSlots?: string[]; missingCriticalSlots?: string[] };
  releaseEvidence?: unknown;
}): ProjectReleaseReadiness;
