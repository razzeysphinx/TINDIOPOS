export const STORE_HUB_RELEASE_SCOPE =
  "DEFERRED_FROM_V1" as const;

export const STORE_HUB_DEFERRED_REASON =
  "STORE_HUB_DEFERRED_FROM_RELEASE" as const;

export function isStoreHubEnabledForRelease() {
  return false;
}
