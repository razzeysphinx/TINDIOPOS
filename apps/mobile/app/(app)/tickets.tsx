import { useCallback, useEffect, useMemo, useState } from "react";

import type { PosOpenTicket } from "../../../../src/contracts/pos";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { cancelPosV2Ticket, fetchPosV2Live, mergePosV2Ticket, movePosV2TicketLines, splitPosV2Ticket } from "../../src/lib/tindio-api";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioListItem, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

type TicketAction = "cancel" | "split" | "merge" | "move";

export default function Tickets() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);
  const [tickets, setTickets] = useState<PosOpenTicket[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [splitLabel, setSplitLabel] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<TicketAction | null>(null);
  const core = data?.core;
  const binding = terminal.identity?.binding;
  const credential = terminal.identity?.credential;
  const enabled = Boolean(core && cashierFeatureGates(core).tickets);

  const load = useCallback(async () => {
    if (!core || !binding || mode !== "online") return;
    setLoading(true);
    try {
      const live = await fetchPosV2Live(core.organization.id, binding);
      setTickets(live.live.openTickets);
      setMessage("Open tickets are up to date.");
    } catch {
      setMessage("Open tickets could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [binding, core, mode]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [enabled, load]);

  const source = tickets.find((ticket) => ticket.id === sourceId) ?? null;
  const selectedLines = useMemo(() => (source?.cart ?? []).flatMap((line) =>
    line.ticketLineId && selectedLineIds.includes(line.ticketLineId)
      ? [{ ticketLineId: line.ticketLineId, quantity: line.quantity }]
      : [],
  ), [selectedLineIds, source]);

  if (!enabled) return <TindioScreen><TindioFeedback description="This feature is disabled or your role does not include ticket operations." kind="restriction" title="Open tickets unavailable" /></TindioScreen>;
  if (!core || !binding || !credential) return <TindioScreen><TindioFeedback description="Enroll and assign this terminal before managing tickets." kind="restriction" title="Terminal assignment required" /></TindioScreen>;

  const toggleLine = (ticketLineId: string) => setSelectedLineIds((current) => current.includes(ticketLineId) ? current.filter((id) => id !== ticketLineId) : [...current, ticketLineId]);
  const afterMutation = async (result: { ok: boolean; message: string }) => {
    setMessage(result.message);
    if (result.ok) { setSelectedLineIds([]); await load(); }
  };
  const runAction = async (action: TicketAction, operation: () => Promise<{ ok: boolean; message: string }>, failure: string) => {
    if (pendingAction) return;
    setPendingAction(action);
    try { await afterMutation(await operation()); } catch { setMessage(failure); } finally { setPendingAction(null); }
  };
  const cancel = async () => {
    if (mode !== "online" || !sourceId) return;
    await runAction("cancel", () => cancelPosV2Ticket(core.organization.id, { ticketId: sourceId, device: credential }), "Ticket cancellation could not be confirmed.");
  };
  const split = async () => {
    if (mode !== "online" || !sourceId || !splitLabel.trim() || selectedLines.length === 0) return;
    await runAction("split", () => splitPosV2Ticket(core.organization.id, { sourceTicketId: sourceId, label: splitLabel.trim(), lines: selectedLines, device: credential }), "Ticket split could not be confirmed.");
  };
  const merge = async () => {
    if (mode !== "online" || !sourceId || !destinationId || sourceId === destinationId) return;
    await runAction("merge", () => mergePosV2Ticket(core.organization.id, { sourceTicketId: sourceId, destinationTicketId: destinationId, device: credential }), "Ticket merge could not be confirmed.");
  };
  const move = async () => {
    if (mode !== "online" || !sourceId || !destinationId || sourceId === destinationId || selectedLines.length === 0) return;
    await runAction("move", () => movePosV2TicketLines(core.organization.id, { sourceTicketId: sourceId, destinationTicketId: destinationId, lines: selectedLines, device: credential }), "Ticket line move could not be confirmed.");
  };

  return (
    <TindioScreen scroll testID="tickets-workspace">
      <TindioWorkspaceHeader description="Select a source ticket, then safely split, move, merge, or cancel it." eyebrow="OPEN TICKETS" title="Ticket workspace" trailing={<TindioStatusBadge label={mode === "online" ? "Online" : "Connection required"} tone={mode === "online" ? "success" : "warning"} />} />
      {mode !== "online" ? <TindioFeedback description="Ticket operations require a connection and are never queued offline." kind="restriction" title="Tickets are online only" /> : null}
      <TindioButton busy={loading} disabled={mode !== "online"} onPress={() => void load()} variant="secondary">Refresh open tickets</TindioButton>

      <TindioWorkspaceSection description="Choose the ticket you want to change." title="Source ticket">
        {tickets.length ? tickets.map((ticket) => <TindioListItem detail={`${ticket.cart.length} line${ticket.cart.length === 1 ? "" : "s"}`} key={ticket.id} onPress={() => { setSourceId(ticket.id); setDestinationId(""); setSelectedLineIds([]); }} selected={sourceId === ticket.id} title={ticket.label} />) : <TindioFeedback description="No open tickets are available for this register." kind="empty" title="No open tickets" />}
      </TindioWorkspaceSection>

      {source ? (
        <TindioWorkspaceSection description="Select only the lines that should be split or moved." title="Source lines">
          {source.cart.map((line) => line.ticketLineId
            ? <TindioListItem detail={`Quantity ${line.quantity}`} key={line.ticketLineId} onPress={() => toggleLine(line.ticketLineId!)} selected={selectedLineIds.includes(line.ticketLineId)} title={line.productName} />
            : <TindioFeedback description={`${line.productName} cannot be selected because its ticket-line identity is unavailable.`} key={`${line.productId}:${line.variantId ?? "simple"}`} kind="restriction" title="Line unavailable" />)}
        </TindioWorkspaceSection>
      ) : null}

      {source ? (
        <TindioWorkspaceSection description="Required for move and merge actions." title="Destination ticket">
          {tickets.filter((ticket) => ticket.id !== sourceId).map((ticket) => <TindioListItem key={ticket.id} onPress={() => setDestinationId(ticket.id)} selected={destinationId === ticket.id} title={ticket.label} />)}
        </TindioWorkspaceSection>
      ) : null}

      <TindioCard description="Destructive and structural actions remain disabled until their required selections are complete." title="Ticket actions">
        <TindioInput label="New split ticket label" maxLength={100} onChangeText={setSplitLabel} placeholder="Ticket label" value={splitLabel} />
        <TindioButton busy={pendingAction === "split"} disabled={!sourceId || selectedLines.length === 0 || !splitLabel.trim() || mode !== "online"} onPress={() => void split()}>Split selected lines</TindioButton>
        <TindioButton busy={pendingAction === "move"} disabled={!sourceId || !destinationId || sourceId === destinationId || selectedLines.length === 0 || mode !== "online"} onPress={() => void move()} variant="secondary">Move selected lines</TindioButton>
        <TindioButton busy={pendingAction === "merge"} disabled={!sourceId || !destinationId || sourceId === destinationId || mode !== "online"} onPress={() => void merge()} variant="secondary">Merge source into destination</TindioButton>
        <TindioButton busy={pendingAction === "cancel"} disabled={!sourceId || mode !== "online"} onPress={() => void cancel()} variant="destructive">Cancel source ticket</TindioButton>
      </TindioCard>

      {message ? <TindioFeedback description={message} kind="review" title="Ticket update" /> : null}
    </TindioScreen>
  );
}
