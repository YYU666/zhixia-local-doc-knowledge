export type AuthorityVerification = {
  memoryMode: string;
  authorityVerification: string;
  current: boolean;
  recoveryReady: boolean;
  matched: boolean;
};

export type AuthorityRendererWorkflow = {
  schemaVersion: "zhixia.authority_renderer_workflow.v1";
  stage: "idle" | "verifying" | "review_required" | "accepting" | "refreshing" | "reverifying" | "ready" | "failed";
  reviewToken: string | null;
  binding: { scanSha256: string; projectIdentitySha256: string; previousCheckpointId: string } | null;
  receiptId: string | null;
  checkpointId: string | null;
  verification: AuthorityVerification | null;
  error: string | null;
};

export type AuthorityRendererEvent =
  | { type: "RESET" | "VERIFY_STARTED" }
  | { type: "FAILED"; error: string }
  | { type: "REVIEW_PREPARED"; reviewToken: string; binding: AuthorityRendererWorkflow["binding"] }
  | { type: "ACCEPT_CONFIRMED"; userConfirmed: true; decision: "accept"; reviewToken: string }
  | { type: "ACCEPTED"; receiptId: string }
  | { type: "REFRESHED"; checkpointId: string }
  | { type: "REVERIFIED"; verification: AuthorityVerification };

export function initialRendererWorkflow(): AuthorityRendererWorkflow;
export function transitionRendererWorkflow(state: AuthorityRendererWorkflow, event: AuthorityRendererEvent): AuthorityRendererWorkflow;
export function rendererWorkflowView(state: AuthorityRendererWorkflow): {
  stage: AuthorityRendererWorkflow["stage"];
  busy: boolean;
  canReview: boolean;
  canAccept: boolean;
  ready: boolean;
  authorityWritable: false;
};
