import { Laptop } from "lucide-react";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { DeviceManager } from "@/features/devices/device-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "POS devices" };

type PosDeviceRow = {
  id: string;
  name: string;
  store_id: string;
  register_id: string;
  status: "active" | "revoked";
  app_version: string;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

type PosDeviceQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      order: (column: string, options: { ascending: boolean }) => Promise<{
        data: PosDeviceRow[] | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export default async function DevicesPage() {
  const context = await requireBackOfficePermission("devices.manage");
  if (!hasPermission(context, "devices.manage")) redirect("/back-office");

  const supabase = await createClient();
  const database = supabase as unknown as { from: (table: "pos_devices") => PosDeviceQuery };
  const [storesResult, registersResult, devicesResult] = await Promise.all([
    supabase.from("stores").select("id, name").eq("organization_id", context.organization.id).eq("is_active", true).order("name", { ascending: true }),
    supabase.from("registers").select("id, store_id, name, code").eq("organization_id", context.organization.id).eq("is_active", true).order("name", { ascending: true }),
    database.from("pos_devices").select("id, name, store_id, register_id, status, app_version, last_seen_at, created_at, revoked_at").eq("organization_id", context.organization.id).order("created_at", { ascending: false }),
  ]);

  const error = [storesResult, registersResult, devicesResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load POS devices: ${error.message}`);

  return <div className="space-y-8"><PageHeader eyebrow="Management" title="POS devices" description="Bind each browser or POS application to one register, monitor its last activity, and revoke it when needed." action={<Badge variant="secondary"><Laptop /> Device security</Badge>} /><DeviceManager devices={(devicesResult.data ?? []).map((device) => ({ id: device.id, name: device.name, storeId: device.store_id, registerId: device.register_id, status: device.status, appVersion: device.app_version, lastSeenAt: device.last_seen_at, createdAt: device.created_at, revokedAt: device.revoked_at }))} organizationId={context.organization.id} registers={(registersResult.data ?? []).map((register) => ({ id: register.id, storeId: register.store_id, name: register.name, code: register.code }))} stores={storesResult.data ?? []} /></div>;
}
