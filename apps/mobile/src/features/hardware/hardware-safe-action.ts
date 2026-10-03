import type {
  HardwareActionResult,
} from "./hardware-contracts";

export async function runHardwareSideEffect<T>(
  action: () => Promise<T>,
  failureMessage: string,
): Promise<HardwareActionResult<T>> {
  try {
    return {
      ok: true,
      value: await action(),
    };
  } catch {
    return {
      ok: false,
      code: "FAILED",
      message: failureMessage,
    };
  }
}

export function unsupportedHardware(
  message: string,
): HardwareActionResult {
  return {
    ok: false,
    code: "UNSUPPORTED",
    message,
  };
}