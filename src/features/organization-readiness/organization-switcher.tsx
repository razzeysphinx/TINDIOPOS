"use client";

import { Building2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { selectActiveOrganizationAction } from "@/features/organization-readiness/actions";

type OrganizationOption = {
  id: string;
  name: string;
  status: "active" | "suspended" | "archived";
};

const statusLabel: Record<OrganizationOption["status"], string> = {
  active: "Active",
  suspended: "Suspended",
  archived: "Archived",
};

export function OrganizationSwitcher({
  organizations,
  selectedOrganizationId,
}: {
  organizations: OrganizationOption[];
  selectedOrganizationId: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (organizations.length < 2) {
    return null;
  }

  return (
    <div className="min-w-0">
      <label className="sr-only" htmlFor="active-organization">
        Active organization
      </label>
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <Building2 aria-hidden="true" className="hidden size-4 shrink-0 text-primary min-[375px]:block" />
        <select
          aria-describedby={message ? "active-organization-message" : undefined}
          className="h-8 max-w-24 rounded-md border border-input bg-background px-2 text-xs font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 min-[375px]:max-w-32 sm:h-9 sm:max-w-52 sm:text-sm"
          defaultValue={selectedOrganizationId}
          disabled={isPending}
          id="active-organization"
          onChange={(event) => {
            const organizationId = event.target.value;
            setMessage(null);
            startTransition(async () => {
              const result = await selectActiveOrganizationAction(organizationId);
              setMessage(result.message);

              if (result.ok) {
                router.refresh();
              }
            });
          }}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name} · {statusLabel[organization.status]}
            </option>
          ))}
        </select>
        {isPending ? <LoaderCircle aria-label="Changing organization" className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>
      {message ? <p className="sr-only" id="active-organization-message" role="status">{message}</p> : null}
    </div>
  );
}
