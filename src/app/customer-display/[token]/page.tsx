import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { CustomerDisplay } from "@/features/customer-display/customer-display";
import {
  createIdleCustomerDisplayState,
  customerDisplayStateSchema,
} from "@/features/customer-display/customer-display-types";
import { hashCustomerDisplayToken } from "@/features/customer-display/customer-display-token";
import { createClient } from "@/lib/supabase/server";

const displayTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const bootstrapSchema = z.object({
  business_name: z.string().min(1),
  store_name: z.string().min(1),
  register_name: z.string().min(1),
  realtime_topic: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  current_state: z.unknown(),
  updated_at: z.string(),
});

export const metadata = { title: "Customer display" };

export default async function CustomerDisplayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  if (!displayTokenSchema.safeParse(token).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_customer_display_bootstrap", {
    target_access_token_hash: hashCustomerDisplayToken(token),
  });
  const bootstrap = bootstrapSchema.safeParse(data);
  if (error || !bootstrap.success) notFound();

  const initialState = customerDisplayStateSchema.safeParse(bootstrap.data.current_state).success
    ? customerDisplayStateSchema.parse(bootstrap.data.current_state)
    : createIdleCustomerDisplayState(bootstrap.data.updated_at);

  return (
    <CustomerDisplay
      businessName={bootstrap.data.business_name}
      digitalReceiptBaseUrl={`/customer-display/${token}/receipt`}
      initialState={initialState}
      realtimeTopic={bootstrap.data.realtime_topic}
      registerName={bootstrap.data.register_name}
      storeName={bootstrap.data.store_name}
    />
  );
}
