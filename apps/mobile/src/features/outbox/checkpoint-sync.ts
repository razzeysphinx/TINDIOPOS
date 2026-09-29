import { recordServerCheckpoint } from "../../db/device-sync-state";
import { fetchPosV2DeviceCheckpoint } from "../../lib/tindio-api";
import { loadMobileDeviceIdentity } from "../device/device-store";

export type CheckpointRefreshResult =
  | { ok: true; checkpoint: { deviceId: string; serverCheckpoint: number; nextExpectedSequence: number; updatedAt: string | null } }
  | { ok: false; reason: string };

/** Explicit, online-only refresh. Phase 11 deliberately does not poll checkpoints. */
export async function refreshDeviceCheckpoint(organizationId: string): Promise<CheckpointRefreshResult> {
  const identity = await loadMobileDeviceIdentity(organizationId);
  if (!identity || !identity.binding) return { ok: false, reason: "DEVICE_CREDENTIAL_UNAVAILABLE" };
  let response: Awaited<ReturnType<typeof fetchPosV2DeviceCheckpoint>>;
  try {
    response = await fetchPosV2DeviceCheckpoint(organizationId, identity.credential);
  } catch {
    return { ok: false, reason: "CHECKPOINT_REFRESH_UNAVAILABLE" };
  }
  if (!response.ok) return { ok: false, reason: response.message };
  if (response.checkpoint.deviceId !== identity.credential.deviceId) return { ok: false, reason: "DEVICE_CHECKPOINT_MISMATCH" };
  await recordServerCheckpoint({ organizationId, deviceId: identity.credential.deviceId, serverCheckpoint: response.checkpoint.serverCheckpoint, status: "CHECKPOINT_READ" });
  return { ok: true, checkpoint: response.checkpoint };
}
