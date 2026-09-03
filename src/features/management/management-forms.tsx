"use client";

import { useActionState, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, LoaderCircle, Pencil, Plus, UserCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";

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
import { Label } from "@/components/ui/label";
import {
  acceptEmployeeInvitationFormAction,
  acceptPendingEmployeeInvitationFormAction,
  createEmployeeInvitationAction,
  createRegisterAction,
  createRoleAction,
  createStoreAction,
  revokeEmployeeInvitationAction,
  updateEmployeeAssignmentsAction,
  updateRegisterAction,
  updateRoleAction,
  updateStoreAction,
} from "@/features/management/actions";
import type { ManagementActionResult } from "@/features/management/management-types";
import {
  createInvitationSchema,
  createRegisterSchema,
  createRoleSchema,
  createStoreSchema,
  type CreateInvitationValues,
  type CreateRegisterValues,
  type CreateRoleValues,
  type CreateStoreValues,
  type UpdateRegisterValues,
  type UpdateEmployeeAssignmentsValues,
  type UpdateRoleValues,
  type UpdateStoreValues,
  updateEmployeeAssignmentsSchema,
  updateRegisterSchema,
  updateRoleSchema,
  updateStoreSchema,
} from "@/features/management/management-schema";

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateStoreForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateStoreValues>({
    resolver: zodResolver(createStoreSchema),
    defaultValues: { name: "", code: "", address: "", phone: "" },
  });
  const resetForm = () => form.reset({ name: "", code: "", address: "", phone: "" });
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setResult(null);
      resetForm();
    }
  };

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createStoreAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        resetForm();
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger className={buttonVariants()}>
        <Plus aria-hidden="true" />
        Add store
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add store</DialogTitle>
          <DialogDescription>Create another business location.</DialogDescription>
        </DialogHeader>
        <DialogBody>
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
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function CreateRegisterForm({
  stores,
}: {
  stores: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateRegisterValues>({
    resolver: zodResolver(createRegisterSchema),
    defaultValues: { storeId: stores[0]?.id ?? "", name: "", code: "" },
  });
  const resetForm = () => form.reset({ storeId: stores[0]?.id ?? "", name: "", code: "" });
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setResult(null);
      resetForm();
    }
  };

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await createRegisterAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        resetForm();
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger className={buttonVariants()}>
        <Plus aria-hidden="true" />
        Add register
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add register</DialogTitle>
          <DialogDescription>Create a checkout station in an active store.</DialogDescription>
        </DialogHeader>
        <DialogBody>
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
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function EditStoreButton({
  onSaved,
  store,
}: {
  onSaved?: (updated: { address: string; isActive: boolean; name: string; phone: string }) => void;
  store: {
    id: string;
    name: string;
    code: string;
    address: string | null;
    phone: string | null;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateStoreValues>({
    resolver: zodResolver(updateStoreSchema),
    defaultValues: {
      storeId: store.id,
      name: store.name,
      address: store.address ?? "",
      phone: store.phone ?? "",
      isActive: store.isActive,
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateStoreAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        router.refresh();
        onSaved?.({
          name: values.name,
          address: values.address,
          phone: values.phone,
          isActive: values.isActive,
        });
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Pencil aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit store</DialogTitle>
          <DialogDescription>
            Store code {store.code} remains stable for historical records and device links.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={submit}>
            <FormField label="Store name" error={form.formState.errors.name?.message}>
              <Input autoFocus {...form.register("name")} />
            </FormField>
            <FormField label="Store code">
              <Input readOnly value={store.code} />
            </FormField>
            <FormField label="Address" error={form.formState.errors.address?.message}>
              <Input {...form.register("address")} />
            </FormField>
            <FormField label="Phone" error={form.formState.errors.phone?.message}>
              <Input {...form.register("phone")} />
            </FormField>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium sm:col-span-2">
              <input className="size-4 accent-primary" type="checkbox" {...form.register("isActive")} />
              Active store
            </label>
            <div className="sm:col-span-2">
              <DialogFooter>
                <Button disabled={isPending} type="submit">
                  {isPending ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                  Save store
                </Button>
                <FormMessage result={result} />
              </DialogFooter>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function EditRegisterButton({
  register,
  onSaved,
}: {
  register: {
    id: string;
    name: string;
    code: string;
    storeName: string;
    isActive: boolean;
  };
  onSaved?: (updated: { isActive: boolean; name: string }) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateRegisterValues>({
    resolver: zodResolver(updateRegisterSchema),
    defaultValues: {
      registerId: register.id,
      name: register.name,
      isActive: register.isActive,
    },
  });

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateRegisterAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        router.refresh();
        onSaved?.({ name: values.name, isActive: values.isActive });
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Pencil aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit register</DialogTitle>
          <DialogDescription>
            This register remains assigned to {register.storeName}; its code stays stable for shifts and devices.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-4" noValidate onSubmit={submit}>
            <FormField label="Register name" error={form.formState.errors.name?.message}>
              <Input autoFocus {...form.register("name")} />
            </FormField>
            <FormField label="Register code">
              <Input readOnly value={register.code} />
            </FormField>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium">
              <input className="size-4 accent-primary" type="checkbox" {...form.register("isActive")} />
              Active register
            </label>
            <DialogFooter>
              <Button disabled={isPending} type="submit">
                {isPending ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                Save register
              </Button>
              <FormMessage result={result} />
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function CreateRoleForm({
  permissions,
}: {
  permissions: Array<{ code: string; name: string; category: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants()}>
        <Plus aria-hidden="true" />
        Add role
      </DialogTrigger>
      <DialogContent size="large">
        <DialogHeader>
          <DialogTitle>Create custom role</DialogTitle>
          <DialogDescription>Create a custom access bundle only when a ready-made role does not fit. You can include only access you already have.</DialogDescription>
        </DialogHeader>
        <DialogBody>
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
          <legend className="text-sm font-medium">Choose the access this role includes</legend>
          <p className="mt-1 text-xs text-muted-foreground">These detailed choices are optional. Start with a ready-made role for most employees.</p>
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
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function EditRoleButton({
  role,
  permissions,
}: {
  role: { id: string; name: string; code: string; description: string | null; permissionCodes: string[] };
  permissions: Array<{ code: string; name: string; category: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateRoleValues>({
    resolver: zodResolver(updateRoleSchema),
    defaultValues: {
      roleId: role.id,
      name: role.name,
      description: role.description ?? "",
      permissionCodes: role.permissionCodes,
    },
  });
  const selectedPermissions = useWatch({ control: form.control, name: "permissionCodes" }) ?? [];
  const categories = [...new Set(permissions.map((permission) => permission.category))];

  const togglePermission = (permissionCode: string, checked: boolean) => {
    form.setValue(
      "permissionCodes",
      checked
        ? [...selectedPermissions, permissionCode]
        : selectedPermissions.filter((code) => code !== permissionCode),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateRoleAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Pencil aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent size="large">
        <DialogHeader>
          <DialogTitle>Edit {role.name}</DialogTitle>
          <DialogDescription>
            This role&apos;s identifier remains stable. You can include only access you currently have.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="space-y-5" noValidate onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Role name" error={form.formState.errors.name?.message}>
                <Input autoFocus {...form.register("name")} />
              </FormField>
              <FormField label="Role code">
                <Input readOnly value={role.code} />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Description" error={form.formState.errors.description?.message}>
                  <Input {...form.register("description")} />
                </FormField>
              </div>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Choose the access this role includes</legend>
              {form.formState.errors.permissionCodes?.message ? (
                <p className="mt-1 text-sm text-destructive">{form.formState.errors.permissionCodes.message}</p>
              ) : null}
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {categories.map((category) => (
                  <div className="rounded-lg border border-border p-3" key={category}>
                    <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{category}</p>
                    <div className="mt-3 grid gap-2">
                      {permissions.filter((permission) => permission.category === category).map((permission) => (
                        <label className="flex items-center gap-2 text-sm" key={permission.code}>
                          <input
                            checked={selectedPermissions.includes(permission.code)}
                            className="size-4 accent-primary"
                            onChange={(event) => togglePermission(permission.code, event.target.checked)}
                            type="checkbox"
                          />
                          {permission.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
            <DialogFooter>
              <Button disabled={isPending} type="submit">
                {isPending ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                Save role
              </Button>
              <FormMessage result={result} />
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

export function EditEmployeeButton({
  employee,
  roles,
  stores,
  lockOwnRoleAndStatus = false,
  organizationWideStoreAccess = false,
}: {
  employee: {
    id: string;
    jobTitle: string | null;
    status: "active" | "inactive" | "suspended" | "archived";
    roleIds: string[];
    storeIds: string[];
  };
  roles: Array<{ id: string; name: string }>;
  stores: Array<{ id: string; name: string }>;
  lockOwnRoleAndStatus?: boolean;
  organizationWideStoreAccess?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ManagementActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateEmployeeAssignmentsValues>({
    resolver: zodResolver(updateEmployeeAssignmentsSchema),
    defaultValues: {
      employeeId: employee.id,
      jobTitle: employee.jobTitle ?? "",
      status: employee.status,
      roleIds: employee.roleIds,
      storeIds: employee.storeIds,
    },
  });
  const selectedRoles = useWatch({ control: form.control, name: "roleIds" }) ?? [];
  const selectedStores = useWatch({ control: form.control, name: "storeIds" }) ?? [];

  const toggle = (field: "roleIds" | "storeIds", value: string, checked: boolean) => {
    const selected = field === "roleIds" ? selectedRoles : selectedStores;
    form.setValue(field, checked ? [...selected, value] : selected.filter((id) => id !== value), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const submit = form.handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateEmployeeAssignmentsAction(values);
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Pencil aria-hidden="true" />
        Edit employee
      </DialogTrigger>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Edit employee</DialogTitle>
          <DialogDescription>
            Choose the person&apos;s role and stores, then review the summary before saving. The change is recorded for accountability.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="space-y-5" noValidate onSubmit={submit}>
            <div className="grid gap-4">
              <FormField label="Job title" error={form.formState.errors.jobTitle?.message}>
                <Input autoFocus {...form.register("jobTitle")} />
              </FormField>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">What this person mainly does</legend>
              <p className="mt-1 text-xs text-muted-foreground">Start with the role that best matches their daily work. Custom roles are supported when needed.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {roles.map((role) => (
                  <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" key={role.id}>
                    <input
                        checked={selectedRoles.includes(role.id)}
                        className="size-4 accent-primary"
                        disabled={lockOwnRoleAndStatus}
                      onChange={(event) => toggle("roleIds", role.id, event.target.checked)}
                      type="checkbox"
                    />
                    {role.name}
                  </label>
                ))}
              </div>
              {form.formState.errors.roleIds?.message ? <p className="mt-2 text-xs text-destructive">{form.formState.errors.roleIds.message}</p> : null}
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">Stores they can work in</legend>
              {organizationWideStoreAccess ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Organization managers are automatically assigned to every active store. Store access updates when stores are added or activated.
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {stores.map((store) => (
                  <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" key={store.id}>
                    <input
                        checked={selectedStores.includes(store.id)}
                        className="size-4 accent-primary"
                        disabled={organizationWideStoreAccess}
                      onChange={(event) => toggle("storeIds", store.id, event.target.checked)}
                      type="checkbox"
                    />
                    {store.name}
                  </label>
                ))}
              </div>
              {form.formState.errors.storeIds?.message ? <p className="mt-2 text-xs text-destructive">{form.formState.errors.storeIds.message}</p> : null}
            </fieldset>
            <section aria-label="Access review" className="rounded-xl border bg-muted/20 p-4">
              <p className="text-sm font-medium">Review access</p>
              <p className="mt-1 text-xs text-muted-foreground">This employee will receive the included access from the selected roles at the selected stores.</p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Roles</dt><dd className="mt-1 font-medium">{roles.filter((role) => selectedRoles.includes(role.id)).map((role) => role.name).join(", ") || "No role selected"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Stores</dt><dd className="mt-1 font-medium">{organizationWideStoreAccess ? "All active stores" : stores.filter((store) => selectedStores.includes(store.id)).map((store) => store.name).join(", ") || "No store selected"}</dd></div>
              </dl>
            </section>
            <DialogFooter>
              <Button disabled={isPending} type="submit">
                {isPending ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                Save employee
              </Button>
              <FormMessage result={result} />
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
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
  const [open, setOpen] = useState(false);
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants()}>
        <Plus aria-hidden="true" />
        Invite employee
      </DialogTrigger>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>Invite employee</DialogTitle>
          <DialogDescription>The employee must sign in with this exact email before accepting.</DialogDescription>
        </DialogHeader>
        <DialogBody>
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
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
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
    <DialogFooter>
      <Button disabled={isPending} type="submit">
        {isPending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <Plus aria-hidden="true" />
        )}
        {isPending ? "Saving…" : label}
      </Button>
      <FormMessage result={result} />
    </DialogFooter>
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
