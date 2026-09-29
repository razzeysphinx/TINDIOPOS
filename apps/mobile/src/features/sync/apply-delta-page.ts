import type { PosSyncPullResponse } from "../../../../../src/contracts/pos";
import { applyDeltaSqliteTransaction } from "../../db/delta-apply";
import { saveReferenceSnapshot } from "../../db/reference-cache";
import { advanceSyncCursor } from "../../db/sync-cursor";
import { applyDeviceDelta } from "./apply-device-delta";
export async function applyDeltaPage(page:PosSyncPullResponse){if(page.nextCursor<page.fromCursor||page.organizationId.length===0||page.storeId.length===0)throw new Error("INVALID_DELTA_SCOPE");await applyDeltaSqliteTransaction(page.organizationId,page.storeId,page.catalog,page.customers,page.invalidateModifiers);if(page.reference)await saveReferenceSnapshot(page.reference.snapshot);if(page.device){const result=await applyDeviceDelta(page.organizationId,page.device);if(!result.ok)throw new Error(result.reason);}await advanceSyncCursor(page.organizationId,page.deviceId,page.storeId,page.nextCursor);return{catalog:page.catalog.length,customers:page.customers.length,reference:Boolean(page.reference),modifiers:page.invalidateModifiers,device:Boolean(page.device)};}
