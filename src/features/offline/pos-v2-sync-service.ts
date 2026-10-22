import { z } from "zod";
import { posSyncPushRequestSchema } from "@tindio/contracts/sync-push";
import { posDeviceRequestHeaders, posDeviceValidationSchema } from "@/features/devices/device-schema";
import type { BusinessContext } from "@/lib/auth/dal";
import { createBusinessContextClient } from "@/lib/supabase/context-client";
export const syncDeviceBodySchema=posDeviceValidationSchema;
export const syncPullBodySchema=posDeviceValidationSchema.extend({cursor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),limit:z.number().int().min(1).max(200).optional()});
export const syncPushBodySchema=posSyncPushRequestSchema;
export type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Array<Record<string,unknown>>|null;error:{message?:string}|null}>};
export async function validatedSyncDevice(context: BusinessContext,input: z.infer<typeof syncDeviceBodySchema>){if(input.organizationId!==context.organization.id)return null;const database=await createBusinessContextClient(context,{headers:posDeviceRequestHeaders(input.device)}) as unknown as RpcClient;const validation=await database.rpc("validate_pos_device",{target_organization_id:context.organization.id,target_device_id:input.device.deviceId,target_secret:input.device.secret,target_app_version:input.device.appVersion});const row=validation.data?.[0];if(validation.error||!row||String(row.device_id)!==input.device.deviceId)return null;return{database,device:{deviceId:input.device.deviceId,storeId:String(row.store_id),registerId:String(row.register_id),deviceName:String(row.name??"POS device"),appVersion:String(row.app_version??input.device.appVersion),lastSeenAt:row.last_seen_at?String(row.last_seen_at):null,status:String(row.status??"active")}};}
