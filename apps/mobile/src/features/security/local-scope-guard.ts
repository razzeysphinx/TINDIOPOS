export type LocalScope = {
  organizationId: string;
  storeId?: string | null;
  deviceId?: string | null;
};

export function assertOrganizationScope(
  expectedOrganizationId: string,
  actualOrganizationId: string,
) {
  if (
    !expectedOrganizationId
    || actualOrganizationId
      !== expectedOrganizationId
  ) {
    throw new Error(
      "LOCAL_TENANT_SCOPE_MISMATCH",
    );
  }
}

export function assertStoreScope(
  expectedStoreId: string,
  actualStoreId: string,
) {
  if (
    !expectedStoreId
    || actualStoreId
      !== expectedStoreId
  ) {
    throw new Error(
      "LOCAL_STORE_SCOPE_MISMATCH",
    );
  }
}

export function assertDeviceScope(
  expectedDeviceId: string,
  actualDeviceId: string,
) {
  if (
    !expectedDeviceId
    || actualDeviceId
      !== expectedDeviceId
  ) {
    throw new Error(
      "LOCAL_DEVICE_SCOPE_MISMATCH",
    );
  }
}