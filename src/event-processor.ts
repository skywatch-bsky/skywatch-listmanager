import { logger } from "./logger.js";

type Task<T> = () => Promise<T>;

export type EventProcessor = {
  enqueue(task: Task<void>): boolean;
  drain(): Promise<void>;
  pending(): number;
  onDrain(callback: () => void): void;
};

type EventProcessorOptions = {
  readonly concurrency: number;
  readonly highWaterMark: number;
  readonly lowWaterMark: number;
};

const DEFAULT_OPTIONS: EventProcessorOptions = {
  concurrency: 16,
  highWaterMark: 16384,
  lowWaterMark: 4096,
};

export function createEventProcessor(
  options: Partial<EventProcessorOptions> = {},
): EventProcessor {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const queue: Array<Task<void>> = [];
  let active = 0;
  let drainResolve: (() => void) | null = null;
  let drainCallbacks: Array<() => void> = [];

  function notifyDrain(): void {
    if (queue.length <= config.lowWaterMark) {
      for (const cb of drainCallbacks) {
        cb();
      }
    }
  }

  async function runNext(): Promise<void> {
    if (queue.length === 0 || active >= config.concurrency) {
      return;
    }

    const task = queue.shift()!;
    active++;

    try {
      await task();
    } catch (err) {
      logger.error({ err }, "Event processing task failed");
    } finally {
      active--;
      notifyDrain();

      if (queue.length === 0 && active === 0 && drainResolve) {
        drainResolve();
        drainResolve = null;
      }

      void runNext();
    }
  }

  return {
    enqueue(task: Task<void>): boolean {
      if (queue.length >= config.highWaterMark) {
        return false;
      }

      queue.push(task);
      void runNext();
      return true;
    },

    drain(): Promise<void> {
      if (queue.length === 0 && active === 0) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        drainResolve = resolve;
      });
    },

    pending(): number {
      return queue.length + active;
    },

    onDrain(callback: () => void): void {
      drainCallbacks.push(callback);
    },
  };
}
