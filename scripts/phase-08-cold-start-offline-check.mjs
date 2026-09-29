import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read = (file) => fs.readFileSync(file, "utf8");
test("Phase 08 cold-start offline remains secure and phase-bounded", () => {
  const authorization = read("apps/mobile/src/features/offline/offline-authorization.ts"); const preparation = read("apps/mobile/src/features/offline/prepare-offline-mode.ts"); const readiness = read("apps/mobile/src/features/offline/offline-readiness.ts"); const session = read("apps/mobile/src/features/session/session-provider.tsx"); const business = read("apps/mobile/src/features/business/business-context-provider.tsx"); const terminal = read("apps/mobile/src/features/device/use-terminal-device.ts"); const root = read("apps/mobile/app/index.tsx") + read("apps/mobile/app/(app)/_layout.tsx"); const shift = read("apps/mobile/app/(app)/shift.tsx"); const pos = read("apps/mobile/app/(app)/pos.tsx"); const sync = read("apps/mobile/app/(app)/sync-status.tsx");
  assert.match(authorization, /secureStorage/); assert.match(authorization, /12 \* 60 \* 60 \* 1000/); assert.match(authorization, /5 \* 60 \* 1000/); assert.match(authorization, /CLOCK_ROLLBACK/); assert.match(authorization, /clearOfflineAuthorizationGrant/);
  for (const word of ["validatePosV2Device", "fetchPosV2Reference", "fetchPosV2CatalogPage", "replaceCompleteCatalogSnapshot", "saveOfflineAuthorizationGrant", "CATALOG_PAGINATION_STALLED"]) assert.match(preparation, new RegExp(word));
  for (const word of ["getBusinessContextSnapshot", "loadMobileDeviceIdentity", "getActiveShiftSnapshot", "getReferenceSnapshot", "getLocalCacheStates", "getCatalogItemCount"]) assert.match(readiness, new RegExp(word));
  assert.match(session, /"offline"/); assert.match(session, /refreshOfflineAccess/); assert.match(root, /accessMode === "offline"/); assert.match(business, /evaluateOfflineReadiness/); assert.match(business, /isExplicitAuthorizationDenial/); assert.match(terminal, /accessMode === "offline"/); assert.match(shift, /offline \|\|/); assert.match(pos, /mode === "offline"/); assert.match(pos, /OFFLINE POS READY/); assert.match(sync, /Prepare Offline Mode/); assert.match(sync, /Revoke Offline Authorization/);
  const sqliteSchema = read("apps/mobile/src/db/schema.ts"); assert.doesNotMatch(sqliteSchema, /CREATE TABLE[^;]*(outbox|device_sequence|server_checkpoint|delta_cursor|conflicts)/i);
  for (const phase of ["PHASE 09", "PHASE 10", "PHASE 11", "PHASE 12"]) assert.match(sync, new RegExp(phase));
});
