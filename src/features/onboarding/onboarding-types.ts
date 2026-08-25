export type OnboardingActionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };
