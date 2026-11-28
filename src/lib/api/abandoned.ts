/**
 * The signed-in account changed while an operation was under way, so its outcome belongs to a screen
 * that is gone. This says nothing about the request: whatever had been sent may well have been
 * carried out by the server. It only means "don't act on the answer here".
 */
export class OperationAbandoned extends Error {
  constructor() {
    super("The signed-in account changed while this was under way; its outcome is not for this screen.")
    this.name = "OperationAbandoned"
  }
}
