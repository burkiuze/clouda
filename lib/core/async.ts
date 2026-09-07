/** A wait budget that always clears its timer and observes late rejections. */
export function within<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  if (ms <= 0 || signal?.aborted) {
    void work.catch(() => {});
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); };
    const stop = () => { cleanup(); resolve(null); };
    const timer = setTimeout(stop, ms);
    signal?.addEventListener("abort", stop, { once: true });
    work.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

/** Coalesce identical work on one instance, with bounded bookkeeping. */
export class SingleFlight<T> {
  private readonly pending = new Map<string, Promise<T>>();
  constructor(private readonly maxEntries = 256) {}

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const work = Promise.resolve().then(task);
    if (this.pending.size >= this.maxEntries) return work;
    this.pending.set(key, work);
    const remove = () => {
      if (this.pending.get(key) === work) this.pending.delete(key);
    };
    void work.then(remove, remove);
    return work;
  }
}
