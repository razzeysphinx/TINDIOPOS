"use client";

import { Check, CreditCard, LoaderCircle, Plus, SlidersHorizontal, Store } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createPaymentMethodAction,
  setPaymentMethodOfflinePolicyAction,
  setStorePaymentMethodAvailabilityAction,
  updatePaymentMethodAction,
} from "@/features/payments/actions";

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
  const activeStores = stores.filter((store) => store.isActive);

  return (
    <div className="space-y-5">
      {canManage ? <CreatePaymentMethodForm stores={activeStores} /> : null}
      <section className="grid gap-4 xl:grid-cols-2">
        {methods.map((method) => (
          <PaymentMethodCard
            canManage={canManage}
            key={method.id}
            method={method}
            stores={stores}
          />
        ))}
      </section>
    </div>
  );
}

function CreatePaymentMethodForm({ stores }: { stores: StoreOption[] }) {
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
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-secondary text-primary">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle>Add payment method</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Custom methods are available only where you enable them below.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
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

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={isPending || stores.length === 0} type="submit">
              {isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Add payment method
            </Button>
            {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
          </div>
        </form>
      </CardContent>
    </Card>
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
  const [name, setName] = useState(method.name);
  const [isEnabled, setIsEnabled] = useState(method.isEnabled);
  const [requiresReference, setRequiresReference] = useState(method.requiresReference);
  const [offlinePolicy, setOfflinePolicy] = useState(method.offlinePolicy);
  const [sortOrder, setSortOrder] = useState(String(method.sortOrder));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const availability = new Map(method.availability.map((item) => [item.storeId, item.isEnabled]));

  const save = () => {
    const parsedSortOrder = Number(sortOrder);
    if (!Number.isInteger(parsedSortOrder)) {
      setMessage("Sort order must be a whole number.");
      return;
    }

    startTransition(async () => {
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
    });
  };

  const toggleAvailability = (storeId: string, enabled: boolean) => {
    startTransition(async () => {
      const result = await setStorePaymentMethodAvailabilityAction({
        paymentMethodId: method.id,
        storeId,
        isEnabled: enabled,
      });
      setMessage(result.message);
    });
  };

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
      <CardContent>
        {canManage ? (
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
                disabled={isPending}
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
                      disabled={!store.isActive || isPending}
                      onChange={(event) => toggleAvailability(store.id, event.target.checked)}
                      type="checkbox"
                    />
                    <Store className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {store.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={isPending} onClick={save} size="sm" type="button">
                {isPending ? <LoaderCircle className="animate-spin" /> : <Check />}
                Save changes
              </Button>
              <Badge variant="outline">
                <SlidersHorizontal aria-hidden="true" />
                {paymentTypeLabels[method.paymentType]}
              </Badge>
              {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
            </div>
          </div>
        ) : (
          <div>
            <Badge variant="outline">{paymentTypeLabels[method.paymentType]}</Badge>
            <p className="mt-4 text-sm text-muted-foreground">
              {method.requiresReference ? "A reference number is required." : "Reference number is optional."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
