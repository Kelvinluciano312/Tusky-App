// When an app dialog may present its Modal. Pure: no React Native imports, so
// it runs under `node --test`.
//
// On iOS every React Native Modal is a presented view controller. Presenting
// the dialog's while a Sheet's is still closing (its slide-out keeps the Modal
// mounted) leaves an invisible full-screen Modal that swallows every touch: the
// app looks frozen and needs a force-close (issue #76). A Sheet holds the gate
// from the moment it starts closing until its Modal is gone, plus a short
// settle while UIKit finishes the dismissal; dialogs wait for the gate.

type Timers = {
  schedule: (run: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
};

export type ModalGate = {
  /** Hold the gate. Returns the release, which is safe to call twice. */
  hold: () => () => void;
  /** True when no Modal is closing and the last one has settled. */
  isClear: () => boolean;
  subscribe: (listener: () => void) => () => void;
};

const defaultTimers: Timers = {
  schedule: (run, ms) => setTimeout(run, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createModalGate(settleMs: number, timers: Timers = defaultTimers): ModalGate {
  let holders = 0;
  let clear = true;
  let pending: unknown = null;
  const listeners = new Set<() => void>();

  const set = (next: boolean) => {
    if (clear === next) return;
    clear = next;
    listeners.forEach((l) => l());
  };

  return {
    hold() {
      holders += 1;
      if (pending !== null) {
        timers.cancel(pending);
        pending = null;
      }
      set(false);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders > 0) return;
        pending = timers.schedule(() => {
          pending = null;
          if (holders === 0) set(true);
        }, settleMs);
      };
    },
    isClear: () => clear,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Long enough for UIKit to finish dismissing a sheet's Modal after it unmounts. */
export const MODAL_SETTLE_MS = 250;

/** The app's one gate, shared by Sheet and DialogHost. */
export const modalGate = createModalGate(MODAL_SETTLE_MS);
