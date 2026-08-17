const { boundaryError, requireFunction, requireNonEmptyString } = require("./contracts.cjs");

function createPersistenceTransactionPort(adapter = {}) {
  const captureSnapshot = requireFunction(adapter.captureSnapshot, "persistence.captureSnapshot");
  const applyMutation = requireFunction(adapter.applyMutation, "persistence.applyMutation");
  const persist = requireFunction(adapter.persist, "persistence.persist");
  const restoreSnapshot = requireFunction(adapter.restoreSnapshot, "persistence.restoreSnapshot");
  const enterDegradedReadonly = requireFunction(adapter.enterDegradedReadonly, "persistence.enterDegradedReadonly");
  const shouldDegradeReadonly = typeof adapter.shouldDegradeReadonly === "function" ? adapter.shouldDegradeReadonly : () => true;
  let active = false;

  async function transact(request = {}) {
    if (active) throw boundaryError("ERR_PERSISTENCE_TRANSACTION_IN_PROGRESS", "Overlapping persistence transactions are forbidden.");
    const operation = requireNonEmptyString(request.operation, "ERR_PERSISTENCE_OPERATION_REQUIRED", "operation");
    active = true;
    let snapshot;
    let phase = "capture";
    try {
      snapshot = await captureSnapshot();
      phase = "mutate";
      const value = await applyMutation({ operation, payload: request.payload });
      phase = "persist";
      const durable = await persist();
      if (durable?.durable !== true) throw boundaryError("ERR_PERSISTENCE_NOT_DURABLE", "Persistence adapter did not prove durability.");
      return { schemaVersion: "zhixia.persistence_transaction.v1", status: "committed", operation, durable, value };
    } catch (cause) {
      let rollbackError = null;
      if (snapshot !== undefined) {
        try {
          await restoreSnapshot(snapshot);
        } catch (error) {
          rollbackError = error;
        }
      }
      const degrade = rollbackError != null || shouldDegradeReadonly({ cause, rollbackError, operation, phase }) === true;
      if (!degrade) throw cause;
      await enterDegradedReadonly({ cause, rollbackError, operation, phase });
      throw boundaryError(
        "ERR_PERSISTENCE_TRANSACTION_FAILED",
        `Persistence transaction failed and entered degraded read-only: ${cause?.message || cause}`,
        { cause, rollbackError, degradedReadonly: true },
      );
    } finally {
      active = false;
    }
  }

  return Object.freeze({ transact, isActive: () => active });
}

module.exports = { createPersistenceTransactionPort };
