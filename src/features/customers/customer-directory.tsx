"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 12;

type Customer = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  loyaltyCardCode: string;
  customerNumber: number;
  points: number;
  status: "active" | "archived";
};

export function CustomerDirectory({ customers }: { customers: Customer[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Customer["status"]>("all");
  const [page, setPage] = useState(1);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCustomers = useMemo(
    () => customers.filter((customer) => {
      const searchable = [customer.fullName, customer.phone, customer.email, customer.loyaltyCardCode, String(customer.customerNumber)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (status === "all" || customer.status === status) && (!normalizedQuery || searchable.includes(normalizedQuery));
    }),
    [customers, normalizedQuery, status],
  );
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleCustomers = filteredCustomers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const updateQuery = (value: string) => { setQuery(value); setPage(1); };
  const updateStatus = (value: "all" | Customer["status"]) => { setStatus(value); setPage(1); };

  return (
    <section className="space-y-4" aria-label="Customer directory">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Input aria-label="Search customers" onChange={(event) => updateQuery(event.target.value)} placeholder="Search name, phone, email, card, or customer number" value={query} />
        <select aria-label="Filter customers by status" className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" onChange={(event) => updateStatus(event.target.value as "all" | Customer["status"])} value={status}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {visibleCustomers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleCustomers.map((customer) => (
            <Link href={`/back-office/customers/${customer.id}`} key={customer.id}>
              <Card className="h-full transition-colors hover:bg-muted/30">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{customer.fullName}</CardTitle>
                    <CardDescription className="mt-1 truncate">
                      #{customer.customerNumber.toLocaleString()} · {customer.phone ?? customer.email ?? customer.loyaltyCardCode}
                    </CardDescription>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <Badge variant={customer.status === "active" ? "secondary" : "outline"}>
                    {customer.status === "active" ? "Active" : "Archived"}
                  </Badge>
                  <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                    <Star className="size-4" aria-hidden="true" />
                    {customer.points.toLocaleString()} pts
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader className="items-center py-10 text-center">
            <CardTitle>No matching customers</CardTitle>
            <CardDescription>Adjust the search or status filter to find another customer.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {filteredCustomers.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
          <span>Page {currentPage} of {totalPages} · {filteredCustomers.length} customers</span>
          <div className="flex gap-2">
            <Button disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} size="sm" type="button" variant="outline"><ChevronLeft /> Previous</Button>
            <Button disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} size="sm" type="button" variant="outline">Next <ChevronRight /></Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
