"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
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
import { deleteUnusedSetupRecordAction } from "@/features/management/actions";
import {
  guardedSetupRecordLabels,
  type GuardedSetupRecordKind,
} from "@/features/management/guarded-delete-types";

export function GuardedDeleteDialog({
  recordId,
  recordName,
  recordType,
}: {
  recordId: string;
  recordName: string;
  recordType: GuardedSetupRecordKind;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const recordLabel = guardedSetupRecordLabels[recordType];
  const canConfirm = confirmationName.trim() === recordName;

  function reset() {
    setConfirmationName("");
    setMessage(null);
  }

  function confirmDelete() {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteUnusedSetupRecordAction({
        recordType,
        recordId,
        confirmationName,
      });
      setMessage(result.message);
      if (result.ok) {
        setOpen(false);
        reset();
        router.refresh();
      }
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) reset();
      }}
    >
      <DialogTrigger className={buttonVariants({ variant: "destructive", size: "sm" })}>
        <Trash2 aria-hidden="true" />
        Delete permanently
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permanently delete {recordName}?</DialogTitle>
          <DialogDescription>
            This cannot be undone. TINDIO will delete the {recordLabel} only if it is inactive and has no protected dependencies.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="grid gap-1.5 text-sm font-medium" htmlFor={`delete-${recordId}`}>
            Type <span className="font-semibold">{recordName}</span> to confirm
            <Input
              autoComplete="off"
              id={`delete-${recordId}`}
              onChange={(event) => setConfirmationName(event.target.value)}
              value={confirmationName}
            />
          </label>
          {message ? (
            <p aria-live="polite" className="text-sm text-destructive" role="status">
              {message}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button disabled={!canConfirm || isPending} variant="destructive" onClick={confirmDelete}>
            {isPending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
