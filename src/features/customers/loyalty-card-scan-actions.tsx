"use client";

import { Gift, LoaderCircle, Stamp } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addLoyaltyCardStampAction, claimLoyaltyCardRewardAction } from "@/features/customers/actions";

export function LoyaltyCardScanActions({
  cardId,
  rewardReady,
}: {
  cardId: string;
  rewardReady: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const record = () => {
    if (reason.trim().length < 2) return;
    setMessage(null);
    startTransition(async () => {
      const result = rewardReady
        ? await claimLoyaltyCardRewardAction({ cardId, reason: reason.trim() })
        : await addLoyaltyCardStampAction({ cardId, reason: reason.trim() });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setReason("");
        router.refresh();
      }
    });
  };

  return (
    <section className="space-y-3 border-t pt-4 text-left">
      <p className="text-sm font-medium">Staff action</p>
      <Label className="grid gap-1.5 text-sm font-medium">
        {rewardReady ? "Reward claim note" : "Manual stamp reason"}
        <Input
          disabled={isPending}
          onChange={(event) => setReason(event.target.value)}
          placeholder={rewardReady ? "e.g. Free drink issued" : "Why is a stamp being added without a linked sale?"}
          value={reason}
        />
      </Label>
      <Button disabled={isPending || reason.trim().length < 2} onClick={record} type="button" className="w-full">
        {isPending ? <LoaderCircle className="animate-spin" /> : rewardReady ? <Gift /> : <Stamp />}
        {rewardReady ? "Record reward claim" : "Add stamp"}
      </Button>
      {message ? <p className={message.ok ? "text-center text-xs text-primary" : "text-center text-xs text-destructive"}>{message.text}</p> : null}
    </section>
  );
}
