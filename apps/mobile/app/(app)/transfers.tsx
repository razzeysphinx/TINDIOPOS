import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";

import type { PosIncomingTransfer } from "@tindio/contracts";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { fetchPosV2Live, receivePosV2StockRequest, receivePosV2Transfer } from "../../src/lib/tindio-api";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioListItem, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

type QuantityState = Record<string, { receivedQuantity: string; shortQuantity: string; discrepancyNote: string }>;

export default function Transfers() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);
  const [transfers, setTransfers] = useState<PosIncomingTransfer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [quantities, setQuantities] = useState<QuantityState>({});
  const [note, setNote] = useState("");
  const [operationId, setOperationId] = useState(() => Crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const core = data?.core;
  const binding = terminal.identity?.binding;
  const enabled = Boolean(core && cashierFeatureGates(core).transfers);

  const load = useCallback(async () => {
    if (!core || !binding || mode !== "online") return;
    setLoading(true);
    try {
      const live = await fetchPosV2Live(core.organization.id, binding);
      setTransfers(live.live.incomingTransfers);
      setMessage("Incoming transfers are up to date.");
    } catch {
      setMessage("Incoming transfers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [binding, core, mode]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [enabled, load]);

  if (!enabled) return <TindioScreen><TindioFeedback description="This feature is disabled or your role does not include transfer receiving." kind="restriction" title="Incoming transfers unavailable" /></TindioScreen>;
  if (!core || !binding) return <TindioScreen><TindioFeedback description="Enroll and assign this terminal before receiving stock." kind="restriction" title="Terminal assignment required" /></TindioScreen>;

  const selected = transfers.find((transfer) => transfer.id === selectedId) ?? null;
  const chooseTransfer = (transfer: PosIncomingTransfer) => {
    setSelectedId(transfer.id);
    setOperationId(Crypto.randomUUID());
    setNote("");
    setQuantities(Object.fromEntries(transfer.lines.map((line) => [line.id, {
      receivedQuantity: String(Math.max(0, line.quantity - line.receivedQuantity)), shortQuantity: "0", discrepancyNote: "",
    }])));
  };
  const updateLine = (lineId: string, field: "receivedQuantity" | "shortQuantity" | "discrepancyNote", value: string) => {
    setQuantities((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? { receivedQuantity: "0", shortQuantity: "0", discrepancyNote: "" }), [field]: value } }));
  };

  const receive = async () => {
    if (receiving || !selected || mode !== "online") return;
    const lines = selected.lines.map((line) => {
      const state = quantities[line.id] ?? { receivedQuantity: "0", shortQuantity: "0", discrepancyNote: "" };
      return { stockTransferLineId: line.id, receivedQuantity: state.receivedQuantity, shortQuantity: state.shortQuantity, discrepancyNote: state.discrepancyNote.trim() };
    });
    if (lines.some((line) => Number(line.shortQuantity) > 0 && line.discrepancyNote.length < 2)) {
      setMessage("Explain every shortage or discrepancy before receiving.");
      return;
    }
    const input = { operationId, note: note.trim(), lines };
    setReceiving(true);
    try {
      const result = selected.stockRequestId
        ? await receivePosV2StockRequest(core.organization.id, selected.stockRequestId, input)
        : await receivePosV2Transfer(core.organization.id, selected.id, input);
      setMessage(result.message);
      if (result.ok) {
        setSelectedId(""); setQuantities({}); setNote(""); setOperationId(Crypto.randomUUID()); await load();
      }
    } catch {
      setMessage("Transfer receipt status is unknown. Retry the unchanged receipt to reuse the same operation ID.");
    } finally {
      setReceiving(false);
    }
  };

  return (
    <TindioScreen scroll testID="transfers-workspace">
      <TindioWorkspaceHeader description="Review expected quantities, record shortages, and post one authoritative receipt." eyebrow="INVENTORY" title="Incoming transfers" trailing={<TindioStatusBadge label={mode === "online" ? "Online" : "Connection required"} tone={mode === "online" ? "success" : "warning"} />} />
      {mode !== "online" ? <TindioFeedback description="Transfer receiving requires a connection and is never queued offline." kind="restriction" title="Receiving is online only" /> : null}
      <TindioButton busy={loading} disabled={mode !== "online"} onPress={() => void load()} variant="secondary">Refresh incoming transfers</TindioButton>

      <TindioWorkspaceSection description="Select the shipment or request you are physically receiving." title="Awaiting receipt">
        {transfers.length ? transfers.map((transfer) => (
          <TindioListItem
            detail={`${transfer.sourceStoreName} to ${transfer.destinationStoreName}${transfer.stockRequestId ? " / Request-backed" : ""}`}
            key={transfer.id}
            meta={`${transfer.lines.length} line${transfer.lines.length === 1 ? "" : "s"}`}
            onPress={() => chooseTransfer(transfer)}
            selected={selectedId === transfer.id}
            title={`Transfer #${transfer.transferNumber}`}
          />
        )) : <TindioFeedback description="No incoming transfers are waiting for this store." kind="empty" title="Nothing to receive" />}
      </TindioWorkspaceSection>

      {selected ? (
        <TindioWorkspaceSection description="A shortage requires a plain-language discrepancy note." title={`Transfer #${selected.transferNumber}`}>
          {selected.lines.map((line) => {
            const state = quantities[line.id] ?? { receivedQuantity: "0", shortQuantity: "0", discrepancyNote: "" };
            return (
              <TindioCard description={`Expected ${line.quantity} ${line.unit} / already received ${line.receivedQuantity} ${line.unit}`} key={line.id} title={line.label}>
                <TindioInput accessibilityLabel={`Received quantity for ${line.label}`} keyboardType="decimal-pad" label="Received quantity" onChangeText={(value) => updateLine(line.id, "receivedQuantity", value)} value={state.receivedQuantity} />
                <TindioInput accessibilityLabel={`Short quantity for ${line.label}`} keyboardType="decimal-pad" label="Short quantity" onChangeText={(value) => updateLine(line.id, "shortQuantity", value)} value={state.shortQuantity} />
                <TindioInput accessibilityLabel={`Discrepancy note for ${line.label}`} label="Discrepancy note" maxLength={500} onChangeText={(value) => updateLine(line.id, "discrepancyNote", value)} placeholder="Required when short" value={state.discrepancyNote} />
              </TindioCard>
            );
          })}
          <TindioCard title="Receipt confirmation">
            <TindioInput label="Receipt note" maxLength={500} onChangeText={setNote} placeholder="Optional note" value={note} />
            <TindioButton busy={receiving} disabled={mode !== "online"} onPress={() => void receive()}>Post transfer receipt</TindioButton>
          </TindioCard>
        </TindioWorkspaceSection>
      ) : null}

      {message ? <TindioFeedback description={message} kind="review" title="Transfer update" /> : null}
    </TindioScreen>
  );
}
