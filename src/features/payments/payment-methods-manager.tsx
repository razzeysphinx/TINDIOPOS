"use client";

import { Check, CreditCard, LoaderCircle, Plus, SlidersHorizontal, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { GuardedDeleteDialog } from "@/components/back-office/guarded-delete-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  createPaymentMethodAction,
  restoreTindioPaymentPresetAction,
  setPaymentMethodOfflinePolicyAction,
  setStorePaymentMethodAvailabilityAction,
  updatePaymentMethodAction,
} from "@/features/payments/actions";
import {
  isTindioPaymentPresetCode,
  TINDIO_PAYMENT_PRESETS,
  type TindioPaymentPresetCode,
} from "@/features/payments/payment-presets";

type StoreOption = {
  id: string;
  name: string;
  isActive: boolean;
};

type PaymentMethodRecord = {
  id: string;
  name: string;
  code: string;
  paymentType: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER";
  offlinePolicy: "disabled" | "cash" | "manual_external";
  isEnabled: boolean;
  requiresReference: boolean;
  sortOrder: number;
  availability: Array<{ storeId: string; isEnabled: boolean }>;
};

const paymentTypeLabels: Record<PaymentMethodRecord["paymentType"], string> = {
  CASH: "Cash",
  CARD: "Card",
  E_WALLET: "E-wallet",
  BANK_TRANSFER: "Bank transfer",
  VOUCHER: "Voucher",
  OTHER: "Other",
};

export function PaymentMethodsManager({
  canManage,
  methods,
  stores,
}: {
  canManage: boolean;
  methods: PaymentMethodRecord[];
  stores: StoreOption[];
}) {
  const methodsByCode = new Map(methods.map((method) => [method.code, method]));
  const presetMethods = TINDIO_PAYMENT_PRESETS.flatMap((preset) => {
    const method = methodsByCode.get(preset.code);
    return method ? [method] : [];
  });
  const missingPresets = TINDIO_PAYMENT_PRESETS.filter(
    (preset) => !methodsByCode.has(preset.code),
  );
  const customMethods = methods.filter((method) => !isTindioPaymentPresetCode(method.code));

  return (
    <div className="space-y-5">
      <TindioPresetSection
        canManage={canManage}
        methods={presetMethods}
        missingPresets={missingPresets}
        stores={stores}
      />
      <PaymentMethodSection
        description="Create only the additional methods your business needs with the + button above."
        emptyMessage="No custom payment methods yet."
        methods={customMethods}
        title="CUSTOM METHODS"
      >
        {(method) => (
          <PaymentMethodCard
            canManage={canManage}
            key={method.id}
            method={method}
            stores={stores}
          />
        )}
      </PaymentMethodSection>
    </div>
  );
}

function TindioPresetSection({
  canManage,
  methods,
  missingPresets,
  stores,
}: {
  canManage: boolean;
  methods: PaymentMethodRecord[];
  missingPresets: ReadonlyArray<(typeof TINDIO_PAYMENT_PRESETS)[number]>;
  stores: StoreOption[];
}) {
  return (
    <section aria-labelledby="tindio-payment-presets-title">
      <div className="mb-3">
        <h2
          className="text-xs font-bold tracking-[0.14em] text-primary uppercase"
          id="tindio-payment-presets-title"
        >
          TINDIO PRESETS
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Core methods installed with every TINDIO organization. Configure availability or
          disable them without changing their stable reporting codes.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {methods.map((method) => (
          <PaymentMethodCard
            canManage={canManage}
            key={method.id}
            method={method}
            stores={stores}
          />
        ))}
        {missingPresets.map((preset) => (
          <MissingPaymentPresetCard canManage={canManage} key={preset.code} preset={preset} />
        ))}
      </div>
    </section>
  );
}

function MissingPaymentPresetCard({
  canManage,
  preset,
}: {
  canManage: boolean;
  preset: (typeof TINDIO_PAYMENT_PRESETS)[number];
}) {
  return (
    <Card className="border-dashed">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
            <CreditCard className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <CardTitle>{preset.name}</CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{preset.code}</p>
          </div>
        </div>
        <Badge variant="outline">Not installed</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">TINDIO preset</Badge>
          <Badge variant="outline">{paymentTypeLabels[preset.paymentType]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{preset.description}</p>
        {canManage ? (
          <RestorePaymentPresetButton presetCode={preset.code} />
        ) : (
          <p className="text-sm text-muted-foreground">Settings management access is required to restore it.</p>
        )}
      </CardContent>
    </Card>
  );
}

function RestorePaymentPresetButton({ presetCode }: { presetCode: TindioPaymentPresetCode }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await restoreTindioPaymentPresetAction({ presetCode });
            setMessage(result.message);
            if (result.ok) router.refresh();
          });
        }}
        size="sm"
        type="button"
      >
        {isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
        Restore to active stores
      </Button>
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}

function PaymentMethodSection({
  title,
  description,
  methods,
  emptyMessage,
  children,
}: {
  title: string;
  description: string;
  methods: PaymentMethodRecord[];
  emptyMessage?: string;
  children: (method: PaymentMethodRecord) => ReactNode;
}) {
  const titleId = `${title.toLowerCase().replaceAll(" ", "-")}-title`;

  return (
    <section aria-labelledby={titleId}>
      <div className="mb-3">
        <h2 className="text-xs font-bold tracking-[0.14em] text-primary uppercase" id={titleId}>
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {methods.length ? (
        <div className="grid gap-4 xl:grid-cols-2">{methods.map(children)}</div>
      ) : (
        <Card>
          <CardContent className="py-5 text-sm text-muted-foreground">
            {emptyMessage ?? "No TINDIO preset payment methods are available for this organization."}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export function CreatePaymentMethodDialog({ stores }: { stores: StoreOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentMethodRecord["paymentType"]>("OTHER");
  const [requiresReference, setRequiresReference] = useState(false);
  const [selectedStoreIds, setSelectedStoreIds] = useState(() => stores.map((store) => store.id));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await createPaymentMethodAction({
        name,
        code,
        paymentType,
        requiresReference,
        storeIds: selectedStoreIds,
      });
      setMessage(result.message);
      if (!result.ok) return;

      setName("");
      setCode("");
      setPaymentType("OTHER");
      setRequiresReference(false);
      setSelectedStoreIds(stores.map((store) => store.id));
      setOpen(false);
      router.refresh();
    });
  };

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds((current) =>
      current.includes(storeId)
        ? current.filter((id) => id !== storeId)
        : [...current, storeId],
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Add a custom payment method"
        className={buttonVariants({ size: "icon" })}
        title="Add custom payment method"
      >
        <Plus aria-hidden="true" />
        <span className="sr-only">Add custom payment method</span>
      </DialogTrigger>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Add payment method</DialogTitle>
          <DialogDescription>Custom methods are available only where you enable them below.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="payment-method-name">
              Name
              <Input
                id="payment-method-name"
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="payment-method-code">
              Internal code
              <Input
                id="payment-method-code"
                maxLength={40}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="GRABPAY"
                required
                value={code}
              />
              <span className="text-xs font-normal leading-5 text-muted-foreground">
                Reserved for TINDIO presets: Cash, Card, GCash, Maya, and Bank Transfer.
              </span>
            </label>
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="payment-method-type">
              Category
              <select
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                id="payment-method-type"
                onChange={(event) =>
                  setPaymentType(event.target.value as PaymentMethodRecord["paymentType"])
                }
                value={paymentType}
              >
                {Object.entries(paymentTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="mt-7 flex items-center gap-2 text-sm font-medium">
              <input
                checked={requiresReference}
                className="size-4 accent-primary"
                onChange={(event) => setRequiresReference(event.target.checked)}
                type="checkbox"
              />
              Require a reference number
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Enabled stores</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {stores.map((store) => (
                <label className="flex items-center gap-2 text-sm" key={store.id}>
                  <input
                    checked={selectedStoreIds.includes(store.id)}
                    className="size-4 accent-primary"
                    onChange={() => toggleStore(store.id)}
                    type="checkbox"
                  />
                  {store.name}
                </label>
              ))}
            </div>
          </fieldset>

            <DialogFooter>
            <Button disabled={isPending || stores.length === 0} type="submit">
              {isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Add payment method
            </Button>
            {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

function PaymentMethodCard({
  canManage,
  method,
  stores,
}: {
  canManage: boolean;
  method: PaymentMethodRecord;
  stores: StoreOption[];
}) {
  const enabledStores = method.availability.filter((item) => item.isEnabled).length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
            <CreditCard className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate">{method.name}</CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{method.code}</p>
          </div>
        </div>
        <Badge variant={method.isEnabled ? "secondary" : "outline"}>
          {method.isEnabled ? "Enabled" : "Disabled"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {isTindioPaymentPresetCode(method.code) ? "TINDIO preset" : "Custom"}
          </Badge>
          <Badge variant="outline">{paymentTypeLabels[method.paymentType]}</Badge>
          <Badge variant="outline">{method.requiresReference ? "Reference required" : "Reference optional"}</Badge>
          <Badge variant="outline">{enabledStores} store{enabledStores === 1 ? "" : "s"} enabled</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {method.offlinePolicy === "cash"
            ? "One cash payment can be queued while offline."
            : method.offlinePolicy === "manual_external"
              ? "Offline payments are recorded as manual external payments."
              : "This method requires an internet connection."}
        </p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Dialog.Root>
            <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
              <SlidersHorizontal aria-hidden="true" />
              Edit payment method
            </DialogTrigger>
            <DialogContent size="wide">
              <DialogHeader>
                <DialogTitle>Edit {method.name}</DialogTitle>
                <DialogDescription>
                  Change availability and checkout behavior without altering the method&apos;s reporting code.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <PaymentMethodEditor method={method} stores={stores} />
              </DialogBody>
            </DialogContent>
            </Dialog.Root>
            {!method.isEnabled ? (
              <GuardedDeleteDialog
                recordId={method.id}
                recordName={method.name}
                recordType="payment_method"
              />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PaymentMethodEditor({
  method,
  stores,
}: {
  method: PaymentMethodRecord;
  stores: StoreOption[];
}) {
  const [name, setName] = useState(method.name);
  const [isEnabled, setIsEnabled] = useState(method.isEnabled);
  const [requiresReference, setRequiresReference] = useState(method.requiresReference);
  const [offlinePolicy, setOfflinePolicy] = useState(method.offlinePolicy);
  const [sortOrder, setSortOrder] = useState(String(method.sortOrder));
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAvailabilityStoreId, setPendingAvailabilityStoreId] = useState<string | null>(null);
  const availability = new Map(method.availability.map((item) => [item.storeId, item.isEnabled]));

  const save = async () => {
    const parsedSortOrder = Number(sortOrder);
    if (!Number.isInteger(parsedSortOrder)) {
      setMessage("Sort order must be a whole number.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await updatePaymentMethodAction({
        paymentMethodId: method.id,
        name,
        isEnabled,
        requiresReference,
        sortOrder: parsedSortOrder,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      const policyResult = await setPaymentMethodOfflinePolicyAction({
        paymentMethodId: method.id,
        offlinePolicy,
      });
      setMessage(policyResult.message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAvailability = async (storeId: string, enabled: boolean) => {
    setPendingAvailabilityStoreId(storeId);
    try {
      const result = await setStorePaymentMethodAvailabilityAction({
        paymentMethodId: method.id,
        storeId,
        isEnabled: enabled,
      });
      setMessage(result.message);
    } finally {
      setPendingAvailabilityStoreId(null);
    }
  };

  return (
    <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Display name
                <Input maxLength={100} onChange={(event) => setName(event.target.value)} value={name} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Display order
                <Input
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => setSortOrder(event.target.value)}
                  type="number"
                  value={sortOrder}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  checked={isEnabled}
                  className="size-4 accent-primary"
                  onChange={(event) => setIsEnabled(event.target.checked)}
                  type="checkbox"
                />
                Enabled across configured stores
              </label>
              <label className="flex items-center gap-2">
                <input
                  checked={requiresReference}
                  className="size-4 accent-primary"
                  onChange={(event) => setRequiresReference(event.target.checked)}
                  type="checkbox"
                />
                Require reference number
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              Offline policy
              <select
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                disabled={isSaving}
                onChange={(event) => setOfflinePolicy(event.target.value as PaymentMethodRecord["offlinePolicy"])}
                value={offlinePolicy}
              >
                <option value="disabled">Require internet</option>
                {method.paymentType === "CASH" ? <option value="cash">Allow one cash payment offline</option> : null}
                {method.paymentType !== "CASH" ? <option value="manual_external">Manual external (not auto-settled)</option> : null}
              </select>
              <span className="text-xs font-normal leading-5 text-muted-foreground">Only the cash policy can be completed and queued automatically while offline.</span>
            </label>
            <div>
              <p className="text-sm font-medium">Store availability</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {stores.map((store) => (
                  <label className="flex items-center gap-2 text-sm" key={store.id}>
                    <input
                      checked={availability.get(store.id) ?? false}
                      className="size-4 accent-primary"
                      disabled={!store.isActive || pendingAvailabilityStoreId === store.id}
                      onChange={(event) => toggleAvailability(store.id, event.target.checked)}
                      type="checkbox"
                    />
                    <Store className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {store.name}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button disabled={isSaving} onClick={save} size="sm" type="button">
                {isSaving ? <LoaderCircle className="animate-spin" /> : <Check />}
                Save changes
              </Button>
              {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
            </DialogFooter>
    </div>
  );
}
