"use client";

import { AtSign, LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { queueReceiptDeliveryAction } from "@/features/receipts/improvement-6-actions";

type DeliveryRequest = {
  id: string;
  recipient: string;
  status: string;
  createdAt: string;
};

export function ReceiptDeliveryForm({
  deliveries,
  receiptId,
}: {
  deliveries: DeliveryRequest[];
  receiptId: string;
}) {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            startTransition(async () => {
              const result = await queueReceiptDeliveryAction({ receiptId, recipient, idempotencyKey });
              setMessage(result.message);
              if (result.ok) {
                setIdempotencyKey(crypto.randomUUID());
                router.refresh();
              }
            });
          }}
        >
          <Input
            aria-label="Recipient email"
            disabled={isPending}
            maxLength={320}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="customer@example.com"
            required
            type="email"
            value={recipient}
          />
          <Button disabled={isPending} type="submit">
            {isPending ? <LoaderCircle className="animate-spin" /> : <AtSign />}
            Queue email copy
          </Button>
        </form>
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
