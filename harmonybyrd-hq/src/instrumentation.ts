/**
 * Runs once when the server starts, before it serves any request (Next.js instrumentation hook).
 *
 * The check itself lives in instrumentation-node.ts and is loaded only in the Node.js runtime,
 * so nothing Node-specific is compiled for any other runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
