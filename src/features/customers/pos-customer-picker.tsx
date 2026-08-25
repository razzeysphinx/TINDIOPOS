"use client";

import { LoaderCircle, Search, Star, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PosCustomer } from "@/features/pos/pos-types";

type CustomerSearchResponse =
  | { customers: PosCustomer[] }
  | { error: string };

export function PosCustomerPicker({
  disabled,
  onChange,
  storeId,
  value,
}: {
  disabled: boolean;
  onChange: (customer: PosCustomer | null) => void;
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
      <div className="border-b bg-primary/5 px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Customer</p>
            <p className="mt-1 truncate text-sm font-semibold">{value.fullName}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="size-3 text-primary" aria-hidden="true" />
              {value.loyaltyPoints.toLocaleString()} loyalty points
            </p>
            <p className="mt-1 text-xs text-muted-foreground">#{value.customerNumber.toLocaleString()} · {value.loyaltyCardCode}</p>
          </div>
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
    );
  }

  return (
    <div className="border-b px-4 py-3 sm:px-5">
      <Button
        className="w-full justify-start"
        disabled={disabled}
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
