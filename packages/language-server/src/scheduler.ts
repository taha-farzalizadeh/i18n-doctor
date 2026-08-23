/**
 * Debounced, single-flight analysis scheduling.
 *
 * Guarantees:
 *  - bursts of edits collapse into one run (debounce);
 *  - at most one analysis runs at a time (no duplicate concurrent scans);
 *  - a run superseded by a newer request is aborted and its results discarded.
 */

import { describeError, type Logger } from "./logger.js";

export interface RunContext {
  /** Monotonic id of the request this run serves. */
  readonly generation: number;
  /** Aborted as soon as a newer request arrives. */
  readonly signal: AbortSignal;
  /** True once a newer request has superseded this run. */
  isStale(): boolean;
}

export interface TimerApi {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SchedulerOptions {
  readonly run: (context: RunContext) => Promise<void>;
  readonly debounceMs?: number;
  readonly logger?: Logger;
  readonly timers?: TimerApi;
  /** Notified when a run fails for a reason other than cancellation. */
  readonly onError?: (error: unknown, generation: number) => void;
}

export interface Scheduler {
  /** Requests an analysis after the debounce window. */
  schedule(reason?: string): void;
  /** Requests an analysis immediately, skipping the debounce window. */
  scheduleNow(reason?: string): void;
  /** Resolves once no run is pending or in flight. */
  settle(): Promise<void>;
  /** Drops pending work and aborts anything in flight. */
  cancel(): void;
  dispose(): void;
  setDebounce(ms: number): void;
  getDebounce(): number;
  /** Generation of the most recent request. */
  readonly requested: number;
  /** Generation of the most recently completed run. */
  readonly completed: number;
}

/** A run that unwound because it was superseded is expected, not a failure. */
function isCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

const defaultTimers: TimerApi = {
  set(callback, ms) {
    return setTimeout(callback, ms);
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function createScheduler(options: SchedulerOptions): Scheduler {
  const timers = options.timers ?? defaultTimers;
  const logger = options.logger?.child("scheduler");

  let debounceMs = Math.max(0, options.debounceMs ?? 250);
  let requested = 0;
  let completed = 0;
  let timer: unknown;
  let running: Promise<void> | undefined;
  let runningGeneration = 0;
  let controller: AbortController | undefined;
  let rerunPending = false;
  let disposed = false;
  let idleWaiters: (() => void)[] = [];

  const isIdle = (): boolean =>
    timer === undefined && running === undefined && !rerunPending;

  const notifyIdle = (): void => {
    if (!isIdle()) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const clearTimer = (): void => {
    if (timer === undefined) return;
    timers.clear(timer);
    timer = undefined;
  };

  const start = (): void => {
    if (disposed) return;
    clearTimer();
    if (running) {
      // Let the in-flight run unwind first; it has already been aborted.
      rerunPending = true;
      return;
    }

    const generation = requested;
    runningGeneration = generation;
    const abort = new AbortController();
    controller = abort;

    const context: RunContext = {
      generation,
      signal: abort.signal,
      isStale: () => generation !== requested || abort.signal.aborted,
    };

    running = options
      .run(context)
      .then(() => {
        if (generation > completed) completed = generation;
      })
      .catch((error: unknown) => {
        // A scheduled analysis must never surface as an unhandled rejection.
        if (isCancellation(error, abort.signal)) {
          logger?.debug(`run ${generation} cancelled`);
          return;
        }
        logger?.warn(`run ${generation} failed: ${describeError(error)}`);
        options.onError?.(error, generation);
      })
      .finally(() => {
        running = undefined;
        if (controller === abort) controller = undefined;
        if (rerunPending && !disposed) {
          rerunPending = false;
          queue(0);
        } else {
          notifyIdle();
        }
      });
  };

  const queue = (delay: number): void => {
    if (disposed) return;
    clearTimer();
    if (delay <= 0) {
      // Still asynchronous so a burst of notifications collapses into one run.
      timer = timers.set(() => {
        timer = undefined;
        start();
      }, 0);
      return;
    }
    timer = timers.set(() => {
      timer = undefined;
      start();
    }, delay);
  };

  const request = (delay: number, reason?: string): void => {
    if (disposed) return;
    requested += 1;
    if (reason) logger?.debug(`scheduled #${requested} (${reason})`);
    // Anything in flight is now analyzing an outdated state.
    if (running && runningGeneration !== requested) controller?.abort();
    queue(delay);
  };

  return {
    schedule(reason) {
      request(debounceMs, reason);
    },

    scheduleNow(reason) {
      request(0, reason);
    },

    settle() {
      if (isIdle()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },

    cancel() {
      clearTimer();
      rerunPending = false;
      controller?.abort();
      notifyIdle();
    },

    dispose() {
      disposed = true;
      clearTimer();
      rerunPending = false;
      controller?.abort();
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    },

    setDebounce(ms) {
      debounceMs = Math.max(0, ms);
    },

    getDebounce() {
      return debounceMs;
    },

    get requested() {
      return requested;
    },

    get completed() {
      return completed;
    },
  };
}
