import { log } from "./log.ts";

export type Clock = {
  now(): number;
  schedule(fn: () => unknown, ms: number): { cancel(): void };
};

export function systemClock(): Clock {
  return {
    now: () => Date.now(),
    schedule(fn, ms) {
      const timer = setTimeout(() => {
        Promise.resolve(fn()).catch((error: unknown) => {
          log("error", "tarea programada", { message: error instanceof Error ? error.message : "error" });
        });
      }, ms);
      timer.unref?.();
      return { cancel: () => clearTimeout(timer) };
    },
  };
}

export function manualClock(start = 0): Clock & { advance(ms: number): Promise<void> } {
  let now = start;
  const timers: { at: number; fn: () => unknown; cancelled: boolean }[] = [];
  return {
    now: () => now,
    schedule(fn, ms) {
      const item = { at: now + ms, fn, cancelled: false };
      timers.push(item);
      return { cancel: () => { item.cancelled = true; } };
    },
    async advance(ms) {
      now += ms;
      const due = timers.filter((timer) => !timer.cancelled && timer.at <= now);
      for (const timer of due) timer.cancelled = true;
      for (const timer of due) await timer.fn();
    },
  };
}
