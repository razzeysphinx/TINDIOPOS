// Client-safe Supabase Realtime facade.
//
// UI components must not import the browser Supabase client directly; they
// go through this facade. It only centralizes client retrieval and the
// channel factories below — channel names, private-channel configuration,
// event names, payloads, subscribe callbacks, and removal semantics stay
// exactly where they are today at each call site.

import { createClient } from "@/lib/supabase/client";

let sharedClient: ReturnType<typeof createClient> | null = null;

export function getRealtimeClient() {
  if (!sharedClient) {
    sharedClient = createClient();
  }

  return sharedClient;
}

export function customerDisplayChannel(topic: string) {
  return getRealtimeClient().channel(`tindio-customer-display:${topic}`);
}

export function kitchenOrderChannel(organizationId: string, storeId: string) {
  return getRealtimeClient().channel(`tindio:kitchen:${organizationId}:${storeId}`, {
    config: { private: true },
  });
}
