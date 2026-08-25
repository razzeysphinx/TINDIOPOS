"use client";

import { useActionState, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, LoaderCircle, Plus, UserCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acceptEmployeeInvitationFormAction,
  acceptPendingEmployeeInvitationFormAction,
  createEmployeeInvitationAction,
  createRegisterAction,
  createRoleAction,
  createStoreAction,
  revokeEmployeeInvitationAction,
  type ManagementActionResult,
} from "@/features/management/actions";
import {
  createInvitationSchema,
  createRegisterSchema,
  createRoleSchema,
  createStoreSchema,
  type CreateInvitationValues,
  type CreateRegisterValues,
  type CreateRoleValues,
  type CreateStoreValues,
} from "@/features/management/management-schema";

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateStoreForm() {
  const router = useRouter();
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateStoreValues>({
    resolver: zodResolver(createStoreSchema),
    defaultValues: { name: "", code: "", address: "", phone: "" },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createStoreAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset();
        router.refresh();
      }
    });
  });

  return (
    <ManagementCard title="Add store" description="Create another business location.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <FormField label="Store name" error={form.formState.errors.name?.message}>
          <Input placeholder="Uptown Branch" {...form.register("name")} />
        </FormField>
        <FormField label="Store code" error={form.formState.errors.code?.message}>
          <Input placeholder="UPTOWN" {...form.register("code")} />
        </FormField>
        <FormField label="Address" error={form.formState.errors.address?.message}>
          <Input placeholder="Optional" {...form.register("address")} />
        </FormField>
        <FormField label="Phone" error={form.formState.errors.phone?.message}>
          <Input placeholder="Optional" {...form.register("phone")} />
        </FormField>
        <div className="sm:col-span-2">
          <SubmitRow isPending={isPending} result={result} label="Create store" />
        </div>
      </form>
    </ManagementCard>
  );
}

export function CreateRegisterForm({
  stores,
}: {
  stores: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateRegisterValues>({
    resolver: zodResolver(createRegisterSchema),
    defaultValues: { storeId: stores[0]?.id ?? "", name: "", code: "" },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createRegisterAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset({ storeId: stores[0]?.id ?? "", name: "", code: "" });
        router.refresh();
      }
    });
  });

  return (
    <ManagementCard title="Add register" description="Create a checkout station in an active store.">
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={submit} noValidate>
        <FormField label="Store" error={form.formState.errors.storeId?.message}>
          <select className={selectClassName} {...form.register("storeId")}>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Register name" error={form.formState.errors.name?.message}>
          <Input placeholder="Side Counter" {...form.register("name")} />
        </FormField>
        <FormField label="Register code" error={form.formState.errors.code?.message}>
          <Input placeholder="REG-02" {...form.register("code")} />
        </FormField>
        <div className="sm:col-span-3">
          <SubmitRow isPending={isPending} result={result} label="Create register" />
        </div>
      </form>
    </ManagementCard>
  );
}

export function CreateRoleForm({
  permissions,
}: {
  permissions: Array<{ code: string; name: string; category: string }>;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: "", code: "", description: "", permissionCodes: [] },
  });
  const categories = [...new Set(permissions.map((permission) => permission.category))];

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createRoleAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset();
        router.refresh();
      }
    });
  });

  return (
    <ManagementCard
      title="Create custom role"
      description="A role can contain only permissions you currently hold."
    >
      <form className="space-y-5" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Role name" error={form.formState.errors.name?.message}>
            <Input placeholder="Floor Supervisor" {...form.register("name")} />
          </FormField>
          <FormField label="Role code" error={form.formState.errors.code?.message}>
            <Input placeholder="floor_supervisor" {...form.register("code")} />
          </FormField>
          <FormField
            label="Description"
            error={form.formState.errors.description?.message}
          >
            <Input placeholder="Optional" {...form.register("description")} />
          </FormField>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Permissions</legend>
          {form.formState.errors.permissionCodes?.message ? (
            <p className="mt-1 text-sm text-destructive">
              {form.formState.errors.permissionCodes.message}
            </p>
          ) : null}
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {categories.map((category) => (
              <div className="rounded-lg border border-border p-3" key={category}>
                <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                  {category}
                </p>
                <div className="mt-3 grid gap-2">
                  {permissions
                    .filter((permission) => permission.category === category)
                    .map((permission) => (
                      <label
                        className="flex items-center gap-2 text-sm"
                        key={permission.code}
                      >
                        <input
                          className="size-4 accent-primary"
                          type="checkbox"
                          value={permission.code}
                          {...form.register("permissionCodes")}
                        />
                        {permission.name}
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <SubmitRow isPending={isPending} result={result} label="Create role" />
      </form>
    </ManagementCard>
  );
}

export function CreateInvitationForm({
  roles,
  stores,
}: {
  roles: Array<{ id: string; name: string }>;
  stores: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [result, setResult] = useState<
    ManagementActionResult<{ inviteUrl: string }> | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateInvitationValues>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: {
      email: "",
      employeeNumber: "",
      jobTitle: "",
      roleId: roles[0]?.id ?? "",
      storeId: stores[0]?.id ?? "",
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    setCopied(false);
    startTransition(async () => {
      const nextResult = await createEmployeeInvitationAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        form.reset({
          email: "",
          employeeNumber: "",
          jobTitle: "",
          roleId: roles[0]?.id ?? "",
          storeId: stores[0]?.id ?? "",
        });
        router.refresh();
      }
    });
  });

  const inviteUrl = result?.ok ? result.data?.inviteUrl : undefined;

  return (
    <ManagementCard
      title="Invite employee"
      description="The employee must sign in with this exact email before accepting."
    >
      <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={submit} noValidate>
        <FormField label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" placeholder="employee@business.com" {...form.register("email")} />
        </FormField>
        <FormField
          label="Employee number"
          error={form.formState.errors.employeeNumber?.message}
        >
          <Input placeholder="EMP-002" {...form.register("employeeNumber")} />
        </FormField>
        <FormField label="Job title" error={form.formState.errors.jobTitle?.message}>
          <Input placeholder="Cashier" {...form.register("jobTitle")} />
        </FormField>
        <FormField label="Role" error={form.formState.errors.roleId?.message}>
          <select className={selectClassName} {...form.register("roleId")}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Store" error={form.formState.errors.storeId?.message}>
          <select className={selectClassName} {...form.register("storeId")}>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="sm:col-span-2 lg:col-span-5">
          <SubmitRow isPending={isPending} result={result} label="Create invitation" />
        </div>
      </form>

      {inviteUrl ? (
        <div className="mt-5 rounded-lg border border-primary/25 bg-secondary p-3">
          <Label htmlFor="invite-url">One-time invitation link</Label>
          <div className="mt-2 flex gap-2">
            <Input id="invite-url" value={inviteUrl} readOnly />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
    </ManagementCard>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={isPending}
      size="sm"
      type="button"
      variant="ghost"
      onClick={() => {
        startTransition(async () => {
          const result = await revokeEmployeeInvitationAction({ invitationId });
          if (result.ok) router.refresh();
        });
      }}
    >
      {isPending ? (
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      ) : (
        <X aria-hidden="true" />
      )}
      Revoke
    </Button>
  );
}

export function AcceptInvitationButton({ token }: { token: string }) {
  const [result, formAction, isPending] = useActionState(
    acceptEmployeeInvitationFormAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input name="token" type="hidden" value={token} />
      <Button
        className="h-11 w-full"
        disabled={isPending}
        type="submit"
      >
        {isPending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <UserCheck aria-hidden="true" />
        )}
        {isPending ? "Joining business…" : "Accept invitation"}
      </Button>
      <FormMessage result={result} />
    </form>
  );
}

export function AcceptPendingInvitationButton({
  invitationId,
}: {
  invitationId: string;
}) {
  const [result, formAction, isPending] = useActionState(
    acceptPendingEmployeeInvitationFormAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input name="invitationId" type="hidden" value={invitationId} />
      <Button className="h-11 w-full" disabled={isPending} type="submit">
        {isPending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <UserCheck aria-hidden="true" />
        )}
        {isPending ? "Joining business…" : "Accept invitation"}
      </Button>
      <FormMessage result={result} />
    </form>
  );
}

function ManagementCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

function SubmitRow({
  isPending,
  result,
  label,
}: {
  isPending: boolean;
  result: ManagementActionResult<unknown> | null;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button disabled={isPending} type="submit">
        {isPending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <Plus aria-hidden="true" />
        )}
        {isPending ? "Saving…" : label}
      </Button>
      <FormMessage result={result} />
    </div>
  );
}

function FormMessage({ result }: { result: ManagementActionResult<unknown> | null }) {
  if (!result) return null;

  return (
    <p
      className={result.ok ? "text-sm text-primary" : "text-sm text-destructive"}
      role={result.ok ? "status" : "alert"}
    >
      {result.message}
    </p>
  );
}
