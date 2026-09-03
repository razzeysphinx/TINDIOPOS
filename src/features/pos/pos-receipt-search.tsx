"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PosReceiptSearch({ initialQuery }: { initialQuery: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  const navigate = (value: string) => {
    const normalized = value.trim();
    const params = new URLSearchParams();
    if (normalized) params.set("q", normalized);
    startTransition(() => router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false }));
  };

  return (
    <form
      className="flex min-w-0 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(query);
      }}
      role="search"
    >
      <label className="sr-only" htmlFor="pos-receipt-search">Search receipts</label>
      <div className="relative min-w-0 flex-1">
        {isPending ? <LoaderCircle aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />}
        <Input
          aria-busy={isPending}
          className="h-10 pr-10 pl-9"
          id="pos-receipt-search"
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (!value) navigate("");
          }}
          placeholder="Search receipt number"
          value={query}
        />
        {query ? (
          <Button
            aria-label="Clear receipt search"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => {
              setQuery("");
              navigate("");
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <Button className="shrink-0" disabled={isPending} type="submit" variant="outline">Search</Button>
    </form>
  );
}
