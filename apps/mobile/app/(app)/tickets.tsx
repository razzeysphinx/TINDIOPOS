import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { PosOpenTicket } from "../../../../src/contracts/pos";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import {
  cancelPosV2Ticket,
  fetchPosV2Live,
  mergePosV2Ticket,
  movePosV2TicketLines,
  splitPosV2Ticket,
} from "../../src/lib/tindio-api";

export default function Tickets() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);

  const [tickets, setTickets] = useState<PosOpenTicket[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [splitLabel, setSplitLabel] = useState("");
  const [message, setMessage] = useState("");

  const core = data?.core;
  const binding = terminal.identity?.binding;
  const credential = terminal.identity?.credential;
  const enabled = Boolean(core && cashierFeatureGates(core).tickets);

  const load = useCallback(async () => {
    if (!core || !binding || mode !== "online") return;

    try {
      const live = await fetchPosV2Live(core.organization.id, binding);
      setTickets(live.live.openTickets);
      setMessage("Open tickets loaded.");
    } catch {
      setMessage("Open tickets could not be loaded.");
    }
  }, [binding, core, mode]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [enabled, load]);

  if (!enabled) {
    return <Text>Tickets disabled by feature or permission.</Text>;
  }

  if (!core || !binding || !credential) {
    return <Text>Ticket operations require an enrolled terminal.</Text>;
  }

  const source = tickets.find((ticket) => ticket.id === sourceId) ?? null;

  const selectedLines = useMemo(
    () =>
      (source?.cart ?? []).flatMap((line) =>
        line.ticketLineId && selectedLineIds.includes(line.ticketLineId)
          ? [{
              ticketLineId: line.ticketLineId,
              quantity: line.quantity,
            }]
          : [],
      ),
    [selectedLineIds, source],
  );

  const toggleLine = (ticketLineId: string) => {
    setSelectedLineIds((current) =>
      current.includes(ticketLineId)
        ? current.filter((id) => id !== ticketLineId)
        : [...current, ticketLineId],
    );
  };

  const afterMutation = async (result: { ok: boolean; message: string }) => {
    setMessage(result.message);

    if (result.ok) {
      setSelectedLineIds([]);
      await load();
    }
  };

  const cancel = async () => {
    if (mode !== "online" || !sourceId) return;

    try {
      await afterMutation(
        await cancelPosV2Ticket(core.organization.id, {
          ticketId: sourceId,
          device: credential,
        }),
      );
    } catch {
      setMessage("Ticket cancellation could not be confirmed.");
    }
  };

  const split = async () => {
    if (
      mode !== "online"
      || !sourceId
      || !splitLabel.trim()
      || selectedLines.length === 0
    ) return;

    try {
      await afterMutation(
        await splitPosV2Ticket(core.organization.id, {
          sourceTicketId: sourceId,
          label: splitLabel.trim(),
          lines: selectedLines,
          device: credential,
        }),
      );
    } catch {
      setMessage("Ticket split could not be confirmed.");
    }
  };

  const merge = async () => {
    if (
      mode !== "online"
      || !sourceId
      || !destinationId
      || sourceId === destinationId
    ) return;

    try {
      await afterMutation(
        await mergePosV2Ticket(core.organization.id, {
          sourceTicketId: sourceId,
          destinationTicketId: destinationId,
          device: credential,
        }),
      );
    } catch {
      setMessage("Ticket merge could not be confirmed.");
    }
  };

  const move = async () => {
    if (
      mode !== "online"
      || !sourceId
      || !destinationId
      || sourceId === destinationId
      || selectedLines.length === 0
    ) return;

    try {
      await afterMutation(
        await movePosV2TicketLines(core.organization.id, {
          sourceTicketId: sourceId,
          destinationTicketId: destinationId,
          lines: selectedLines,
          device: credential,
        }),
      );
    } catch {
      setMessage("Ticket line move could not be confirmed.");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Open tickets — ONLINE ONLY</Text>

      <Pressable disabled={mode !== "online"} onPress={() => void load()}>
        <Text>Refresh open tickets</Text>
      </Pressable>

      <Text>SOURCE TICKET</Text>

      {tickets.map((ticket) => (
        <Pressable
          key={ticket.id}
          onPress={() => {
            setSourceId(ticket.id);
            setSelectedLineIds([]);
          }}
        >
          <Text>
            {sourceId === ticket.id ? "✓ " : ""}
            {ticket.label} — {ticket.cart.length} line(s)
          </Text>
        </Pressable>
      ))}

      {source ? (
        <>
          <Text>SELECT SOURCE LINES</Text>
          {source.cart.map((line) =>
            line.ticketLineId ? (
              <Pressable
                key={line.ticketLineId}
                onPress={() => toggleLine(line.ticketLineId!)}
              >
                <Text>
                  {selectedLineIds.includes(line.ticketLineId) ? "✓ " : ""}
                  {line.productName} — {line.quantity}
                </Text>
              </Pressable>
            ) : (
              <Text key={`${line.productId}:${line.variantId ?? "simple"}`}>
                {line.productName} — line identity unavailable
              </Text>
            ),
          )}
        </>
      ) : null}

      <Text>DESTINATION TICKET</Text>

      {tickets
        .filter((ticket) => ticket.id !== sourceId)
        .map((ticket) => (
          <Pressable
            key={ticket.id}
            onPress={() => setDestinationId(ticket.id)}
          >
            <Text>
              {destinationId === ticket.id ? "✓ " : ""}
              {ticket.label}
            </Text>
          </Pressable>
        ))}

      <TextInput
        value={splitLabel}
        onChangeText={setSplitLabel}
        placeholder="New split ticket label"
        maxLength={100}
      />

      <Pressable disabled={!sourceId || mode !== "online"} onPress={() => void cancel()}>
        <Text>Cancel source ticket</Text>
      </Pressable>

      <Pressable
        disabled={
          !sourceId
          || selectedLines.length === 0
          || !splitLabel.trim()
          || mode !== "online"
        }
        onPress={() => void split()}
      >
        <Text>Split selected lines</Text>
      </Pressable>

      <Pressable
        disabled={
          !sourceId
          || !destinationId
          || sourceId === destinationId
          || mode !== "online"
        }
        onPress={() => void merge()}
      >
        <Text>Merge source into destination</Text>
      </Pressable>

      <Pressable
        disabled={
          !sourceId
          || !destinationId
          || sourceId === destinationId
          || selectedLines.length === 0
          || mode !== "online"
        }
        onPress={() => void move()}
      >
        <Text>Move selected lines</Text>
      </Pressable>

      <Text>{message}</Text>
    </ScrollView>
  );
}
