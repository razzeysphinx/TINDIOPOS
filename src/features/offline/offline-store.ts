import type { CheckoutSaleValues } from "@/features/checkout/checkout-schema";
import type {
  PosActiveShift,
  PosCatalogItem,
  PosCategory,
  PosDiscount,
  PosPaymentMethod,
  PosRegister,
  PosStore,
  PosTaxRate,
} from "@/features/pos/pos-types";

const DATABASE_NAME = "tindio-offline";
const DATABASE_VERSION = 3;
const CHECKOUT_QUEUE_STORE = "checkout-queue";
const CATALOG_STORE = "catalog-snapshots";
const DEVICE_IDENTITY_STORE = "device-identities";
const RUNTIME_SNAPSHOT_STORE = "pos-runtime-snapshots";
const CHANGE_EVENT = "tindio-offline-store-change";
const SYNCED_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type OfflineCheckoutState =
  | "DRAFT"
  | "LOCAL_PENDING"
  | "SYNCING"
  | "SYNCED"
  | "CONFLICT"
  | "FAILED";

export type OfflineConflictType =
  | "DUPLICATE_TRANSACTION"
  | "INVALID_SHIFT"
  | "CLOSED_SHIFT"
  | "PRODUCT_ARCHIVED"
  | "PRICE_CHANGED"
  | "TAX_CHANGED"
  | "CUSTOMER_INVALID"
  | "INVENTORY_CONFLICT"
  | "PERMISSION_CHANGED"
  | "REGISTER_REVOKED"
  | "DEVICE_REVOKED";

export type OfflineLineSnapshot = {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  unit: string;
  quantity: number;
  unitPriceMinor: number;
  modifierOptionIds: string[];
  modifierTotalMinor: number;
  lineSubtotalMinor: number;
  itemNote: string | null;
};

export type OfflineCheckoutSnapshot = {
  version: 1;
  capturedAt: string;
  shift: {
    id: string;
    storeId: string;
    registerId: string;
    openedAt: string;
    openingCashMinor: number;
  };
  customer: { id: string; fullName: string } | null;
  discount: {
    id: string;
    name: string;
    discountType: "percentage" | "fixed_amount";
    percentageBps: number | null;
    amountMinor: number | null;
    appliedMinor: number;
  } | null;
  tax: {
    id: string;
    name: string;
    rateBps: number;
    isInclusive: boolean;
    appliedMinor: number;
  } | null;
  payment: {
    id: string;
    name: string;
    type: PosPaymentMethod["type"];
    offlinePolicy: PosPaymentMethod["offlinePolicy"];
    tenderedMinor: number;
    appliedMinor: number;
    changeMinor: number;
  };
  items: OfflineLineSnapshot[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
};

export type OfflineQueuedCheckout = {
  idempotencyKey: string;
  localReceiptReference: string;
  scope: string;
  deviceScope: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  state: OfflineCheckoutState;
  lastError: string | null;
  conflictType: OfflineConflictType | null;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  syncedAt: string | null;
  officialReceiptNumber: number | null;
  serverSaleId: string | null;
  payload: CheckoutSaleValues;
  snapshot: OfflineCheckoutSnapshot;
  summary: {
    currencyCode: string;
    totalMinor: number;
    tenderedMinor: number;
    changeMinor: number;
    itemCount: number;
  };
};

export type NewOfflineCheckout = Pick<
  OfflineQueuedCheckout,
  | "idempotencyKey"
  | "scope"
  | "deviceScope"
  | "deviceId"
  | "payload"
  | "snapshot"
  | "summary"
>;

export type OfflineCheckoutUpdate = Partial<Pick<
  OfflineQueuedCheckout,
  | "attempts"
  | "lastError"
  | "conflictType"
  | "state"
  | "nextRetryAt"
  | "lastAttemptAt"
  | "syncedAt"
  | "officialReceiptNumber"
  | "serverSaleId"
>>;

export type PosDeviceIdentity = {
  organizationId: string;
  deviceId: string;
  secret: string;
  appVersion: string;
  createdAt: string;
  binding?: {
    deviceId: string;
    storeId: string;
    registerId: string;
    deviceName: string;
    appVersion: string;
    lastSeenAt: string;
  };
  lastVerifiedAt?: string;
};

type OfflineCatalogSnapshot = {
  key: string;
  scope: string;
  storeId: string;
  updatedAt: string;
  items: PosCatalogItem[];
};

export type OfflinePosRuntimeSnapshot = {
  key: string;
  scope: string;
  organizationId: string;
  updatedAt: string;
  activeShift: PosActiveShift;
  store: PosStore;
  register: PosRegister;
  categories: PosCategory[];
  paymentMethods: PosPaymentMethod[];
  discounts: PosDiscount[];
  taxRates: PosTaxRate[];
  deviceId: string | null;
};

export type OfflineStorageHealth = {
  usageBytes: number | null;
  quotaBytes: number | null;
  availableBytes: number | null;
  isLow: boolean;
};

type LegacyQueuedCheckout = Partial<OfflineQueuedCheckout> & {
  state?: "queued" | "syncing" | "review" | OfflineCheckoutState;
};

function offlineStoreChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function subscribeToOfflineStore(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

function isOfflineCheckoutState(value: unknown): value is OfflineCheckoutState {
  return value === "DRAFT" || value === "LOCAL_PENDING" || value === "SYNCING" ||
    value === "SYNCED" || value === "CONFLICT" || value === "FAILED";
}

function migrateState(value: LegacyQueuedCheckout["state"]): OfflineCheckoutState {
  if (isOfflineCheckoutState(value)) return value === "SYNCING" ? "LOCAL_PENDING" : value;
  if (value === "review") return "CONFLICT";
  return "LOCAL_PENDING";
}

function localReceiptReference(idempotencyKey: string) {
  return `OFF-${idempotencyKey.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function legacySnapshot(checkout: LegacyQueuedCheckout): OfflineCheckoutSnapshot {
  const payload = checkout.payload;
  const summary = checkout.summary;
  const capturedAt = checkout.createdAt ?? new Date().toISOString();
  const items = payload?.items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    productName: "Cached item",
    variantName: null,
    sku: null,
    unit: "each",
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor ?? 0,
    modifierOptionIds: item.modifierOptionIds,
    modifierTotalMinor: 0,
    lineSubtotalMinor: Math.round((item.unitPriceMinor ?? 0) * item.quantity),
    itemNote: item.itemNote ?? null,
  })) ?? [];

  return {
    version: 1,
    capturedAt,
    shift: {
      id: "00000000-0000-0000-0000-000000000000",
      storeId: payload?.storeId ?? "00000000-0000-0000-0000-000000000000",
      registerId: payload?.registerId ?? "00000000-0000-0000-0000-000000000000",
      openedAt: capturedAt,
      openingCashMinor: 0,
    },
    customer: null,
    discount: null,
    tax: null,
    payment: {
      id: payload?.payments[0]?.paymentMethodId ?? "00000000-0000-0000-0000-000000000000",
      name: "Cash",
      type: "CASH",
      offlinePolicy: "cash",
      tenderedMinor: summary?.tenderedMinor ?? 0,
      appliedMinor: summary?.totalMinor ?? 0,
      changeMinor: summary?.changeMinor ?? 0,
    },
    items,
    subtotalMinor: summary?.totalMinor ?? 0,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: summary?.totalMinor ?? 0,
  };
}

function normalizeCheckout(value: LegacyQueuedCheckout): OfflineQueuedCheckout {
  const now = new Date().toISOString();
  const snapshot = value.snapshot && typeof value.snapshot === "object"
    ? value.snapshot as OfflineCheckoutSnapshot
    : legacySnapshot(value);
  const idempotencyKey = value.idempotencyKey ?? crypto.randomUUID();

  return {
    idempotencyKey,
    localReceiptReference: value.localReceiptReference ?? localReceiptReference(idempotencyKey),
    scope: value.scope ?? "",
    deviceScope: value.deviceScope ?? null,
    deviceId: value.deviceId ?? null,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? value.createdAt ?? now,
    attempts: typeof value.attempts === "number" ? value.attempts : 0,
    state: migrateState(value.state),
    lastError: value.lastError ?? null,
    conflictType: value.conflictType ?? null,
    nextRetryAt: value.nextRetryAt ?? null,
    lastAttemptAt: value.lastAttemptAt ?? null,
    syncedAt: value.syncedAt ?? null,
    officialReceiptNumber: value.officialReceiptNumber ?? null,
    serverSaleId: value.serverSaleId ?? null,
    payload: value.payload as CheckoutSaleValues,
    snapshot,
    summary: value.summary ?? {
      currencyCode: "PHP",
      totalMinor: snapshot.totalMinor,
      tenderedMinor: snapshot.payment.tenderedMinor,
      changeMinor: snapshot.payment.changeMinor,
      itemCount: snapshot.items.reduce((count, item) => count + item.quantity, 0),
    },
  };
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline storage is unavailable in this browser."));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) return;

      let checkoutStore: IDBObjectStore;
      if (!database.objectStoreNames.contains(CHECKOUT_QUEUE_STORE)) {
        checkoutStore = database.createObjectStore(CHECKOUT_QUEUE_STORE, {
          keyPath: "idempotencyKey",
        });
        checkoutStore.createIndex("scope", "scope", { unique: false });
      } else {
        checkoutStore = transaction.objectStore(CHECKOUT_QUEUE_STORE);
      }
      if (!checkoutStore.indexNames.contains("scope")) {
        checkoutStore.createIndex("scope", "scope", { unique: false });
      }
      if (!checkoutStore.indexNames.contains("state")) {
        checkoutStore.createIndex("state", "state", { unique: false });
      }

      if (event.oldVersion < 3) {
        const cursorRequest = checkoutStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          cursor.update(normalizeCheckout(cursor.value as LegacyQueuedCheckout));
          cursor.continue();
        };
      }

      if (!database.objectStoreNames.contains(CATALOG_STORE)) {
        const store = database.createObjectStore(CATALOG_STORE, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
      }

      if (!database.objectStoreNames.contains(DEVICE_IDENTITY_STORE)) {
        database.createObjectStore(DEVICE_IDENTITY_STORE, { keyPath: "organizationId" });
      }

      if (!database.objectStoreNames.contains(RUNTIME_SNAPSHOT_STORE)) {
        const store = database.createObjectStore(RUNTIME_SNAPSHOT_STORE, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed."));
  });
}

function transactionFinished(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed."));
  });
}

async function readFromStore<T>(
  storeName: string,
  reader: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const value = await requestResult(reader(transaction.objectStore(storeName)));
    await transactionFinished(transaction);
    return value;
  } finally {
    database.close();
  }
}

async function writeToStore<T>(
  storeName: string,
  writer: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const value = await requestResult(writer(transaction.objectStore(storeName)));
    await transactionFinished(transaction);
    offlineStoreChanged();
    return value;
  } finally {
    database.close();
  }
}

export async function enqueueOfflineCheckout(checkout: NewOfflineCheckout) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHECKOUT_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(CHECKOUT_QUEUE_STORE);
    const existing = await requestResult(
      store.get(checkout.idempotencyKey) as IDBRequest<LegacyQueuedCheckout | undefined>,
    );

    if (existing) {
      await transactionFinished(transaction);
      return normalizeCheckout(existing);
    }

    const now = new Date().toISOString();
    const queued: OfflineQueuedCheckout = {
      ...checkout,
      localReceiptReference: localReceiptReference(checkout.idempotencyKey),
      attempts: 0,
      createdAt: now,
      lastError: null,
      conflictType: null,
      nextRetryAt: null,
      lastAttemptAt: null,
      officialReceiptNumber: null,
      serverSaleId: null,
      state: "LOCAL_PENDING",
      syncedAt: null,
      updatedAt: now,
    };
    await requestResult(store.add(queued));
    await transactionFinished(transaction);
    offlineStoreChanged();
    return queued;
  } finally {
    database.close();
  }
}

export async function listOfflineCheckouts(scope: string) {
  const values = await readFromStore(
    CHECKOUT_QUEUE_STORE,
    (store) => store.index("scope").getAll(scope) as IDBRequest<LegacyQueuedCheckout[]>,
  );

  return values
    .map(normalizeCheckout)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function updateOfflineCheckout(
  idempotencyKey: string,
  change: OfflineCheckoutUpdate,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHECKOUT_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(CHECKOUT_QUEUE_STORE);
    const current = await requestResult(
      store.get(idempotencyKey) as IDBRequest<LegacyQueuedCheckout | undefined>,
    );
    if (!current) {
      await transactionFinished(transaction);
      return null;
    }

    const next: OfflineQueuedCheckout = {
      ...normalizeCheckout(current),
      ...change,
      updatedAt: new Date().toISOString(),
    };
    await requestResult(store.put(next));
    await transactionFinished(transaction);
    offlineStoreChanged();
    return next;
  } finally {
    database.close();
  }
}

export async function pruneSyncedOfflineCheckouts(scope: string, now = Date.now()) {
  const entries = await listOfflineCheckouts(scope);
  const expired = entries.filter((entry) =>
    entry.state === "SYNCED" && entry.syncedAt !== null &&
    now - new Date(entry.syncedAt).getTime() > SYNCED_RECEIPT_RETENTION_MS,
  );
  if (expired.length === 0) return 0;

  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHECKOUT_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(CHECKOUT_QUEUE_STORE);
    for (const entry of expired) store.delete(entry.idempotencyKey);
    await transactionFinished(transaction);
    offlineStoreChanged();
    return expired.length;
  } finally {
    database.close();
  }
}

export async function cachePosCatalog(
  scope: string,
  storeId: string,
  items: PosCatalogItem[],
) {
  if (!scope || !storeId || items.length === 0) return;

  const key = `${scope}:${storeId}`;
  const existing = await readFromStore(
    CATALOG_STORE,
    (store) => store.get(key) as IDBRequest<OfflineCatalogSnapshot | undefined>,
  );
  const itemByKey = new Map(
    (existing?.items ?? []).map((item) => [`${item.productId}:${item.variantId ?? "simple"}`, item]),
  );
  for (const item of items) {
    itemByKey.set(`${item.productId}:${item.variantId ?? "simple"}`, item);
  }

  const snapshot: OfflineCatalogSnapshot = {
    key,
    scope,
    storeId,
    updatedAt: new Date().toISOString(),
    items: [...itemByKey.values()],
  };
  await writeToStore(CATALOG_STORE, (store) => store.put(snapshot));
}

export async function getCachedPosCatalog(scope: string, storeId: string) {
  return readFromStore(
    CATALOG_STORE,
    (store) => store.get(`${scope}:${storeId}`) as IDBRequest<OfflineCatalogSnapshot | undefined>,
  );
}

export async function cachePosRuntimeSnapshot(
  snapshot: Omit<OfflinePosRuntimeSnapshot, "key" | "updatedAt">,
) {
  if (!snapshot.scope || !snapshot.activeShift.id) return;
  const value: OfflinePosRuntimeSnapshot = {
    ...snapshot,
    key: `${snapshot.scope}:${snapshot.register.id}`,
    updatedAt: new Date().toISOString(),
  };
  await writeToStore(RUNTIME_SNAPSHOT_STORE, (store) => store.put(value));
  return value;
}

export async function getCachedPosRuntimeSnapshot(scope: string, registerId: string) {
  return readFromStore(
    RUNTIME_SNAPSHOT_STORE,
    (store) => store.get(`${scope}:${registerId}`) as IDBRequest<OfflinePosRuntimeSnapshot | undefined>,
  );
}

export async function getPosDeviceIdentity(organizationId: string) {
  if (!organizationId) return undefined;

  return readFromStore(
    DEVICE_IDENTITY_STORE,
    (store) => store.get(organizationId) as IDBRequest<PosDeviceIdentity | undefined>,
  );
}

export async function savePosDeviceIdentity(identity: PosDeviceIdentity) {
  await writeToStore(DEVICE_IDENTITY_STORE, (store) => store.put(identity));
  return identity;
}

export async function getOfflineStorageHealth(): Promise<OfflineStorageHealth> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usageBytes: null, quotaBytes: null, availableBytes: null, isLow: false };
  }

  const estimate = await navigator.storage.estimate();
  const usageBytes = estimate.usage ?? null;
  const quotaBytes = estimate.quota ?? null;
  const availableBytes = usageBytes !== null && quotaBytes !== null
    ? Math.max(0, quotaBytes - usageBytes)
    : null;
  const usageRatio = usageBytes !== null && quotaBytes !== null
    ? usageBytes / quotaBytes
    : 0;
  const isLow = availableBytes !== null && (
    availableBytes < 10 * 1024 * 1024 || usageRatio >= 0.9
  );

  return { usageBytes, quotaBytes, availableBytes, isLow };
}
