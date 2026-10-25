import { evaluateSupabaseRetirement } from "./phase-i-retirement-gate.mjs";

export const protectedEvidencePrefixes = Object.freeze(["supabase/migrations/", "docs/archive/", "docs/architecture/"]);

export function planSupabaseRemoval(evidence, requestedPaths = []) {
  const gate = evaluateSupabaseRetirement(evidence);
  const protectedPaths = requestedPaths.filter((path) => protectedEvidencePrefixes.some((prefix) => path.replaceAll("\\", "/").startsWith(prefix)));
  return Object.freeze({
    executable: gate.allowed && protectedPaths.length === 0,
    decision: gate.allowed && protectedPaths.length === 0 ? "PLAN_ELIGIBLE_FOR_MANUAL_EXECUTION" : "PLAN_ONLY_DO_NOT_EXECUTE",
    protectedPaths,
    missingRequirements: gate.missingRequirements
  });
}
