function boundaryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const INITIAL_WORKFLOW = Object.freeze({
  schemaVersion: "zhixia.authority_renderer_workflow.v1",
  stage: "idle",
  reviewToken: null,
  binding: null,
  receiptId: null,
  checkpointId: null,
  verification: null,
  error: null,
});

const ALLOWED_EVENTS = Object.freeze({
  idle: ["VERIFY_STARTED"],
  verifying: ["REVIEW_PREPARED", "FAILED"],
  review_required: ["ACCEPT_CONFIRMED", "VERIFY_STARTED", "FAILED"],
  accepting: ["ACCEPTED", "FAILED"],
  refreshing: ["REFRESHED", "FAILED"],
  reverifying: ["REVERIFIED", "FAILED"],
  ready: ["VERIFY_STARTED"],
  failed: ["VERIFY_STARTED"],
});

export function initialRendererWorkflow() {
  return cloneJson(INITIAL_WORKFLOW);
}

export function transitionRendererWorkflow(current = INITIAL_WORKFLOW, event = {}) {
  const type = String(event.type || "");
  if (type === "RESET") return initialRendererWorkflow();
  if (!ALLOWED_EVENTS[current.stage]?.includes(type)) {
    throw boundaryError("ERR_RENDERER_WORKFLOW_TRANSITION_INVALID", `Cannot apply ${type || "empty event"} from ${current.stage}.`);
  }
  if (type === "VERIFY_STARTED") return { ...initialRendererWorkflow(), stage: "verifying" };
  if (type === "FAILED") return { ...current, stage: "failed", error: String(event.error || "workflow_failed") };
  if (type === "REVIEW_PREPARED") {
    if (!event.reviewToken || !event.binding?.scanSha256 || !event.binding?.projectIdentitySha256 || !event.binding?.previousCheckpointId) {
      throw boundaryError("ERR_RENDERER_REVIEW_BINDING_INVALID", "Review UI requires a token and exact scan/project/checkpoint binding.");
    }
    return { ...current, stage: "review_required", reviewToken: event.reviewToken, binding: cloneJson(event.binding), error: null };
  }
  if (type === "ACCEPT_CONFIRMED") {
    if (event.userConfirmed !== true || event.decision !== "accept" || event.reviewToken !== current.reviewToken) {
      throw boundaryError("ERR_RENDERER_ACCEPTANCE_INVALID", "Acceptance must be explicit and match the visible review token.");
    }
    return { ...current, stage: "accepting" };
  }
  if (type === "ACCEPTED") {
    if (!event.receiptId) throw boundaryError("ERR_RENDERER_RECEIPT_REQUIRED", "Accepted UI state requires a receipt.");
    return { ...current, stage: "refreshing", receiptId: event.receiptId };
  }
  if (type === "REFRESHED") {
    if (!event.checkpointId) throw boundaryError("ERR_RENDERER_CHECKPOINT_REQUIRED", "Refresh UI state requires a checkpoint.");
    return { ...current, stage: "reverifying", checkpointId: event.checkpointId };
  }
  const verification = event.verification || {};
  const ready = verification.memoryMode === "app_owned_memory_core"
    && verification.authorityVerification === "app_owned_verified"
    && verification.current === true
    && verification.recoveryReady === true
    && verification.matched === true;
  if (!ready) throw boundaryError("ERR_RENDERER_REVERIFY_NOT_READY", "Renderer cannot show ready before all authority checks pass.");
  return { ...current, stage: "ready", verification: cloneJson(verification), error: null };
}

export function rendererWorkflowView(state) {
  return {
    stage: state.stage,
    busy: ["verifying", "accepting", "refreshing", "reverifying"].includes(state.stage),
    canReview: state.stage === "review_required",
    canAccept: state.stage === "review_required" && Boolean(state.reviewToken),
    ready: state.stage === "ready",
    authorityWritable: false,
  };
}

export { ALLOWED_EVENTS, INITIAL_WORKFLOW };
