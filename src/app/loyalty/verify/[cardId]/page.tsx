import { CheckCircle2, CircleX, Clock3, Gift, ShieldCheck } from "lucide-react";
import { connection } from "next/server";
import { z } from "zod";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoyaltyCardScanActions } from "@/features/customers/loyalty-card-scan-actions";
import { getBusinessContext, hasPermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const cardIdSchema = z.uuid();
const verificationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const verificationSchema = z.object({
  verification_status: z.enum(["valid", "reward_claimed", "revoked", "replaced", "expired", "invalid"]),
  card_code: z.string().nullable(),
  stamp_count: z.number().int().nonnegative().nullable(),
  stamp_target: z.number().int().positive().nullable(),
  expires_at: z.string().nullable(),
});

export const metadata = { title: "Loyalty card verification" };

export default async function LoyaltyCardVerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  await connection();
  const [{ cardId }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.token === "string" ? query.token : "";

  let verification: z.infer<typeof verificationSchema> = {
    verification_status: "invalid",
    card_code: null,
    stamp_count: null,
    stamp_target: null,
    expires_at: null,
  };

  if (cardIdSchema.safeParse(cardId).success && verificationTokenSchema.safeParse(token).success) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("verify_loyalty_card_qr", {
      target_loyalty_card_id: cardId,
      target_verification_token: token,
    });
    const parsed = verificationSchema.safeParse(data?.[0]);
    if (parsed.success) verification = parsed.data;
  }

  const view = verificationView(verification.verification_status);
  const showStampCount = verification.verification_status === "valid" || verification.verification_status === "reward_claimed";
  const businessContext = await getBusinessContext();
  const canRecordCardAction = businessContext
    && (hasPermission(businessContext, "customers.manage") || hasPermission(businessContext, "sales.create"));

  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-5">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className={`grid size-12 place-items-center rounded-full ${view.iconClass}`}>{view.icon}</div>
          <p className="mt-3 text-xs font-semibold tracking-[0.16em] text-primary">TINDIO LOYALTY</p>
          <CardTitle className="mt-2">{view.title}</CardTitle>
          <CardDescription>{view.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {showStampCount && verification.card_code && verification.stamp_count !== null && verification.stamp_target !== null ? (
            <div className="rounded-xl border bg-secondary/30 p-5">
              <p className="font-mono text-xs font-semibold tracking-wider text-muted-foreground">{verification.card_code}</p>
              <p className="mt-3 text-4xl font-bold">{verification.stamp_count} <span className="text-xl text-muted-foreground">/ {verification.stamp_target}</span></p>
              <p className="mt-1 text-sm text-muted-foreground">verified stamps</p>
            </div>
          ) : null}
          {verification.verification_status === "valid" && canRecordCardAction ? (
            <LoyaltyCardScanActions
              cardId={cardId}
              rewardReady={(verification.stamp_count ?? 0) >= (verification.stamp_target ?? Number.MAX_SAFE_INTEGER)}
            />
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">TINDIO never stores the live stamp count in the QR code itself. This result was checked against the current card record.</p>
        </CardContent>
      </Card>
    </main>
  );
}

function verificationView(status: z.infer<typeof verificationSchema>["verification_status"]) {
  switch (status) {
    case "valid":
      return {
        title: "Loyalty card verified",
        description: "This card is active. A staff member can record the next eligible stamp in TINDIO.",
        icon: <ShieldCheck className="size-6" aria-hidden="true" />,
        iconClass: "bg-primary/10 text-primary",
      };
    case "reward_claimed":
      return {
        title: "Reward already claimed",
        description: "This card’s reward has already been recorded and cannot be claimed a second time.",
        icon: <Gift className="size-6" aria-hidden="true" />,
        iconClass: "bg-muted text-muted-foreground",
      };
    case "expired":
      return {
        title: "Loyalty card expired",
        description: "This QR card is no longer active. Please ask staff for assistance.",
        icon: <Clock3 className="size-6" aria-hidden="true" />,
        iconClass: "bg-muted text-muted-foreground",
      };
    case "revoked":
    case "replaced":
      return {
        title: "Loyalty card is inactive",
        description: "This QR card has been replaced or revoked. Please ask staff for the current card.",
        icon: <CircleX className="size-6" aria-hidden="true" />,
        iconClass: "bg-destructive/10 text-destructive",
      };
    default:
      return {
        title: "Card could not be verified",
        description: "This QR code is invalid or is no longer available. Please ask staff for assistance.",
        icon: <CheckCircle2 className="size-6" aria-hidden="true" />,
        iconClass: "bg-muted text-muted-foreground",
      };
  }
}
