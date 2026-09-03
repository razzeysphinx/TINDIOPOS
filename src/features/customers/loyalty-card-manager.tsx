"use client";

import QRCode from "qrcode";
import { Award, Ban, LoaderCircle, QrCode, RefreshCw, Stamp, TicketCheck } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addLoyaltyCardStampAction,
  claimLoyaltyCardRewardAction,
  issueLoyaltyCardAction,
  revokeLoyaltyCardAction,
  rotateLoyaltyCardQrAction,
} from "@/features/customers/actions";
import type { CustomerActionResult, LoyaltyCard, LoyaltyCardCredential, LoyaltyCardEvent } from "@/features/customers/customer-types";

type CustomerSale = {
  saleId: string;
  receiptNumber: number | null;
  completedAt: string;
  storeName: string;
};

type Message = { ok: boolean; text: string } | null;
type LoyaltyCardMutation = "issue" | "rotate" | "replace" | "revoke" | "stamp" | "claim";

export function LoyaltyCardManager({
  cards,
  customerId,
  customerName,
  events,
  sales,
}: {
  cards: LoyaltyCard[];
  customerId: string;
  customerName: string;
  events: LoyaltyCardEvent[];
  sales: CustomerSale[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingMutation, setPendingMutation] = useState<{ cardId: string | null; type: LoyaltyCardMutation } | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [credential, setCredential] = useState<LoyaltyCardCredential | null>(null);
  const activeCard = useMemo(() => cards.find((card) => card.status === "active") ?? null, [cards]);

  const handleResult = (result: CustomerActionResult<unknown>) => {
    setMessage({ ok: result.ok, text: result.message });
    if (result.ok) router.refresh();
  };

  const runMutation = (type: LoyaltyCardMutation, cardId: string | null, mutation: () => Promise<void>) => {
    setPendingMutation({ cardId, type });
    startTransition(async () => {
      try {
        await mutation();
      } finally {
        setPendingMutation(null);
      }
    });
  };

  const isMutationPending = (type: LoyaltyCardMutation, cardId: string | null) =>
    isPending && pendingMutation?.type === type && pendingMutation.cardId === cardId;

  const isCardPending = (cardId: string) => isPending && pendingMutation?.cardId === cardId;

  const issueCard = (replacesCardId?: string, reason?: string) => {
    setMessage(null);
    runMutation(replacesCardId ? "replace" : "issue", replacesCardId ?? null, async () => {
      const result = await issueLoyaltyCardAction({ customerId, replacesCardId, reason: reason ?? "" });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok && result.data) setCredential(result.data);
      if (result.ok) router.refresh();
    });
  };

  const rotateQr = (cardId: string, reason: string) => {
    setMessage(null);
    runMutation("rotate", cardId, async () => {
      const result = await rotateLoyaltyCardQrAction({ customerId, cardId, reason });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok && result.data) setCredential(result.data);
      if (result.ok) router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><QrCode className="size-5 text-primary" /> QR loyalty card</CardTitle>
          <CardDescription>
            The QR verifies the card only. Stamps, reward claims, and any card replacement stay in TINDIO and are audited.
          </CardDescription>
        </div>
        {!activeCard ? (
          <Button disabled={isMutationPending("issue", null)} onClick={() => issueCard()} type="button">
            {isMutationPending("issue", null) ? <LoaderCircle className="animate-spin" /> : <QrCode />}
            Issue QR card
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {message ? <p className={message.ok ? "rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary" : "rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"}>{message.text}</p> : null}

        {cards.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No QR stamp card has been issued. The existing loyalty-points ledger remains available independently.
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map((card) => (
              <LoyaltyCardRow
                card={card}
                isPending={isCardPending(card.id)}
                key={card.id}
                onClaim={(reason, saleId) => runMutation("claim", card.id, async () => handleResult(await claimLoyaltyCardRewardAction({ customerId, cardId: card.id, reason, saleId })))}
                onReplace={(reason) => issueCard(card.id, reason)}
                onRevoke={(reason) => runMutation("revoke", card.id, async () => handleResult(await revokeLoyaltyCardAction({ customerId, cardId: card.id, reason })))}
                onRotate={(reason) => rotateQr(card.id, reason)}
                onStamp={(reason, saleId) => runMutation("stamp", card.id, async () => handleResult(await addLoyaltyCardStampAction({ customerId, cardId: card.id, reason, saleId })))}
                sales={sales}
              />
            ))}
          </div>
        )}

        {events.length > 0 ? (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">QR card activity</p>
            <ul className="divide-y rounded-lg border text-sm">
              {events.slice(0, 8).map((event) => (
                <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" key={event.id}>
                  <span>
                    <span className="font-medium">{event.eventType.replaceAll("_", " ")}</span>
                    <span className="text-muted-foreground"> · {event.cardCode}</span>
                    {event.reason ? <span className="mt-0.5 block text-xs text-muted-foreground">{event.reason}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {event.eventType === "STAMP_ADDED" ? `${event.stampCountBefore} → ${event.stampCountAfter}` : formatDate(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
      <LoyaltyCardPrintDialog credential={credential} customerName={customerName} onOpenChange={(open) => { if (!open) setCredential(null); }} />
    </Card>
  );
}

function LoyaltyCardRow({
  card,
  isPending,
  onClaim,
  onReplace,
  onRevoke,
  onRotate,
  onStamp,
  sales,
}: {
  card: LoyaltyCard;
  isPending: boolean;
  onClaim: (reason: string, saleId: string) => void;
  onReplace: (reason: string) => void;
  onRevoke: (reason: string) => void;
  onRotate: (reason: string) => void;
  onStamp: (reason: string, saleId: string) => void;
  sales: CustomerSale[];
}) {
  const isActive = card.status === "active";
  const rewardReady = isActive && card.stampCount >= card.stampTarget;

  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold tracking-wide">{card.cardCode}</p>
            <CardStatusBadge status={card.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Issued {formatDate(card.issuedAt)}</p>
        </div>
        <div className="rounded-lg bg-secondary px-3 py-2 text-right">
          <p className="text-lg font-semibold">{card.stampCount} / {card.stampTarget}</p>
          <p className="text-xs text-muted-foreground">stamps</p>
        </div>
      </div>

      {card.deactivationReason ? <p className="mt-3 text-sm text-muted-foreground">{card.deactivationReason}</p> : null}
      {rewardReady ? <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary">Reward ready — record the claim before issuing a replacement card.</p> : null}

      {isActive ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!rewardReady ? <StampDialog cardCode={card.cardCode} disabled={isPending} onSubmit={onStamp} sales={sales} /> : null}
          {rewardReady ? <RewardClaimDialog cardCode={card.cardCode} disabled={isPending} onSubmit={onClaim} sales={sales} /> : null}
          <ReasonDialog buttonLabel="New QR" description="This invalidates every previously printed QR for this card. Use it if the QR was copied or the card needs a fresh print." disabled={isPending} icon={<RefreshCw />} onSubmit={onRotate} title="Rotate QR code" />
          <ReasonDialog buttonLabel="Replace" description="The existing card will be marked as replaced and stop verifying. A new physical QR card will be ready to print." disabled={isPending} icon={<QrCode />} onSubmit={onReplace} title="Replace QR loyalty card" />
          <ReasonDialog buttonLabel="Revoke" description="The QR will stop verifying immediately. This does not delete the card or its audit history." disabled={isPending} icon={<Ban />} onSubmit={onRevoke} title="Revoke QR loyalty card" variant="destructive" />
        </div>
      ) : null}
    </div>
  );
}

function CardStatusBadge({ status }: { status: LoyaltyCard["status"] }) {
  const labels: Record<LoyaltyCard["status"], string> = {
    active: "Active",
    reward_claimed: "Reward claimed",
    revoked: "Revoked",
    replaced: "Replaced",
    expired: "Expired",
  };
  return <Badge variant={status === "active" ? "secondary" : "outline"}>{labels[status]}</Badge>;
}

function ReasonDialog({
  buttonLabel,
  description,
  disabled,
  icon,
  onSubmit,
  title,
  variant = "outline",
}: {
  buttonLabel: string;
  description: string;
  disabled: boolean;
  icon: React.ReactNode;
  onSubmit: (reason: string) => void;
  title: string;
  variant?: "outline" | "destructive";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <DialogTrigger className={buttonVariants({ size: "sm", variant })} disabled={disabled}>{icon}{buttonLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <DialogBody>
          <Label className="grid gap-1.5 text-sm font-medium">Reason<Input autoFocus onChange={(event) => setReason(event.target.value)} value={reason} /></Label>
        </DialogBody>
        <DialogFooter>
          <Button disabled={disabled || reason.trim().length < 2} onClick={() => { onSubmit(reason.trim()); setReason(""); setOpen(false); }} type="button" variant={variant}>{buttonLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

function StampDialog({
  cardCode,
  disabled,
  onSubmit,
  sales,
}: {
  cardCode: string;
  disabled: boolean;
  onSubmit: (reason: string, saleId: string) => void;
  sales: CustomerSale[];
}) {
  const [open, setOpen] = useState(false);
  const [saleId, setSaleId] = useState("");
  const [reason, setReason] = useState("");

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <DialogTrigger className={buttonVariants({ size: "sm" })} disabled={disabled}><Stamp />Add stamp</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add loyalty stamp</DialogTitle><DialogDescription>Scan-verified card {cardCode}. Link a completed sale when available; a manual stamp must state why.</DialogDescription></DialogHeader>
        <DialogBody>
          <div className="grid gap-4">
            <Label className="grid gap-1.5 text-sm font-medium">Completed sale (optional)
              <select className="h-9 rounded-lg border bg-background px-3 text-sm" onChange={(event) => setSaleId(event.target.value)} value={saleId}>
                <option value="">Manual stamp — no completed sale</option>
                {sales.map((sale) => <option key={sale.saleId} value={sale.saleId}>{sale.receiptNumber ? `Receipt #${sale.receiptNumber}` : "Completed sale"} · {sale.storeName}</option>)}
              </select>
            </Label>
            <Label className="grid gap-1.5 text-sm font-medium">Reason {saleId ? <span className="font-normal text-muted-foreground">(optional)</span> : <span className="font-normal text-destructive">(required)</span>}
              <Input onChange={(event) => setReason(event.target.value)} placeholder={saleId ? "Optional note" : "Why is a stamp being added without a sale?"} value={reason} />
            </Label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button disabled={disabled || (!saleId && reason.trim().length < 2)} onClick={() => { onSubmit(reason.trim(), saleId); setReason(""); setSaleId(""); setOpen(false); }} type="button"><Stamp />Record stamp</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

function RewardClaimDialog({
  cardCode,
  disabled,
  onSubmit,
  sales,
}: {
  cardCode: string;
  disabled: boolean;
  onSubmit: (reason: string, saleId: string) => void;
  sales: CustomerSale[];
}) {
  const [open, setOpen] = useState(false);
  const [saleId, setSaleId] = useState("");
  const [reason, setReason] = useState("");

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <DialogTrigger className={buttonVariants({ size: "sm" })} disabled={disabled}><Award />Claim reward</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record reward claim</DialogTitle><DialogDescription>Card {cardCode} has reached its target. This records one claim only; it does not automatically discount a sale.</DialogDescription></DialogHeader>
        <DialogBody>
          <div className="grid gap-4">
            <Label className="grid gap-1.5 text-sm font-medium">Completed sale (optional)
              <select className="h-9 rounded-lg border bg-background px-3 text-sm" onChange={(event) => setSaleId(event.target.value)} value={saleId}>
                <option value="">No sale linked</option>
                {sales.map((sale) => <option key={sale.saleId} value={sale.saleId}>{sale.receiptNumber ? `Receipt #${sale.receiptNumber}` : "Completed sale"} · {sale.storeName}</option>)}
              </select>
            </Label>
            <Label className="grid gap-1.5 text-sm font-medium">Claim note<Input autoFocus onChange={(event) => setReason(event.target.value)} placeholder="e.g. Free drink issued" value={reason} /></Label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button disabled={disabled || reason.trim().length < 2} onClick={() => { onSubmit(reason.trim(), saleId); setReason(""); setSaleId(""); setOpen(false); }} type="button"><TicketCheck />Record claim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

function LoyaltyCardPrintDialog({
  credential,
  customerName,
  onOpenChange,
}: {
  credential: LoyaltyCardCredential | null;
  customerName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const value = credential && typeof window !== "undefined"
    ? `${window.location.origin}/loyalty/verify/${credential.cardId}?token=${credential.verificationToken}`
    : "";

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={Boolean(credential)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Print QR loyalty card</DialogTitle><DialogDescription>The QR is ready once only in this session. Print or save it now; rotating later invalidates this QR.</DialogDescription></DialogHeader>
        <DialogBody>
          {credential && value ? (
            <div className="mx-auto grid max-w-xs gap-3 rounded-xl border bg-secondary/20 p-5 text-center">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-primary">TINDIO LOYALTY</p>
              <QrGraphic value={value} />
              <p className="font-mono text-sm font-semibold tracking-wide">{credential.cardCode}</p>
              <p className="text-sm font-medium">{customerName}</p>
              <p className="text-xs text-muted-foreground">Scan to verify this card’s live stamp count.</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">Preparing QR code…</p>}
        </DialogBody>
        <DialogFooter>
          <Button disabled={!credential || !value} onClick={() => { if (credential && value) void printLoyaltyCard({ cardCode: credential.cardCode, customerName, value }); }} type="button" variant="outline">Print card</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}

function QrGraphic({ value }: { value: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toString(value, { errorCorrectionLevel: "M", margin: 1, type: "svg", width: 240 }).then((nextSvg) => {
      if (active) setSvg(nextSvg);
    });
    return () => { active = false; };
  }, [value]);

  return svg ? <div aria-label="Scannable QR loyalty card" className="mx-auto aspect-square w-48" dangerouslySetInnerHTML={{ __html: svg }} role="img" /> : <LoaderCircle className="mx-auto size-10 animate-spin text-muted-foreground" />;
}

async function printLoyaltyCard({ cardCode, customerName, value }: { cardCode: string; customerName: string; value: string }) {
  const popup = window.open("", "tindio-loyalty-card", "popup,width=420,height=560");
  if (!popup) return;
  popup.opener = null;
  const svg = await QRCode.toString(value, { errorCorrectionLevel: "M", margin: 1, type: "svg", width: 280 });
  popup.document.write(`<!doctype html><html><head><title>TINDIO loyalty card</title><style>body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#10251e}.card{width:280px;border:1px solid #d1d5db;border-radius:16px;padding:20px;text-align:center}.brand{color:#008060;font-size:11px;font-weight:700;letter-spacing:2px}.code{font-family:monospace;font-weight:700;letter-spacing:1px}.hint{color:#52645d;font-size:12px;line-height:1.5}</style></head><body><div class="card"><p class="brand">TINDIO LOYALTY</p>${svg}<p class="code">${escapeHtml(cardCode)}</p><p>${escapeHtml(customerName)}</p><p class="hint">Scan to verify the live stamp count.</p></div><script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
