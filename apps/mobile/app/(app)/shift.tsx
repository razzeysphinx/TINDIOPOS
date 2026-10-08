import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { prepareShiftFinalization } from "../../src/features/shifts/prepare-shift-finalization";
import {
  closePosV2Shift,
  openPosV2Shift,
  recordPosV2CashMovement,
} from "../../src/lib/tindio-api";

type MovementAttempt = {
  signature: string;
  key: string;
};

export default function ShiftScreen() {
  const { data, reload, mode } = useBusinessContext();
  const core = data?.core;
  const terminal = useTerminalDevice(core?.organization.id);

  const [openingCash, setOpeningCash] = useState("0");
  const [countedCash, setCountedCash] = useState("0");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [movementAttempt, setMovementAttempt] = useState<MovementAttempt | null>(null);
  const [closing, setClosing] = useState(false);

  if (!core) return <Text>Loading business context…</Text>;

  const binding = terminal.identity?.binding;
  const active = core.activeShift;
  const matches = Boolean(
    active
    && binding
    && active.storeId === binding.storeId
    && active.registerId === binding.registerId,
  );

  const offline = mode === "offline";

  const canOpen = core.permissions.includes("shifts.open");
  const canClose = core.permissions.includes("shifts.close");
  const canPayIn = core.permissions.includes("cash.pay_in");
  const canPayOut = core.permissions.includes("cash.pay_out");

  const open = async () => {
    if (
      offline
      || !canOpen
      || !binding
      || !terminal.identity
    ) return;

    try {
      const result = await openPosV2Shift(
        core.organization.id,
        binding,
        terminal.identity.credential,
        {
          openingCash,
          openingNote: note.trim(),
        },
      );

      setMessage(result.message);

      if (result.ok) {
        await reload(core.organization.id);
      }
    } catch {
      setMessage("Shift opening could not be confirmed.");
    }
  };

  const close = async () => {
    if (offline || closing || !canClose || !active || !matches || !binding || !terminal.identity) return;

    setClosing(true);
    try {
      const preparation = await prepareShiftFinalization({
        organizationId: core.organization.id,
        deviceId: terminal.identity.credential.deviceId,
        storeId: binding.storeId,
        registerId: binding.registerId,
        shiftId: active.id,
      });
      if (!preparation.ok) {
        setMessage(preparation.message);
        return;
      }
      const result = await closePosV2Shift(
        core.organization.id,
        {
          shiftId: active.id,
          countedCash,
          closingNote: note.trim(),
        },
      );

      setMessage(result.message);

      if (result.ok) {
        await reload(core.organization.id);
      }
    } catch {
      setMessage("Shift closing could not be confirmed. Refresh before retrying; do not assume the drawer is closed.");
    } finally {
      setClosing(false);
    }
  };

  const cash = async (movementType: "PAY_IN" | "PAY_OUT") => {
    if (
      !active
      || offline
      || !matches
      || (movementType === "PAY_IN" ? !canPayIn : !canPayOut)
    ) return;

    const signature = `${active.id}:${movementType}:${countedCash}:${note.trim()}`;
    const key =
      movementAttempt?.signature === signature
        ? movementAttempt.key
        : Crypto.randomUUID();

    setMovementAttempt({ signature, key });

    try {
      const result = await recordPosV2CashMovement(
        core.organization.id,
        {
          shiftId: active.id,
          movementType,
          amount: countedCash,
          reason: note.trim(),
          idempotencyKey: key,
        },
      );

      setMessage(result.message);

      if (result.ok) {
        setMovementAttempt(null);
        await reload(core.organization.id);
      }
    } catch {
      setMessage(
        "Cash movement status is unknown. Retry the unchanged operation to reuse the same idempotency key.",
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Shift — {core.organization.name}</Text>
      <Text>
        {binding
          ? `Terminal: ${binding.storeId} / ${binding.registerId}`
          : "Enroll terminal."}
      </Text>
      <Text>
        {active
          ? `Active shift: ${active.id}; opened ${active.openedAt}`
          : "No active shift"}
      </Text>
      <Text>
        {offline
          ? "Shift mutations are online only."
          : "Online shift controls"}
      </Text>

      <TextInput
        value={openingCash}
        onChangeText={setOpeningCash}
        placeholder="Opening cash"
        editable={!offline && canOpen}
        keyboardType="decimal-pad"
      />

      <TextInput
        value={countedCash}
        onChangeText={setCountedCash}
        placeholder="Counted cash / movement amount"
        editable={!offline}
        keyboardType="decimal-pad"
      />

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note / cash movement reason"
        editable={!offline}
        maxLength={500}
      />

      <Pressable
        disabled={offline || !canOpen || Boolean(active)}
        onPress={() => void open()}
      >
        <Text>Open shift</Text>
      </Pressable>

      <Pressable
        disabled={offline || closing || !canClose || !matches}
        onPress={() => void close()}
      >
        <Text>{closing ? "Checking transaction custody…" : "Close shift"}</Text>
      </Pressable>

      <Pressable
        disabled={offline || !canPayIn || !matches || note.trim().length < 2}
        onPress={() => void cash("PAY_IN")}
      >
        <Text>Pay in</Text>
      </Pressable>

      <Pressable
        disabled={offline || !canPayOut || !matches || note.trim().length < 2}
        onPress={() => void cash("PAY_OUT")}
      >
        <Text>Pay out</Text>
      </Pressable>

      <Text>{message}</Text>
    </ScrollView>
  );
}
