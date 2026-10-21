import { NextResponse } from "next/server";
import {
  POS_OFFLINE_CHECKOUT_INVALID_MESSAGE,
  POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE,
} from "@tindio/contracts/offline-checkout";
import { processPosV2OfflineCheckout } from "@/features/offline/pos-v2-offline-checkout-service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";
const headers={"Cache-Control":"private, no-store"};
export async function POST(request: Request){const resolved=await getPosV2BusinessContext(request);if(!resolved.ok)return resolved.response;const input=await request.json().catch(()=>null);if(input===null)return NextResponse.json({ok:false,message:POS_OFFLINE_CHECKOUT_INVALID_MESSAGE,retryable:false},{status:400,headers});try{const processed=await processPosV2OfflineCheckout(resolved.context,input);return NextResponse.json(processed.result,{status:processed.status,headers});}catch(error){console.error("TINDIO offline checkout sync failed",error);return NextResponse.json({ok:false,message:POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE,retryable:true},{status:503,headers});}}
