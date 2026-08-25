"use client";

import { useEffect, useState } from "react";

import {
  TINDIO_POS_APP_VERSION,
  type PosDeviceCredential,
} from "@/features/devices/device-schema";
import {
  getPosDeviceIdentity,
  savePosDeviceIdentity,
  type PosDeviceIdentity,
} from "@/features/offline/offline-store";

export type PosDeviceBinding = {
  deviceId: string;
  storeId: string;
  registerId: string;
  deviceName: string;
  appVersion: string;
  lastSeenAt: string;
};

export type PosDeviceState =
  | { state: "optional" }
  | { state: "loading" }
  | { state: "missing"; message: string }
  | { state: "invalid"; message: string }
  | {
      state: "ready";
      credential: PosDeviceCredential;
      binding: PosDeviceBinding;
      verifiedOffline?: boolean;
    };

function credentialFromIdentity(identity: PosDeviceIdentity): PosDeviceCredential {
  return {
    deviceId: identity.deviceId,
    secret: identity.secret,
    appVersion: identity.appVersion || TINDIO_POS_APP_VERSION,
  };
}

export function usePosDevice({
  organizationId,
  required,
}: {
  organizationId: string;
  required: boolean;
}) {
  const [device, setDevice] = useState<PosDeviceState>(required ? { state: "loading" } : { state: "optional" });

  useEffect(() => {
    let cancelled = false;

    if (!required) return () => {
      cancelled = true;
    };
    void (async () => {
      let cachedIdentity: PosDeviceIdentity | undefined;
      try {
        const identity = await getPosDeviceIdentity(organizationId);
        cachedIdentity = identity;
        if (!identity) {
          if (!cancelled) {
            setDevice({
              state: "missing",
              message: "This browser has not been registered as a TINDIO POS device.",
            });
          }
          return;
        }

        const credential = credentialFromIdentity(identity);
        if (!navigator.onLine && identity.binding) {
          if (!cancelled) {
            setDevice({
              state: "ready",
              credential,
              binding: { ...identity.binding, deviceId: identity.deviceId },
              verifiedOffline: true,
            });
          }
          return;
        }

        const response = await fetch("/api/pos/device", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId, device: credential }),
        });
        const result = await response.json().catch(() => null) as
          | { ok: true; device: PosDeviceBinding }
          | { ok: false; message?: string }
          | null;

        if (!response.ok || !result || !result.ok) {
          if (!cancelled) {
            setDevice({
              state: "invalid",
              message: result && !result.ok && result.message
                ? result.message
                : "This device is not active for TINDIO POS.",
            });
          }
          return;
        }

        await savePosDeviceIdentity({
          ...identity,
          appVersion: credential.appVersion,
          binding: result.device,
          lastVerifiedAt: new Date().toISOString(),
        });
        if (!cancelled) setDevice({ state: "ready", credential, binding: result.device });
      } catch {
        if (!navigator.onLine && cachedIdentity?.binding) {
          if (!cancelled) {
            setDevice({
              state: "ready",
              credential: credentialFromIdentity(cachedIdentity),
              binding: { ...cachedIdentity.binding, deviceId: cachedIdentity.deviceId },
              verifiedOffline: true,
            });
          }
          return;
        }
        if (!cancelled) {
          setDevice({
            state: "invalid",
            message: "TINDIO could not verify this device. Check your connection and refresh the POS.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, required]);

  return device;
}
