import { describe, expect, it, vi } from "vitest";
import { createScheduler, type RunContext } from "../src/scheduler.js";

const tick = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("scheduler debounce", () => {
  it("coalesces a burst of requests into a single run", async () => {
    let runs = 0;
    const scheduler = createScheduler({
      debounceMs: 25,
      run: async () => {
        runs += 1;
      },
    });

    for (let i = 0; i < 10; i += 1) {
      scheduler.schedule();
    }
    expect(runs).toBe(0);

    await scheduler.settle();
    expect(runs).toBe(1);
  });

  it("waits for the debounce window before running", async () => {
    let runs = 0;
    const scheduler = createScheduler({
      debounceMs: 50,
      run: async () => {
        runs += 1;
      },
    });

    scheduler.schedule();
    await tick(10);
    expect(runs).toBe(0);
    await scheduler.settle();
    expect(runs).toBe(1);
  });

  it("restarts the window on each new request", async () => {
    const starts: number[] = [];
    const scheduler = createScheduler({
      debounceMs: 30,
      run: async () => {
        starts.push(Date.now());
      },
    });

    const begin = Date.now();
    scheduler.schedule();
    await tick(15);
    scheduler.schedule();
    await tick(15);
    scheduler.schedule();
    await scheduler.settle();

    expect(starts.length).toBe(1);
    expect(starts[0]! - begin).toBeGreaterThanOrEqual(30 + 15 + 15 - 5);
  });

  it("runs immediately when debounce is zero", async () => {
    let runs = 0;
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async () => {
        runs += 1;
      },
    });
    scheduler.schedule();
    await scheduler.settle();
    expect(runs).toBe(1);
  });

  it("uses the injected timer api", async () => {
    const set = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clear = vi.fn((handle: unknown) =>
      clearTimeout(handle as NodeJS.Timeout),
    );
    const scheduler = createScheduler({
      debounceMs: 5,
      run: async () => undefined,
      timers: { set, clear },
    });

    scheduler.schedule();
    scheduler.schedule();
    await scheduler.settle();

    expect(set).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });
});

describe("scheduler single flight", () => {
  it("never runs two analyses concurrently", async () => {
    let active = 0;
    let peak = 0;
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(20);
        active -= 1;
      },
    });

    scheduler.schedule();
    await tick(5);
    scheduler.schedule();
    await tick(5);
    scheduler.schedule();
    await scheduler.settle();

    expect(peak).toBe(1);
  });

  it("runs exactly once more after an in-flight run is superseded", async () => {
    const generations: number[] = [];
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async (context: RunContext) => {
        generations.push(context.generation);
        await tick(30);
      },
    });

    scheduler.schedule();
    await tick(5);
    // Three requests arrive while the first run is still working.
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    await scheduler.settle();

    // One trailing run covers all three, rather than three separate runs.
    expect(generations.length).toBe(2);
    expect(generations[1]).toBeGreaterThan(generations[0]!);
  });

  it("marks an in-flight run stale as soon as a newer request arrives", async () => {
    const observed: boolean[] = [];
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async (context: RunContext) => {
        await tick(20);
        observed.push(context.isStale());
      },
    });

    scheduler.schedule();
    await tick(5);
    scheduler.schedule();
    await scheduler.settle();

    expect(observed[0]).toBe(true);
    expect(observed.at(-1)).toBe(false);
  });

  it("aborts the in-flight signal when superseded", async () => {
    const aborted: boolean[] = [];
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async (context: RunContext) => {
        await tick(20);
        aborted.push(context.signal.aborted);
      },
    });

    scheduler.schedule();
    await tick(5);
    scheduler.schedule();
    await scheduler.settle();

    expect(aborted[0]).toBe(true);
    expect(aborted.at(-1)).toBe(false);
  });

  it("increments the generation monotonically", async () => {
    const seen: number[] = [];
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async (context: RunContext) => {
        seen.push(context.generation);
      },
    });

    for (let i = 0; i < 4; i += 1) {
      scheduler.schedule();
      await scheduler.settle();
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("scheduler resilience", () => {
  it("reports a failed run and keeps accepting work", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async () => {
        runs += 1;
        if (runs === 1) throw new Error("boom");
      },
      onError: (error) => errors.push(error),
    });

    scheduler.schedule();
    await scheduler.settle();
    scheduler.schedule();
    await scheduler.settle();

    expect(runs).toBe(2);
    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toBe("boom");
  });

  it("swallows abort errors from a cancelled run", async () => {
    const errors: unknown[] = [];
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async (context: RunContext) => {
        await tick(20);
        if (context.signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
      },
      onError: (error) => errors.push(error),
    });

    scheduler.schedule();
    await tick(5);
    scheduler.schedule();
    await scheduler.settle();

    expect(errors).toEqual([]);
  });

  it("settle resolves immediately when nothing is pending", async () => {
    const scheduler = createScheduler({
      debounceMs: 50,
      run: async () => undefined,
    });
    await expect(scheduler.settle()).resolves.toBeUndefined();
  });

  it("dispose cancels pending work and rejects new requests", async () => {
    let runs = 0;
    const scheduler = createScheduler({
      debounceMs: 30,
      run: async () => {
        runs += 1;
      },
    });

    scheduler.schedule();
    scheduler.dispose();
    scheduler.schedule();
    await tick(60);

    expect(runs).toBe(0);
  });

  it("aborts an in-flight run on dispose", async () => {
    let observedAbort = false;
    const scheduler = createScheduler({
      debounceMs: 0,
      run: async (context: RunContext) => {
        await tick(20);
        observedAbort = context.signal.aborted;
      },
    });

    scheduler.schedule();
    await tick(5);
    scheduler.dispose();
    await tick(40);

    expect(observedAbort).toBe(true);
  });
});
