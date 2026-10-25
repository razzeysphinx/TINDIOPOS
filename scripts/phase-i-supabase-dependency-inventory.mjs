const normalized = (path) => path.replaceAll("\\", "/");

export function classifySupabaseDependency(path) {
  const file = normalized(path);
  if (/^(src\/lib\/supabase\/|apps\/mobile\/src\/lib\/supabase\.ts$|apps\/mobile\/src\/features\/session\/|apps\/backend\/src\/auth\/provider\.ts$|apps\/backend\/src\/pos\/)/.test(file)) return "ACTIVE_RUNTIME";
  if (/^(package\.json|pnpm-lock\.yaml|\.github\/workflows\/|\.env\.example|apps\/[^/]+\/\.env\.example)/.test(file)) return "ACTIVE_BUILD_OR_CONFIGURATION";
  if (/^(scripts\/phase-e-|scripts\/architecture-phase-[efgh])/.test(file)) return "TRANSITION_OR_CERTIFICATION";
  if (/^(supabase\/migrations\/|docs\/archive\/)/.test(file)) return "HISTORICAL_EVIDENCE_PRESERVE";
  return "REVIEW_REQUIRED";
}

export const phaseI1CanonicalDependencies = Object.freeze([
  { path: "src/lib/supabase/server.ts", surface: "web", classification: "ACTIVE_RUNTIME" },
  { path: "src/lib/supabase/client.ts", surface: "web", classification: "ACTIVE_RUNTIME" },
  { path: "apps/mobile/src/lib/supabase.ts", surface: "mobile", classification: "ACTIVE_RUNTIME" },
  { path: "apps/mobile/src/features/session/auth-provider.ts", surface: "mobile", classification: "ACTIVE_RUNTIME" },
  { path: "apps/backend/src/auth/provider.ts", surface: "backend", classification: "ACTIVE_RUNTIME" },
  { path: "package.json", surface: "workspace", classification: "ACTIVE_BUILD_OR_CONFIGURATION" },
  { path: "pnpm-lock.yaml", surface: "workspace", classification: "ACTIVE_BUILD_OR_CONFIGURATION" },
  { path: "supabase/migrations", surface: "database-history", classification: "HISTORICAL_EVIDENCE_PRESERVE" }
]);
