// Waits and yields that keep their pace on a page nobody looks at: the background People
// runner (docs/FACES.md "Background"). Browsers throttle a hidden page's timers, Chromium a
// chain of them down to one wake-up a minute after five minutes; a dedicated worker's timers
// and MessageChannel messages aren't throttled, so the runner's loop waits and yields through
// those instead of chains of setTimeout.

export interface Timers {
  set(callback: () => void, ms: number): number;
  clear(id: number): void;
}

export interface WorkerTimers extends Timers {
  dispose(): void;
}

export const windowTimers: Timers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (id) => window.clearTimeout(id),
};

// {id, ms} starts a timer (ms < 0 cancels it); the worker posts the id back when it's due.
const WORKER_SOURCE =
  "var t={};onmessage=function(e){var d=e.data;if(d.ms<0){clearTimeout(t[d.id]);delete t[d.id];return}" +
  "t[d.id]=setTimeout(function(){delete t[d.id];postMessage(d.id)},d.ms)}";

/** Timers run by a tiny worker, or null where workers can't be made (then use windowTimers). */
export function createWorkerTimers(): WorkerTimers | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  let worker: Worker;
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    worker = new Worker(url);
  } catch {
    return null;
  }
  const due = new Map<number, { callback: () => void; at: number }>();
  let nextId = 1;
  let broken = false;

  const fire = (id: number) => {
    const timer = due.get(id);
    if (!timer) return;
    due.delete(id);
    timer.callback();
  };
  worker.onmessage = (event: MessageEvent<number>) => fire(event.data);
  // A worker that couldn't start: what's waiting goes on with the page's own timers.
  worker.onerror = (event) => {
    event.preventDefault?.();
    broken = true;
    for (const [id, timer] of due) window.setTimeout(() => fire(id), Math.max(0, timer.at - Date.now()));
  };

  return {
    set(callback, ms) {
      const id = nextId++;
      const wait = Math.max(0, ms);
      due.set(id, { callback, at: Date.now() + wait });
      if (broken) window.setTimeout(() => fire(id), wait);
      else worker.postMessage({ id, ms: wait });
      return id;
    },
    clear(id) {
      if (due.delete(id) && !broken) worker.postMessage({ id, ms: -1 });
    },
    dispose() {
      due.clear();
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

/** Lets the page's other tasks run (IndexedDB, network replies, the worker's answers) without
 * waiting for a timer. */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
