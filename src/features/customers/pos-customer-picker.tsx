"use client";

import { LoaderCircle, Search, Star, UserRound, X } from "lucide-react";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createCustomerAction } from "@/features/customers/actions";
import { createCustomerSchema } from "@/features/customers/customer-schema";
import type { PosCustomer } from "@/features/pos/pos-types";

type CustomerSearchResponse =
  | { customers: PosCustomer[] }
  | { error: string };

export function PosCustomerPicker({
  disabled,
  onChange,
  showLoyalty,
  storeId,
  value,
}: {
  disabled: boolean;
  onChange: (customer: PosCustomer | null) => void;
  showLoyalty: boolean;
  storeId: string;
  value: PosCustomer | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || disabled || !storeId) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setMessage(null);

      try {
        const parameters = new URLSearchParams({ store: storeId });
        if (query.trim()) parameters.set("q", query.trim());
        const response = await fetch(`/api/pos/customers?${parameters.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json() as CustomerSearchResponse;

        if (!response.ok || !("customers" in payload)) {
          setCustomers([]);
          setMessage("error" in payload ? payload.error : "Customers could not be loaded.");
          return;
        }

        setCustomers(payload.customers);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCustomers([]);
        setMessage("Customers could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, query.trim() ? 180 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [disabled, isOpen, query, storeId]);

  if (value) {
    return (
      <div className="border-b bg-primary/5 px-4 py-3 sm:px-5" id="pos-customer-picker">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Customer</p>
            <p className="mt-1 truncate text-sm font-semibold">{value.fullName}</p>
            {showLoyalty ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Star className="size-3 text-primary" aria-hidden="true" />
                {value.loyaltyPoints.toLocaleString()} loyalty points
              </p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">#{value.customerNumber.toLocaleString()} · {value.loyaltyCardCode}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              disabled={disabled}
              onClick={() => {
                onChange(null);
                setIsOpen(true);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Change
            </Button>
            <Button
              aria-label="Remove selected customer"
              disabled={disabled}
              onClick={() => onChange(null)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b px-4 py-3 sm:px-5" id="pos-customer-picker">
      <Button
        className="w-full justify-start"
        disabled={disabled}
        id="pos-customer-picker-trigger"
        onClick={() => {
          setIsOpen((current) => !current);
          setMessage(null);
        }}
        type="button"
        variant="outline"
      >
        <UserRound aria-hidden="true" />
        Add customer
      </Button>

      {isOpen ? (
        <div className="mt-3 rounded-xl border bg-background p-3 shadow-sm">
          <label className="sr-only" htmlFor="pos-customer-search">Search customers</label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              className="h-10 pl-9"
              id="pos-customer-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, mobile, email, customer ID, or card"
              value={query}
            />
          </div>

          {isLoading ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Searching customers…
            </p>
          ) : message ? (
            <p className="mt-3 text-xs text-destructive">{message}</p>
          ) : customers.length > 0 ? (
            <ul className="mt-3 divide-y rounded-lg border">
              {customers.map((customer) => (
                <li key={customer.id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onChange(customer);
                      setIsOpen(false);
                      setQuery("");
                    }}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{customer.fullName}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        #{customer.customerNumber.toLocaleString()} · {customer.loyaltyCardCode}
                        {customer.phone || customer.email ? ` · ${customer.phone ?? customer.email}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-primary">
                      {customer.loyaltyPoints.toLocaleString()} pts
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              No active customers match this search. Create one from Back Office → Customers.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

type PosCustomerCreateDraft = {
  fullName: string;
  email: string;
  phone: string;
};

const emptyCustomerDraft: PosCustomerCreateDraft = {
  fullName: "",
  email: "",
  phone: "",
};

/**
 * A compact POS entry point for the existing customer creation action. It
 * intentionally uses the same schema and server authorization as Back Office.
 */
export function PosCustomerCreateDialog({
  onCreated,
  onOpenChange,
  open,
}: {
  onCreated: (customer: PosCustomer) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [draft, setDraft] = useState<PosCustomerCreateDraft>(emptyCustomerDraft);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PosCustomerCreateDraft, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const close = () => {
    setDraft(emptyCustomerDraft);
    setFieldErrors({});
    setMessage(null);
    onOpenChange(false);
  };

  const updateField = (field: keyof PosCustomerCreateDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = {
      ...draft,
      address: "",
      birthday: "",
      notes: "",
      loyaltyCardCode: "",
    };
    const parsed = createCustomerSchema.safeParse(input);

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        fullName: errors.fullName?.[0],
        email: errors.email?.[0],
        phone: errors.phone?.[0],
      });
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const result = await createCustomerAction(parsed.data);
      if (!result.ok || !result.data) {
        setMessage(result.message);
        return;
      }

      onCreated(result.data);
      close();
    });
  };

  return (
    <Dialog.Root onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())} open={open}>
      <DialogContent className="w-full max-w-md" closeLabel="Close new customer form">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Add a customer, then attach them to this sale immediately.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              Full name
              <Input
                aria-describedby={fieldErrors.fullName ? "pos-customer-name-error" : undefined}
                aria-invalid={Boolean(fieldErrors.fullName)}
                autoComplete="name"
                autoFocus
                onChange={(event) => updateField("fullName", event.target.value)}
                placeholder="Customer name"
                value={draft.fullName}
              />
              {fieldErrors.fullName ? <span className="text-xs font-normal text-destructive" id="pos-customer-name-error">{fieldErrors.fullName}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
              <Input
                aria-describedby={fieldErrors.phone ? "pos-customer-phone-error" : undefined}
                aria-invalid={Boolean(fieldErrors.phone)}
                autoComplete="tel"
                inputMode="tel"
                onChange={(event) => updateField("phone", event.target.value)}
                placeholder="Mobile number"
                value={draft.phone}
              />
              {fieldErrors.phone ? <span className="text-xs font-normal text-destructive" id="pos-customer-phone-error">{fieldErrors.phone}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Email <span className="font-normal text-muted-foreground">(optional)</span>
              <Input
                aria-describedby={fieldErrors.email ? "pos-customer-email-error" : undefined}
                aria-invalid={Boolean(fieldErrors.email)}
                autoComplete="email"
                inputMode="email"
                onChange={(event) => updateField("email", event.target.value)}
                placeholder="customer@example.com"
                type="email"
                value={draft.email}
              />
              {fieldErrors.email ? <span className="text-xs font-normal text-destructive" id="pos-customer-email-error">{fieldErrors.email}</span> : null}
            </label>
            {message ? <p aria-live="polite" className="text-sm text-destructive">{message}</p> : null}
          </DialogBody>
          <DialogFooter className="border-t px-4 py-4 sm:px-6">
            <Button disabled={isPending} onClick={close} type="button" variant="outline">Cancel</Button>
            <Button disabled={isPending} type="submit">{isPending ? "Creating…" : "Create customer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
