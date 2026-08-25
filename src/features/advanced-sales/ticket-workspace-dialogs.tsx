"use client";

import { type ReactNode, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  mergeOpenTicketsAction,
  moveOpenTicketLinesAction,
  splitOpenTicketAction,
} from "@/features/advanced-sales/ticket-actions";
import type {
  PosOpenTicket,
  PosTicketAssignee,
  PosTicketTemplate,
} from "@/features/pos/pos-types";
import type { PosDeviceCredential } from "@/features/devices/device-schema";

const selectClassName =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type TicketSaveValues = {
  label: string;
  note: string;
  diningOptionId: string | null;
  assignedEmployeeId: string | null;
};

export function TicketSaveDialog({
  assignees,
  canAssign,
  diningOptions,
  onClose,
  onSave,
  templates,
  ticket,
}: {
  assignees: PosTicketAssignee[];
  canAssign: boolean;
  diningOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (values: TicketSaveValues) => void;
  templates: PosTicketTemplate[];
  ticket: PosOpenTicket | null;
}) {
  const [label, setLabel] = useState(ticket?.label ?? "Open ticket");
  const [note, setNote] = useState(ticket?.note ?? "");
  const [diningOptionId, setDiningOptionId] = useState(ticket?.diningOptionId ?? "");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(ticket?.assignedEmployeeId ?? "");

  const applyTemplate = (templateId: string) => {
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template) return;
    setLabel(template.label);
    setNote(template.note ?? "");
    setDiningOptionId(template.diningOptionId ?? "");
  };

  return <Modal onClose={onClose} title={ticket ? "Update ticket" : "Hold ticket"}>
    <form className="grid gap-4" onSubmit={(event) => {
      event.preventDefault();
      if (!label.trim()) return;
      onSave({
        label: label.trim(),
        note: note.trim(),
        diningOptionId: diningOptionId || null,
        assignedEmployeeId: assignedEmployeeId || null,
      });
    }}>
      {templates.length > 0 && !ticket ? <label className="grid gap-1 text-sm font-medium">Start from a template
        <select className={selectClassName} defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
          <option value="">Custom ticket</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
        </select>
      </label> : null}
      <label className="grid gap-1 text-sm font-medium">Ticket name
        <Input autoFocus maxLength={100} onChange={(event) => setLabel(event.target.value)} value={label} />
      </label>
      <label className="grid gap-1 text-sm font-medium">Order note
        <textarea className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm" maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Whole-order instructions, such as 'serve together'" value={note} />
      </label>
      <label className="grid gap-1 text-sm font-medium">Dining option
        <select className={selectClassName} onChange={(event) => setDiningOptionId(event.target.value)} value={diningOptionId}>
          <option value="">No dining option</option>
          {diningOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      {canAssign ? <label className="grid gap-1 text-sm font-medium">Assigned employee
        <select className={selectClassName} onChange={(event) => setAssignedEmployeeId(event.target.value)} value={assignedEmployeeId}>
          <option value="">Current cashier</option>
          {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.fullName}</option>)}
        </select>
      </label> : null}
      <div className="flex justify-end gap-2"><Button onClick={onClose} type="button" variant="outline">Cancel</Button><Button type="submit">{ticket ? "Save ticket" : "Hold ticket"}</Button></div>
    </form>
  </Modal>;
}

export function TicketOperationsDialog({
  onClose,
  onComplete,
  device,
  tickets,
}: {
  onClose: () => void;
  onComplete: (message: string) => void;
  device: PosDeviceCredential | null;
  tickets: PosOpenTicket[];
}) {
  const [sourceTicketId, setSourceTicketId] = useState(tickets[0]?.id ?? "");
  const [destinationTicketId, setDestinationTicketId] = useState(tickets[1]?.id ?? "");
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [splitLabel, setSplitLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sourceTicket = tickets.find((ticket) => ticket.id === sourceTicketId) ?? null;
  const destinationTickets = tickets.filter((ticket) => ticket.id !== sourceTicketId);
  const selectedLines = useMemo(() => sourceTicket?.cart.flatMap((line) => line.ticketLineId && selectedLineIds.includes(line.ticketLineId)
    ? [{ ticketLineId: line.ticketLineId, quantity: line.quantity }]
    : []) ?? [], [selectedLineIds, sourceTicket]);

  const run = (operation: "move" | "split" | "merge") => {
    if (!sourceTicketId || !destinationTicketId) return;
    startTransition(async () => {
      const result = operation === "move"
        ? await moveOpenTicketLinesAction({ sourceTicketId, destinationTicketId, lines: selectedLines, device })
        : operation === "split"
          ? await splitOpenTicketAction({ sourceTicketId, label: splitLabel, lines: selectedLines, device })
          : await mergeOpenTicketsAction({ sourceTicketId, destinationTicketId, device });
      setMessage(result.message);
      if (result.ok) onComplete(result.message);
    });
  };

  return <Modal onClose={onClose} title="Manage open tickets">
    <div className="grid gap-4">
      <p className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm text-muted-foreground">Move items, split ticket, and merge ticket change open tickets. They do not split a payment—use <strong className="text-foreground">Split payment</strong> after selecting Charge.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Source ticket
          <select className={selectClassName} onChange={(event) => { const nextSourceId = event.target.value; setSourceTicketId(nextSourceId); setDestinationTicketId((current) => current !== nextSourceId ? current : tickets.find((ticket) => ticket.id !== nextSourceId)?.id ?? ""); setSelectedLineIds([]); }} value={sourceTicketId}>
            {tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Destination ticket
          <select className={selectClassName} onChange={(event) => setDestinationTicketId(event.target.value)} value={destinationTicketId}>
            {destinationTickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.label}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="grid gap-2"><legend className="text-sm font-medium">Items to move or split</legend>
        {sourceTicket?.cart.map((line) => line.ticketLineId ? <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm" key={line.ticketLineId}>
          <span className="min-w-0"><input checked={selectedLineIds.includes(line.ticketLineId)} className="mr-2" onChange={() => setSelectedLineIds((current) => current.includes(line.ticketLineId!) ? current.filter((id) => id !== line.ticketLineId) : [...current, line.ticketLineId!])} type="checkbox" />{line.productName} × {line.quantity}{line.itemNote ? <span className="block pl-5 text-xs text-muted-foreground">Note: {line.itemNote}</span> : null}</span>
        </label> : null)}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><Input maxLength={100} onChange={(event) => setSplitLabel(event.target.value)} placeholder="New split ticket name" value={splitLabel}/><Button disabled={pending || selectedLines.length === 0 || !splitLabel.trim()} onClick={() => run("split")} type="button" variant="outline">Split selected</Button><Button disabled={pending || selectedLines.length === 0 || !destinationTicketId} onClick={() => run("move")} type="button" variant="outline">Move selected</Button></div>
      <div className="flex items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-muted-foreground">Merge moves all items from the source into the destination.</p><Button disabled={pending || !destinationTicketId} onClick={() => run("merge")} type="button" variant="destructive">Merge tickets</Button></div>
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  </Modal>;
}

function Modal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><section aria-modal="true" className="max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-background p-5 shadow-xl" role="dialog"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><Button aria-label="Close" onClick={onClose} size="icon-xs" type="button" variant="ghost">×</Button></div>{children}</section></div>;
}
