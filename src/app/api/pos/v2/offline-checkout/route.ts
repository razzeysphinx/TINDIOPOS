import { NextResponse } from "next/server";
import { processPosV2OfflineCheckout } from "@/features/offline/pos-v2-offline-checkout-service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";
const headers={"Cache-Control":"private, no-store"};
export async function POST(request: Request){const resolved=await getPosV2BusinessContext(request);if(!resolved.ok)return resolved.response;const input=await request.json().catch(()=>null);if(input===null)return NextResponse.json({ok:false,message:"The queued sale data is invalid.",retryable:false},{status:400,headers});try{const processed=await processPosV2OfflineCheckout(resolved.context,input);return NextResponse.json(processed.result,{status:processed.status,headers});}catch(error){console.error("TINDIO offline checkout sync failed",error);return NextResponse.json({ok:false,message:"TINDIO could not confirm this queued sale. It will remain queued for review.",retryable:true},{status:503,headers});}}
