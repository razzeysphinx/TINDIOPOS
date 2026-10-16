import * as Crypto from "expo-crypto";
import { useState } from "react";

import { completeShiftFinalizationGuard } from "../../src/db/shift-custody";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { prepareShiftFinalization } from "../../src/features/shifts/prepare-shift-finalization";
import { closePosV2Shift, openPosV2Shift, recordPosV2CashMovement } from "../../src/lib/tindio-api";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioKeyValue, TindioWorkspaceHeader } from "../../src/ui/tindio-workspace";

type MovementAttempt = { signature: string; key: string };

export default function ShiftScreen() {
  const { data, reload, mode } = useBusinessContext();
  const core = data?.core;
  const terminal = useTerminalDevice(core?.organization.id);
  const [openingCash, setOpeningCash] = useState("0");
  const [countedCash, setCountedCash] = useState("0");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [movementAttempt, setMovementAttempt] = useState<MovementAttempt | null>(null);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [movementPending, setMovementPending] = useState<"PAY_IN" | "PAY_OUT" | null>(null);

  if (!core) return <TindioScreen><TindioFeedback description="Loading the current business and shift context." kind="loading" title="Loading shift" /></TindioScreen>;

  const binding = terminal.identity?.binding;
  const active = core.activeShift;
  const matches = Boolean(active && binding && active.storeId === binding.storeId && active.registerId === binding.registerId);
  const offline = mode === "offline";
  const canOpen = core.permissions.includes("shifts.open");
  const canClose = core.permissions.includes("shifts.close");
  const canPayIn = core.permissions.includes("cash.pay_in");
  const canPayOut = core.permissions.includes("cash.pay_out");

  const open = async () => {
    if (opening || offline || !canOpen || !binding || !terminal.identity) return;
    setOpening(true);
    try {
      const result = await openPosV2Shift(core.organization.id, binding, terminal.identity.credential, { openingCash, openingNote: note.trim() });
      setMessage(result.message);
      if (result.ok) await reload(core.organization.id);
    } catch {
      setMessage("Shift opening could not be confirmed.");
    } finally {
      setOpening(false);
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
      if (!preparation.ok) { setMessage(preparation.message); return; }
      const result = await closePosV2Shift(core.organization.id, terminal.identity.credential, {
        shiftId: active.id,
        countedCash,
        closingNote: note.trim(),
        localHighWater: preparation.localHighWater,
        finalizationToken: preparation.finalizationToken,
      });
      setMessage(result.message);
      if (result.ok) {
        await completeShiftFinalizationGuard(core.organization.id, active.id, preparation.finalizationToken);
        await reload(core.organization.id);
      }
    } catch {
      setMessage("Shift closing could not be confirmed. Refresh before retrying; do not assume the drawer is closed.");
    } finally {
      setClosing(false);
    }
  };

  const cash = async (movementType: "PAY_IN" | "PAY_OUT") => {
    if (movementPending || !active || offline || !matches || (movementType === "PAY_IN" ? !canPayIn : !canPayOut)) return;
    const signature = `${active.id}:${movementType}:${countedCash}:${note.trim()}`;
    const key = movementAttempt?.signature === signature ? movementAttempt.key : Crypto.randomUUID();
    setMovementAttempt({ signature, key });
    setMovementPending(movementType);
    try {
      const result = await recordPosV2CashMovement(core.organization.id, {
        shiftId: active.id, movementType, amount: countedCash, reason: note.trim(), idempotencyKey: key,
      });
      setMessage(result.message);
      if (result.ok) {
        setMovementAttempt(null);
        await reload(core.organization.id);
      }
    } catch {
      setMessage("Cash movement status is unknown. Retry the unchanged operation to reuse the same idempotency key.");
    } finally {
      setMovementPending(null);
    }
  };

  return (
    <TindioScreen scroll testID="shift-workspace">
      <TindioWorkspaceHeader
        description="Open and close the assigned drawer, record cash movements, and protect unresolved transaction custody."
        eyebrow="SHIFT & DRAWER"
        title={core.organization.name}
        trailing={<TindioStatusBadge label={active ? "Shift open" : "No active shift"} tone={active ? "success" : "warning"} />}
      />

      {offline ? <TindioFeedback description="Shift opening, closing, and cash movements require connectivity. Existing receipts and transaction custody remain available." kind="restriction" title="Shift actions are online only" /> : null}
      {!binding ? <TindioFeedback description="Enroll and assign this terminal before managing a shift." kind="restriction" title="Terminal assignment required" /> : null}
      {active && !matches ? <TindioFeedback description="The active shift belongs to a different store or register. Restore the original terminal context before continuing." kind="restriction" title="Shift does not match this terminal" /> : null}

      <TindioCard title="Current shift">
        <TindioKeyValue label="Status" value={active ? "Open" : "Closed"} />
        <TindioKeyValue label="Opened" value={active ? new Date(active.openedAt).toLocaleString() : "Not available"} />
        <TindioKeyValue label="Terminal" value={binding ? "Assigned store and register" : "Enrollment required"} />
      </TindioCard>

      {!active ? (
        <TindioCard description="Enter the cash counted in the drawer before the first sale." title="Open shift">
          <TindioInput editable={!offline && canOpen} keyboardType="decimal-pad" label="Opening cash" onChangeText={setOpeningCash} placeholder="0.00" value={openingCash} />
          <TindioInput editable={!offline && canOpen} label="Opening note" maxLength={500} onChangeText={setNote} placeholder="Optional note" value={note} />
          <TindioButton busy={opening} disabled={offline || !canOpen || Boolean(active)} onPress={() => void open()}>Open shift</TindioButton>
        </TindioCard>
      ) : (
        <>
          <TindioCard description="Cash movements require a reason. An unknown result must be retried unchanged." title="Cash movement">
            <TindioInput editable={!offline && matches} keyboardType="decimal-pad" label="Amount" onChangeText={setCountedCash} placeholder="0.00" value={countedCash} />
            <TindioInput editable={!offline && matches} label="Reason" maxLength={500} onChangeText={setNote} placeholder="Required reason" value={note} />
            <TindioButton busy={movementPending === "PAY_IN"} disabled={offline || !canPayIn || !matches || note.trim().length < 2} onPress={() => void cash("PAY_IN")}>Pay in</TindioButton>
            <TindioButton busy={movementPending === "PAY_OUT"} disabled={offline || !canPayOut || !matches || note.trim().length < 2} onPress={() => void cash("PAY_OUT")} variant="secondary">Pay out</TindioButton>
          </TindioCard>

          <TindioCard description="Closing first checks local transaction custody and confirms the final server checkpoint." title="Close shift">
            <TindioInput editable={!offline && matches} keyboardType="decimal-pad" label="Counted cash" onChangeText={setCountedCash} placeholder="0.00" value={countedCash} />
            <TindioInput editable={!offline && matches} label="Closing note" maxLength={500} onChangeText={setNote} placeholder="Optional closing note" value={note} />
            <TindioButton busy={closing} disabled={offline || !canClose || !matches} onPress={() => void close()} variant="destructive">Close shift</TindioButton>
          </TindioCard>
        </>
      )}

      {message ? <TindioFeedback description={message} kind="review" title="Shift update" /> : null}
    </TindioScreen>
  );
}
