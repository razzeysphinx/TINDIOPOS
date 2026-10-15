import { requireOptionalNativeModule } from "expo";

export type AndroidExitEvent = {
  type: "NATIVE_CRASH" | "JAVA_CRASH" | "ANR";
  timestampMs: number;
};

type TindioExitObserverModule = {
  getHistoricalExitEventsAsync(): Promise<AndroidExitEvent[]>;
  isCertificationAvailable(): boolean;
  triggerAnrForCertification(): void;
  triggerNativeCrashForCertification(): void;
};

const nativeModule = requireOptionalNativeModule<TindioExitObserverModule>(
  "TindioExitObserver",
);

export async function getHistoricalAndroidExitEvents() {
  try {
    return await (nativeModule?.getHistoricalExitEventsAsync() ?? []);
  } catch {
    return [];
  }
}

export function isA45CertificationTriggerAvailable() {
  return nativeModule?.isCertificationAvailable() ?? false;
}

export function triggerA45NativeCrash() {
  if (!nativeModule) throw new Error("Android exit observation is unavailable.");
  nativeModule.triggerNativeCrashForCertification();
}

export function triggerA45Anr() {
  if (!nativeModule) throw new Error("Android exit observation is unavailable.");
  nativeModule.triggerAnrForCertification();
}
