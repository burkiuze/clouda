import { after } from "next/server";

/**
 * Runs work after the response has been sent.
 *
 * Writing the answer cache and the usage row are both database round trips
 * that no caller waits for the result of, yet both sat on the critical path
 * and added their latency to every single request. `after()` hands them to the
 * platform to finish once the response is out, so the caller pays for the
 * search and not for our bookkeeping.
 *
 * Outside a request scope — a cron job, a script — `after()` has nothing to
 * attach to and throws; there the process is not frozen after a response, so
 * simply letting the promise run is correct.
 */
export function offload(task: () => Promise<unknown>): void {
  const guarded = () =>
    task().catch(() => {
      // Background bookkeeping must never surface as a request failure.
    });

  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
