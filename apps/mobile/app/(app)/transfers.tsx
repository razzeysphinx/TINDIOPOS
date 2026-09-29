import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { PosIncomingTransfer } from "../../../../src/contracts/pos";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import {
  fetchPosV2Live,
  receivePosV2StockRequest,
  receivePosV2Transfer,
} from "../../src/lib/tindio-api";

type QuantityState = Record<
  string,
  {
    receivedQuantity: string;
    shortQuantity: string;
    discrepancyNote: string;
  }
>;

export default function Transfers() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);

  const [transfers, setTransfers] = useState<PosIncomingTransfer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [quantities, setQuantities] = useState<QuantityState>({});
  const [note, setNote] = useState("");
  const [operationId, setOperationId] = useState(() => Crypto.randomUUID());
  const [message, setMessage] = useState("");

  const core = data?.core;
  const binding = terminal.identity?.binding;
  const enabled = Boolean(core && cashierFeatureGates(core).transfers);

  const load = useCallback(async () => {
    if (!core || !binding || mode !== "online") return;

    try {
      const live = await fetchPosV2Live(core.organization.id, binding);
      setTransfers(live.live.incomingTransfers);
      setMessage("Incoming transfers loaded.");
    } catch {
      setMessage("Incoming transfers could not be loaded.");
    }
  }, [binding, core, mode]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [enabled, load]);

  if (!enabled) return <Text>Incoming transfers unavailable.</Text>;
  if (!core || !binding) return <Text>Transfer receiving requires an enrolled terminal.</Text>;

  const selected = transfers.find((transfer) => transfer.id === selectedId) ?? null;

  const chooseTransfer = (transfer: PosIncomingTransfer) => {
    setSelectedId(transfer.id);
    setOperationId(Crypto.randomUUID());
    setNote("");
    setQuantities(
      Object.fromEntries(
        transfer.lines.map((line) => [
          line.id,
          {
            receivedQuantity: String(
              Math.max(0, line.quantity - line.receivedQuantity),
            ),
            shortQuantity: "0",
            discrepancyNote: "",
          },
        ]),
      ),
    );
  };

  const receive = async () => {
    if (!selected || mode !== "online") return;

    const lines = selected.lines.map((line) => {
      const state = quantities[line.id] ?? {
        receivedQuantity: "0",
        shortQuantity: "0",
        discrepancyNote: "",
      };

      return {
        stockTransferLineId: line.id,
        receivedQuantity: state.receivedQuantity,
        shortQuantity: state.shortQuantity,
        discrepancyNote: state.discrepancyNote.trim(),
      };
    });

    const hasInvalidShortage = lines.some(
      (line) =>
        Number(line.shortQuantity) > 0
        && line.discrepancyNote.length < 2,
    );

    if (hasInvalidShortage) {
      setMessage("Explain every shortage/discrepancy before receiving.");
      return;
    }

    const input = {
      operationId,
      note: note.trim(),
      lines,
    };

    try {
      const result = selected.stockRequestId
        ? await receivePosV2StockRequest(
            core.organization.id,
            selected.stockRequestId,
            input,
          )
        : await receivePosV2Transfer(
            core.organization.id,
            selected.id,
            input,
          );

      setMessage(result.message);

      if (result.ok) {
        setSelectedId("");
        setQuantities({});
        setNote("");
        setOperationId(Crypto.randomUUID());
        await load();
      }
    } catch {
      setMessage(
        "Transfer receipt status is unknown. Retry the unchanged receipt to reuse the same operation ID.",
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Incoming transfers — ONLINE ONLY</Text>

      <Pressable disabled={mode !== "online"} onPress={() => void load()}>
        <Text>Refresh incoming transfers</Text>
      </Pressable>

      {transfers.map((transfer) => (
        <Pressable key={transfer.id} onPress={() => chooseTransfer(transfer)}>
          <Text>
            {selectedId === transfer.id ? "✓ " : ""}
            Transfer #{transfer.transferNumber}
            {" — "}
            {transfer.sourceStoreName}
            {" → "}
            {transfer.destinationStoreName}
            {transfer.stockRequestId ? " — request-backed" : ""}
          </Text>
        </Pressable>
      ))}

      {selected ? (
        <>
          <Text>Transfer #{selected.transferNumber}</Text>

          {selected.lines.map((line) => {
            const state = quantities[line.id] ?? {
              receivedQuantity: "0",
              shortQuantity: "0",
              discrepancyNote: "",
            };

            return (
              <View key={line.id}>
                <Text>
                  {line.label}
                  {" — ordered "}
                  {line.quantity}
                  {" — already received "}
                  {line.receivedQuantity}
                  {" "}
                  {line.unit}
                </Text>

                <TextInput
                  value={state.receivedQuantity}
                  onChangeText={(value) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: {
                        ...state,
                        receivedQuantity: value,
                      },
                    }))
                  }
                  keyboardType="decimal-pad"
                  placeholder="Received quantity"
                />

                <TextInput
                  value={state.shortQuantity}
                  onChangeText={(value) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: {
                        ...state,
                        shortQuantity: value,
                      },
                    }))
                  }
                  keyboardType="decimal-pad"
                  placeholder="Short quantity"
                />

                <TextInput
                  value={state.discrepancyNote}
                  onChangeText={(value) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: {
                        ...state,
                        discrepancyNote: value,
                      },
                    }))
                  }
                  maxLength={500}
                  placeholder="Discrepancy note"
                />
              </View>
            );
          })}

          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={500}
            placeholder="Receipt note"
          />

          <Pressable disabled={mode !== "online"} onPress={() => void receive()}>
            <Text>Post transfer receipt</Text>
          </Pressable>
        </>
      ) : null}

      <Text>{message}</Text>
    </ScrollView>
  );
}
