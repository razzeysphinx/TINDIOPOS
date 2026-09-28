import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  enrollPosV2Device,
  validatePosV2Device,
} from "../../lib/tindio-api";
import {
  createMobileDeviceCredential,
  loadMobileDeviceIdentity,
  saveMobileDeviceIdentity,
  type MobileDeviceIdentity,
} from "./device-store";

export function DeviceSetup({
  core,
}: {
  core: PosBootstrapV2CoreResponse["core"];
}) {
  const organizationId = core.organization.id;
  const canManage = core.permissions.includes("devices.manage");

  const [identity, setIdentity] = useState<MobileDeviceIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("TINDIO Android POS");
  const [storeId, setStoreId] = useState(core.stores[0]?.id ?? "");
  const [registerId, setRegisterId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const registers = useMemo(
    () => core.registers.filter((register) => register.storeId === storeId),
    [core.registers, storeId],
  );

  const selectedRegisterId =
    registers.some((register) => register.id === registerId)
      ? registerId
      : (registers[0]?.id ?? "");

  useEffect(() => {
    let active = true;

    const timer = setTimeout(() => {
      void (async () => {
        if (!active) {
          return;
        }

        setLoading(true);
        setIdentity(null);
        setError(null);

        const stored = await loadMobileDeviceIdentity(organizationId);

        if (!active) {
          return;
        }

        if (!stored) {
          setLoading(false);
          return;
        }

        try {
          const result = await validatePosV2Device(
            organizationId,
            stored.credential,
          );

          if (!active) {
            return;
          }

          if (result.ok) {
            const next: MobileDeviceIdentity = {
              ...stored,
              binding: result.device,
              lastVerifiedAt: new Date().toISOString(),
            };

            await saveMobileDeviceIdentity(next);

            if (active) {
              setIdentity(next);
            }
          } else {
            setError(result.message);
          }
        } catch {
          if (active) {
            setError("TINDIO could not verify this device.");
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      })();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [organizationId]);

  const enroll = async () => {
    if (
      !storeId ||
      !selectedRegisterId ||
      name.trim().length < 2
    ) {
      return;
    }

    try {
      const credential = await createMobileDeviceCredential();
      const result = await enrollPosV2Device(organizationId, {
        ...credential,
        storeId,
        registerId: selectedRegisterId,
        name: name.trim(),
      });

      const next: MobileDeviceIdentity = {
        organizationId,
        credential,
        binding: result.device,
        createdAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
      };

      await saveMobileDeviceIdentity(next);
      setIdentity(next);
    } catch {
      setError("TINDIO could not enroll this device.");
    }
  };

  if (loading) {
    return (
      <View>
        <ActivityIndicator />
        <Text>Checking POS device…</Text>
      </View>
    );
  }

  if (identity?.binding) {
    return (
      <View>
        <Text>Device ready</Text>
        <Text>{identity.binding.deviceName}</Text>
        <Text>{identity.binding.appVersion}</Text>
      </View>
    );
  }

  if (!canManage) {
    return (
      <View>
        <Text>Device enrollment required</Text>
        <Text>
          Ask an Owner or Admin with device-management access to sign in on
          this Android device and enroll it.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Text>Enroll this Android POS</Text>

      {error ? <Text>{error}</Text> : null}

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Device name"
      />

      {core.stores.map((store) => (
        <Pressable key={store.id} onPress={() => setStoreId(store.id)}>
          <Text>
            {storeId === store.id ? "● " : "○ "}
            {store.name}
          </Text>
        </Pressable>
      ))}

      {registers.map((register) => (
        <Pressable
          key={register.id}
          onPress={() => setRegisterId(register.id)}
        >
          <Text>
            {selectedRegisterId === register.id ? "● " : "○ "}
            {register.name}
          </Text>
        </Pressable>
      ))}

      <Pressable onPress={() => void enroll()}>
        <Text>Enroll this device</Text>
      </Pressable>
    </View>
  );
}
