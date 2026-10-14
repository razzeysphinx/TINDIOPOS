export type BarcodeScanGuard = {
  tryAcquire(): boolean;
  release(): void;
};

export function createBarcodeScanGuard(): BarcodeScanGuard {
  let inFlight = false;

  return {
    tryAcquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() {
      inFlight = false;
    },
  };
}
