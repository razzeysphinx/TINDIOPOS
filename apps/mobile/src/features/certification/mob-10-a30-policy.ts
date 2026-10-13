export const MOB_10_A30_COUNTS = [100, 1_000] as const;

export type Mob10A30Count = typeof MOB_10_A30_COUNTS[number];

export type Mob10A30PolicyInput = {
  buildProfile: string | undefined;
  campaign: string | undefined;
  organizationName: string;
  productName: string;
  count: number;
  isOffline: boolean;
  isPrepared: boolean;
  unresolvedCount: number;
};

export function isMob10A30CertificationBuild(
  buildProfile = process.env.EAS_BUILD_PROFILE,
  campaign = process.env.EXPO_PUBLIC_TINDIO_CERTIFICATION_CAMPAIGN,
) {
  return buildProfile !== "production" && campaign === "MOB10_A30";
}

export function validateMob10A30Policy(input: Mob10A30PolicyInput) {
  if (!isMob10A30CertificationBuild(input.buildProfile, input.campaign)) {
    return "CERTIFICATION_BUILD_REQUIRED" as const;
  }
  if (!MOB_10_A30_COUNTS.includes(input.count as Mob10A30Count)) {
    return "UNSUPPORTED_QUEUE_SIZE" as const;
  }
  if (!input.organizationName.toLocaleLowerCase().includes("certification")) {
    return "CERTIFICATION_ORGANIZATION_REQUIRED" as const;
  }
  if (!input.productName.toLocaleLowerCase().includes("certification")) {
    return "CERTIFICATION_PRODUCT_REQUIRED" as const;
  }
  if (!input.isOffline) return "OFFLINE_MODE_REQUIRED" as const;
  if (!input.isPrepared) return "OFFLINE_PREPARATION_REQUIRED" as const;
  if (input.unresolvedCount !== 0) return "EMPTY_UNRESOLVED_QUEUE_REQUIRED" as const;
  return null;
}

export async function runMob10A30AcceptanceLoop<T>(input: {
  count: Mob10A30Count;
  accept: (index: number) => Promise<T>;
  onProgress?: (completed: number) => void;
}) {
  const accepted: T[] = [];
  for (let index = 0; index < input.count; index += 1) {
    accepted.push(await input.accept(index));
    if (accepted.length % 10 === 0 || accepted.length === input.count) {
      input.onProgress?.(accepted.length);
    }
  }
  return accepted;
}
