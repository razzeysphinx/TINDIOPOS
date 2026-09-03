"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { decideManagerApprovalAction } from "@/features/approvals/actions";

export function ApprovalRequestActions({ approvalRequestId }: { approvalRequestId: string }) {
  const router = useRouter();
  const [busyDecision, setBusyDecision] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: "APPROVED" | "REJECTED") => {
    setBusyDecision(decision);
    setMessage(null);
    startTransition(async () => {
      const result = await decideManagerApprovalAction({ approvalRequestId, decision });
      setMessage(result.message);
      setBusyDecision(null);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="flex min-w-48 flex-wrap justify-end gap-2">
      <Button disabled={isPending} onClick={() => decide("REJECTED")} size="sm" type="button" variant="outline">
        {busyDecision === "REJECTED" ? <LoaderCircle className="animate-spin" /> : <X />}
        Reject
      </Button>
      <Button disabled={isPending} onClick={() => decide("APPROVED")} size="sm" type="button">
        {busyDecision === "APPROVED" ? <LoaderCircle className="animate-spin" /> : <Check />}
        Approve
      </Button>
      {message ? <p aria-live="polite" className="basis-full text-right text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
