"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, BadgePlus, LoaderCircle, Pencil, Plus, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button, buttonVariants } from "@/components/ui/button";
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
  adjustCustomerLoyaltyPointsAction,
  createCustomerSegmentAction,
  createCustomerAction,
  updateCustomerProfileAction,
  updateCustomerStatusAction,
  updateCustomerSegmentAction,
  updateLoyaltyProgramAction,
} from "@/features/customers/actions";
import {
  createCustomerSegmentSchema,
  createCustomerSchema,
  loyaltyAdjustmentSchema,
  updateCustomerProfileSchema,
  updateLoyaltyProgramSchema,
  type CreateCustomerSegmentValues,
  type CreateCustomerValues,
  type LoyaltyAdjustmentValues,
  type UpdateCustomerProfileValues,
  type UpdateCustomerSegmentValues,
  type UpdateLoyaltyProgramValues,
  updateCustomerSegmentSchema,
} from "@/features/customers/customer-schema";

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export function CreateCustomerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateCustomerValues>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      address: "",
      birthday: "",
      notes: "",
      loyaltyCardCode: "",
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createCustomerAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset();
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants()}>
        <Plus aria-hidden="true" />
        Add customer
      </DialogTrigger>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>Create a CRM profile that cashiers can select during a sale.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" noValidate onSubmit={submit}>
          <FormField error={form.formState.errors.fullName?.message} label="Full name">
            <Input placeholder="Maria Santos" {...form.register("fullName")} />
          </FormField>
          <FormField error={form.formState.errors.phone?.message} label="Phone">
            <Input placeholder="Optional" {...form.register("phone")} />
          </FormField>
          <FormField error={form.formState.errors.email?.message} label="Email">
            <Input placeholder="Optional" type="email" {...form.register("email")} />
          </FormField>
          <FormField error={form.formState.errors.birthday?.message} label="Birthday">
            <Input type="date" {...form.register("birthday")} />
          </FormField>
          <FormField error={form.formState.errors.address?.message} label="Address">
            <Input placeholder="Optional" {...form.register("address")} />
          </FormField>
          <FormField error={form.formState.errors.notes?.message} label="Notes">
            <Input placeholder="Optional service notes" {...form.register("notes")} />
          </FormField>
          <FormField error={form.formState.errors.loyaltyCardCode?.message} label="Loyalty card / barcode">
            <Input placeholder="Optional â€” TINDIO assigns one if blank" {...form.register("loyaltyCardCode")} />
          </FormField>
            <div className="sm:col-span-2 xl:col-span-3">
              <DialogFooter>
                <SubmitResult isPending={isPending} label="Create customer" result={result} />
              </DialogFooter>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function CustomerSegmentForm({
  segments,
}: {
  segments: { id: string; name: string; description: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateCustomerSegmentValues>({
    resolver: zodResolver(createCustomerSegmentSchema),
    defaultValues: { name: "", description: "" },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createCustomerSegmentAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset();
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Customer segments</CardTitle>
          <CardDescription>Group customers with reusable tags such as VIP, Wholesale, or Regular.</CardDescription>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <DialogTrigger className={buttonVariants({ size: "sm" })}>
            <BadgePlus aria-hidden="true" />
            Add segment
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add customer segment</DialogTitle>
              <DialogDescription>Use segments to keep customer lists and loyalty campaigns organized.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <form className="grid gap-4" noValidate onSubmit={submit}>
                <FormField error={form.formState.errors.name?.message} label="Segment name">
                  <Input autoFocus placeholder="VIP" {...form.register("name")} />
                </FormField>
                <FormField error={form.formState.errors.description?.message} label="Description">
                  <Input placeholder="Optional" {...form.register("description")} />
                </FormField>
                <DialogFooter>
                  <SubmitResult icon={<BadgePlus />} isPending={isPending} label="Add segment" result={result} />
                </DialogFooter>
              </form>
            </DialogBody>
          </DialogContent>
        </Dialog.Root>
      </CardHeader>
      <CardContent className="space-y-4">
        {segments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {segments.map((segment) => (
              <EditCustomerSegmentButton key={segment.id} segment={segment} />
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No segments yet. Add one, then assign it from a customer profile.</p>}
      </CardContent>
    </Card>
  );
}

function EditCustomerSegmentButton({
  segment,
}: {
  segment: { id: string; name: string; description: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateCustomerSegmentValues>({
    resolver: zodResolver(updateCustomerSegmentSchema),
    defaultValues: { segmentId: segment.id, name: segment.name, description: segment.description ?? "" },
  });
  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateCustomerSegmentAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ size: "sm", variant: "outline" })} title={segment.description ?? undefined}>
        {segment.name}
        <Pencil aria-hidden="true" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit customer segment</DialogTitle>
          <DialogDescription>Update this reusable customer grouping without changing customer history.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" noValidate onSubmit={submit}>
            <FormField error={form.formState.errors.name?.message} label="Segment name">
              <Input autoFocus {...form.register("name")} />
            </FormField>
            <FormField error={form.formState.errors.description?.message} label="Description">
              <Input {...form.register("description")} />
            </FormField>
            <DialogFooter>
              <SubmitResult icon={<Pencil />} isPending={isPending} label="Save segment" result={result} />
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function CustomerProfileForm({
  customer,
  segments,
  selectedSegmentIds,
}: {
  customer: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    birthday: string | null;
    notes: string | null;
    loyaltyCardCode: string;
  };
  segments: { id: string; name: string; description: string | null }[];
  selectedSegmentIds: string[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateCustomerProfileValues>({
    resolver: zodResolver(updateCustomerProfileSchema),
    defaultValues: {
      customerId: customer.id,
      fullName: customer.fullName,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      birthday: customer.birthday ?? "",
      notes: customer.notes ?? "",
      loyaltyCardCode: customer.loyaltyCardCode,
      segmentIds: selectedSegmentIds,
    },
  });
  const selected = useWatch({ control: form.control, name: "segmentIds" }) ?? [];

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateCustomerProfileAction(values);
      setResult(nextResult);
      if (nextResult.ok) router.refresh();
    });
  });

  const toggleSegment = (segmentId: string, checked: boolean) => {
    form.setValue(
      "segmentIds",
      checked ? [...selected, segmentId] : selected.filter((id) => id !== segmentId),
      { shouldDirty: true },
    );
  };

  return (
    <form className="space-y-4" noValidate onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={form.formState.errors.fullName?.message} label="Full name">
          <Input {...form.register("fullName")} />
        </FormField>
        <FormField error={form.formState.errors.loyaltyCardCode?.message} label="Loyalty card / barcode">
          <Input {...form.register("loyaltyCardCode")} />
        </FormField>
        <FormField error={form.formState.errors.email?.message} label="Email">
          <Input type="email" {...form.register("email")} />
        </FormField>
        <FormField error={form.formState.errors.phone?.message} label="Phone">
          <Input {...form.register("phone")} />
        </FormField>
        <FormField error={form.formState.errors.birthday?.message} label="Birthday">
          <Input type="date" {...form.register("birthday")} />
        </FormField>
        <FormField error={form.formState.errors.address?.message} label="Address">
          <Input {...form.register("address")} />
        </FormField>
      </div>
      <FormField error={form.formState.errors.notes?.message} label="Notes">
        <textarea className="min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" {...form.register("notes")} />
      </FormField>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Segments</legend>
        {segments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {segments.map((segment) => {
              const checked = selected.includes(segment.id);
              return (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm" key={segment.id} title={segment.description ?? undefined}>
                  <input checked={checked} onChange={(event) => toggleSegment(segment.id, event.target.checked)} type="checkbox" />
                  {segment.name}
                </label>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted-foreground">Create segments from the Customers page to assign them here.</p>}
      </fieldset>
      <SubmitResult icon={<Save />} isPending={isPending} label="Save profile" result={result} />
    </form>
  );
}

export function LoyaltyAdjustmentForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<LoyaltyAdjustmentValues>({
    resolver: zodResolver(loyaltyAdjustmentSchema),
    defaultValues: { customerId, pointsDelta: 0, reason: "" },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await adjustCustomerLoyaltyPointsAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset({ customerId, pointsDelta: 0, reason: "" });
        router.refresh();
      }
    });
  });

  return (
    <form className="grid gap-4 sm:grid-cols-[150px_1fr_auto] sm:items-end" noValidate onSubmit={submit}>
      <FormField error={form.formState.errors.pointsDelta?.message} label="Points (+/-)">
        <Input inputMode="numeric" {...form.register("pointsDelta", { valueAsNumber: true })} />
      </FormField>
      <FormField error={form.formState.errors.reason?.message} label="Reason (required)">
        <Input placeholder="Why is this adjustment needed?" {...form.register("reason")} />
      </FormField>
      <SubmitResult icon={<SlidersHorizontal />} isPending={isPending} label="Record adjustment" result={result} />
    </form>
  );
}

export function LoyaltyProgramForm({
  program,
}: {
  program: {
    isEnabled: boolean;
    earnSpendMinor: number;
    earnPoints: number;
    redemptionValueMinor: number;
    minimumRedemptionPoints: number;
  };
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateLoyaltyProgramValues>({
    resolver: zodResolver(updateLoyaltyProgramSchema),
    defaultValues: {
      isEnabled: program.isEnabled,
      earnSpend: (program.earnSpendMinor / 100).toFixed(2),
      earnPoints: program.earnPoints,
      redemptionValue: (program.redemptionValueMinor / 100).toFixed(2),
      minimumRedemptionPoints: program.minimumRedemptionPoints,
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateLoyaltyProgramAction(values);
      setResult(nextResult);
      if (nextResult.ok) router.refresh();
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Loyalty program</CardTitle>
        <CardDescription>
          Balances are calculated from the points ledger; they are never edited directly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" noValidate onSubmit={submit}>
          <Label className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium xl:mt-6">
            <input type="checkbox" {...form.register("isEnabled")} />
            Enable loyalty
          </Label>
          <FormField error={form.formState.errors.earnSpend?.message} label="Spend amount">
            <Input inputMode="decimal" {...form.register("earnSpend")} />
          </FormField>
          <FormField error={form.formState.errors.earnPoints?.message} label="Points earned">
            <Input min={1} type="number" {...form.register("earnPoints", { valueAsNumber: true })} />
          </FormField>
          <FormField error={form.formState.errors.redemptionValue?.message} label="Value per point">
            <Input inputMode="decimal" {...form.register("redemptionValue")} />
          </FormField>
          <FormField error={form.formState.errors.minimumRedemptionPoints?.message} label="Minimum redemption">
            <Input min={1} type="number" {...form.register("minimumRedemptionPoints", { valueAsNumber: true })} />
          </FormField>
          <div className="sm:col-span-2 xl:col-span-5">
            <SubmitResult icon={<Save />} isPending={isPending} label="Save loyalty settings" result={result} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function CustomerStatusButton({
  customerId,
  status,
}: {
  customerId: string;
  status: "active" | "archived";
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const nextStatus = status === "active" ? "archived" : "active";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={isPending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const nextResult = await updateCustomerStatusAction({ customerId, status: nextStatus });
            setResult(nextResult);
            if (nextResult.ok) router.refresh();
          });
        }}
        type="button"
        variant={status === "active" ? "outline" : "secondary"}
      >
        {isPending ? <LoaderCircle className="animate-spin" /> : status === "active" ? <Archive /> : <RotateCcw />}
        {status === "active" ? "Archive customer" : "Reactivate customer"}
      </Button>
      {result ? <p className={result.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{result.message}</p> : null}
    </div>
  );
}

function FormField({
  children,
  error,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

function SubmitResult({
  icon = <Plus />,
  isPending,
  label,
  result,
}: {
  icon?: React.ReactNode;
  isPending: boolean;
  label: string;
  result: ActionResult | null;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button disabled={isPending} type="submit">
        {isPending ? <LoaderCircle className="animate-spin" /> : icon}
        {isPending ? "Saving…" : label}
      </Button>
      {result ? <p className={result.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{result.message}</p> : null}
    </div>
  );
}
