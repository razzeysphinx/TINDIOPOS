const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmptyString(value, max = 200) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= max;
}

function isoTimestamp(value) {
  return nonEmptyString(value, 80)
    && Number.isFinite(Date.parse(value));
}

function validQuantity(value) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value <= 1_000_000;
}

export function validateStoreHubEvent(value) {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "EVENT_REQUIRED" };
  }

  if (!UUID.test(value.eventId ?? "")) {
    return { ok: false, reason: "EVENT_ID_INVALID" };
  }

  if (!UUID.test(value.organizationId ?? "")) {
    return { ok: false, reason: "ORGANIZATION_ID_INVALID" };
  }

  if (!UUID.test(value.storeId ?? "")) {
    return { ok: false, reason: "STORE_ID_INVALID" };
  }

  if (!UUID.test(value.deviceId ?? "")) {
    return { ok: false, reason: "DEVICE_ID_INVALID" };
  }

  if (
    !Number.isSafeInteger(value.deviceSequence)
    || value.deviceSequence < 1
  ) {
    return { ok: false, reason: "DEVICE_SEQUENCE_INVALID" };
  }

  if (value.type !== "SALE_COMPLETED") {
    return { ok: false, reason: "EVENT_TYPE_UNSUPPORTED" };
  }

  if (!isoTimestamp(value.createdAt)) {
    return { ok: false, reason: "CREATED_AT_INVALID" };
  }

  if (!nonEmptyString(value.localReference, 80)) {
    return { ok: false, reason: "LOCAL_REFERENCE_INVALID" };
  }

  if (
    value.cloudSyncedAt !== null
    && !isoTimestamp(value.cloudSyncedAt)
  ) {
    return { ok: false, reason: "CLOUD_SYNCED_AT_INVALID" };
  }

  if (
    !Array.isArray(value.items)
    || value.items.length < 1
    || value.items.length > 100
  ) {
    return { ok: false, reason: "ITEMS_INVALID" };
  }

  const items = [];

  for (const item of value.items) {
    if (!item || typeof item !== "object") {
      return { ok: false, reason: "ITEM_INVALID" };
    }

    if (!UUID.test(item.productId ?? "")) {
      return { ok: false, reason: "PRODUCT_ID_INVALID" };
    }

    if (
      item.variantId !== null
      && !UUID.test(item.variantId ?? "")
    ) {
      return { ok: false, reason: "VARIANT_ID_INVALID" };
    }

    if (!validQuantity(item.quantity)) {
      return { ok: false, reason: "ITEM_QUANTITY_INVALID" };
    }

    items.push({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
    });
  }

  return {
    ok: true,
    event: {
      eventId: value.eventId,
      organizationId: value.organizationId,
      storeId: value.storeId,
      deviceId: value.deviceId,
      deviceSequence: value.deviceSequence,
      type: "SALE_COMPLETED",
      createdAt: value.createdAt,
      localReference: value.localReference.trim(),
      items,
      cloudSyncedAt: value.cloudSyncedAt ?? null,
    },
  };
}

export function immutableEventSignature(event) {
  return JSON.stringify({
    eventId: event.eventId,
    organizationId: event.organizationId,
    storeId: event.storeId,
    deviceId: event.deviceId,
    deviceSequence: event.deviceSequence,
    type: event.type,
    createdAt: event.createdAt,
    localReference: event.localReference,
    items: event.items,
  });
}
