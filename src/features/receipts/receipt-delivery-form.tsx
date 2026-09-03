"use client";

import { AtSign, LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { queueReceiptDeliveryAction } from "@/features/receipts/improvement-6-actions";
import { receiptDeliveryRecipientSchema } from "@/features/receipts/improvement-6-schema";

type DeliveryRequest = {
  id: string;
  recipient: string;
  status: string;
  createdAt: string;
};

export function ReceiptDeliveryForm({
  deliveries = [],
  initialRecipient = null,
  onCancel,
  onQueued,
  presentation = "card",
  receiptId,
}: {
  deliveries?: DeliveryRequest[];
  initialRecipient?: string | null;
  onCancel?: () => void;
  onQueued?: (recipient: string) => void;
  presentation?: "card" | "dialog";
  receiptId: string;
}) {
  const router = useRouter();
  const [recipient, setRecipient] = useState(initialRecipient ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitDelivery = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedRecipient = recipient.trim();
    if (!normalizedRecipient) {
      setValidationError("Enter an email address.");
      return;
    }
    if (!receiptDeliveryRecipientSchema.safeParse(normalizedRecipient).success) {
      setValidationError("Enter a valid email address.");
      return;
    }

    setValidationError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await queueReceiptDeliveryAction({
        receiptId,
        recipient: normalizedRecipient,
        idempotencyKey,
      });
      if (!result.ok) {
        setMessage(presentation === "dialog" ? "We couldn't send the digital receipt. Try again." : result.message);
        return;
      }

      setIdempotencyKey(crypto.randomUUID());
      if (presentation === "dialog") {
        onQueued?.(normalizedRecipient);
        return;
      }

      setMessage(result.message);
      router.refresh();
    });
  };

  const emailInput = (
    <Input
      aria-describedby={validationError ? "digital-receipt-email-error" : undefined}
      aria-invalid={Boolean(validationError)}
      aria-label="Email address"
      autoFocus={presentation === "dialog"}
      disabled={isPending}
      id={presentation === "dialog" ? "digital-receipt-email" : undefined}
      maxLength={320}
      onChange={(event) => {
        setRecipient(event.target.value);
        setValidationError(null);
        setMessage(null);
      }}
      placeholder="customer@example.com"
      type="email"
      value={recipient}
    />
  );

  if (presentation === "dialog") {
    return (
      <form className="space-y-4" noValidate onSubmit={submitDelivery}>
        <label className="grid gap-2 text-sm font-medium" htmlFor="digital-receipt-email">
          Email address
          {emailInput}
        </label>
        {validationError ? <p aria-live="polite" className="text-sm text-destructive" id="digital-receipt-email-error" role="status">{validationError}</p> : null}
        {message ? <p aria-live="polite" className="text-sm text-destructive" role="status">{message}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button onClick={onCancel} type="button" variant="outline">Cancel</Button>
          <Button disabled={isPending} type="submit">
            {isPending ? <LoaderCircle className="animate-spin" /> : <AtSign />}
            {isPending ? "Sending..." : "Send receipt"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Card className="print:hidden">
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <AtSign className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Digital receipt</CardTitle>
          <CardDescription className="mt-1">
            Queue an immutable email-delivery request for this exact receipt. Connecting a delivery provider is a separate deployment step.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          noValidate
          onSubmit={submitDelivery}
        >
          {emailInput}
          <Button disabled={isPending} type="submit">
            {isPending ? <LoaderCircle className="animate-spin" /> : <AtSign />}
            Queue email copy
          </Button>
        </form>
        {validationError ? <p aria-live="polite" className="text-sm text-destructive">{validationError}</p> : null}
        {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        {deliveries.length > 0 ? (
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recent delivery requests</p>
            {deliveries.map((delivery) => (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm" key={delivery.id}>
                <span className="break-all text-muted-foreground">{delivery.recipient}</span>
                <Badge variant="outline">{delivery.status}</Badge>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
