"use client";

import {
  ArrowLeft,
  Barcode,
  CircleMinus,
  CirclePlus,
  Eraser,
  History,
  ImageIcon,
  Keyboard,
  LockKeyhole,
  LoaderCircle,
  LogIn,
  LogOut,
  MonitorSmartphone,
  PackageOpen,
  Search,
  ShoppingBag,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { PaymentScreen } from "@/features/checkout/payment-screen";
import type { CheckoutPaymentSummary } from "@/features/checkout/checkout-types";
import { usePosDevice, type PosDeviceState } from "@/features/devices/pos-device";
import type { PosDeviceCredential } from "@/features/devices/device-schema";
import { OfflineQueueStatus } from "@/features/offline/offline-queue-status";
import { focusCustomerPicker, PosOperationalDrawer } from "@/features/pos/pos-operational-drawer";
import { readPosWorkspacePreferences } from "@/features/pos/pos-preferences";
import { PosWorkspaceHeader } from "@/features/pos/pos-workspace-header";
import {
  cachePosCatalog,
  cachePosRuntimeSnapshot,
  getCachedPosCatalog,
} from "@/features/offline/offline-store";
import {
  type CustomerDisplayState,
  type PosCustomerDisplaySession,
} from "@/features/customer-display/customer-display-types";
import { PosCustomerPicker } from "@/features/customers/pos-customer-picker";
import { signOutAction } from "@/features/auth/actions";
import { closeShiftAction, openShiftAction } from "@/features/shifts/actions";
import type { TimeClockEntry } from "@/features/time-clock/time-clock-types";
import { setPosFavoriteTileAction } from "@/features/pos/actions";
import {
  posItemKey,
  type PosCartLine,
  type PosCatalogItem,
  type PosCatalogResponse,
  type PosActiveShift,
  type PosCategory,
  type PosCustomer,
  type PosDiningOption,
  type PosDiscount,
  type PosLoyaltyProgram,
  type PosPaymentMethod,
  type PosOpenTicket,
  type PosRegister,
  type PosStore,
  type PosTicketAssignee,
  type PosTicketTemplate,
  type PosTaxRate,
} from "@/features/pos/pos-types";
import { cn } from "@/lib/utils";
import { customerDisplayChannel, getRealtimeClient } from "@/lib/supabase/realtime-client";
import { cancelOpenTicketAction, saveOpenTicketAction } from "@/features/advanced-sales/ticket-actions";
import { TicketOperationsDialog, TicketSaveDialog } from "@/features/advanced-sales/ticket-workspace-dialogs";

type ModifierGroup = { id: string; name: string; minSelections: number; maxSelections: number; options: Array<{ id: string; name: string; priceMinor: number }> };

const PAGE_SIZE = 24;
const CUSTOMER_DISPLAY_DEBOUNCE_MS = 125;

type CompletedCustomerDisplaySale = {
  saleId: string;
  receiptNumber: number;
  totalMinor: number;
  changeMinor: number;
  payments: CheckoutPaymentSummary[];
};

const selectClassName =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function PosSignOutButton() {
  return (
    <form action={signOutAction}>
      <Button size="sm" type="submit" variant="outline">
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}

function createCheckoutKey() {
  return crypto.randomUUID();
}

function lineTotalMinor(priceMinor: number, quantity: number) {
  return Math.round(priceMinor * quantity);
}

export function PosTerminal({
  activeShift: initialActiveShift,
  canAccessBackOffice,
  canAcceptPayments,
  canApplyDiscounts,
  canAssignTickets,
  canUseDining,
  canUseCustomerLoyalty,
  canUseOpenTickets,
  canUseShiftControls,
  canUseTimeClock,
  canViewReceipts,
  canCloseShift,
  canEditQuantity,
  canOpenShift,
  canManageTiles,
  canRemoveItems,
  categories,
  customerDisplaySessions,
  deviceManagementEnabled,
  diningOptions,
  discounts,
  currencyCode,
  employeeName,
  initialItems,
  initialFavoriteItems,
  initialRecentItems,
  loyaltyProgram,
  organizationName,
  openTickets: initialOpenTickets,
  offlineScope,
  organizationId,
  paymentMethods,
  registers: allRegisters,
  stores: allStores,
  taxRates,
  ticketAssignees,
  ticketTemplates,
  timeClockEntry,
  timezone,
}: {
  activeShift: PosActiveShift | null;
  canAccessBackOffice: boolean;
  canAcceptPayments: boolean;
  canApplyDiscounts: boolean;
  canAssignTickets: boolean;
  canUseDining: boolean;
  canUseCustomerLoyalty: boolean;
  canUseOpenTickets: boolean;
  canUseShiftControls: boolean;
  canUseTimeClock: boolean;
  canViewReceipts: boolean;
  canCloseShift: boolean;
  canEditQuantity: boolean;
  canOpenShift: boolean;
  canManageTiles: boolean;
  canRemoveItems: boolean;
  categories: PosCategory[];
  customerDisplaySessions: PosCustomerDisplaySession[];
  deviceManagementEnabled: boolean;
  diningOptions: PosDiningOption[];
  discounts: PosDiscount[];
  currencyCode: string;
  employeeName: string;
  initialItems: PosCatalogItem[];
  initialFavoriteItems: PosCatalogItem[];
  initialRecentItems: PosCatalogItem[];
  loyaltyProgram: PosLoyaltyProgram | null;
  organizationName: string;
  openTickets: PosOpenTicket[];
  offlineScope: string;
  organizationId: string;
  paymentMethods: PosPaymentMethod[];
  registers: PosRegister[];
  stores: PosStore[];
  taxRates: PosTaxRate[];
  ticketAssignees: PosTicketAssignee[];
  ticketTemplates: PosTicketTemplate[];
  timeClockEntry: TimeClockEntry | null;
  timezone: string;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const displayChannelRef = useRef<RealtimeChannel | null>(null);
  const displayStateRef = useRef<CustomerDisplayState | null>(null);
  const [activeShift, setActiveShift] = useState(initialActiveShift);
  const [selectedStoreSelectionId, setSelectedStoreId] = useState(initialActiveShift?.storeId ?? "");
  const [selectedRegisterSelectionId, setSelectedRegisterId] = useState(initialActiveShift?.registerId ?? "");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState(initialItems);
  const [favoriteItems, setFavoriteItems] = useState(initialFavoriteItems);
  const [recentItems, setRecentItems] = useState(initialRecentItems);
  const [catalogView, setCatalogView] = useState<"all" | "favorites" | "recent">("all");
  const [hasMore, setHasMore] = useState(initialItems.length === PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [itemLayout, setItemLayout] = useState<"grid" | "list">("grid");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [taxRateId, setTaxRateId] = useState<string | null>(() => taxRates.find((rate) => rate.isDefault)?.id ?? null);
  const [diningOptionId, setDiningOptionId] = useState<string | null>(() => diningOptions.find((option) => option.isDefault)?.id ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkoutKey, setCheckoutKey] = useState(createCheckoutKey);
  const [isPaymentScreenOpen, setIsPaymentScreenOpen] = useState(false);
  const [isShiftCloseOpen, setIsShiftCloseOpen] = useState(false);
  const [completedDisplaySale, setCompletedDisplaySale] = useState<CompletedCustomerDisplaySale | null>(null);
  const [modifierPicker, setModifierPicker] = useState<{ item: PosCatalogItem; groups: ModifierGroup[]; manualPriceMinor: number | null } | null>(null);
  const [manualPricePicker, setManualPricePicker] = useState<PosCatalogItem | null>(null);
  const [openTickets, setOpenTickets] = useState(initialOpenTickets);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [isTicketEditorOpen, setIsTicketEditorOpen] = useState(false);
  const [isTicketWorkspaceOpen, setIsTicketWorkspaceOpen] = useState(false);
  const [isTicketPending, startTicketTransition] = useTransition();
  const [isFavoritePending, startFavoriteTransition] = useTransition();
  const posDevice = usePosDevice({ organizationId, required: deviceManagementEnabled });
  const deviceCredential: PosDeviceCredential | null = posDevice.state === "ready" ? posDevice.credential : null;
  const deviceBinding = posDevice.state === "ready" ? posDevice.binding : null;
  const stores = deviceBinding
    ? allStores.filter((store) => store.id === deviceBinding.storeId)
    : allStores;
  const registers = deviceBinding
    ? allRegisters.filter((register) => register.id === deviceBinding.registerId && register.storeId === deviceBinding.storeId)
    : allRegisters;

  const selectedStoreId = deviceBinding?.storeId ?? selectedStoreSelectionId;
  const selectedRegisterId = deviceBinding?.registerId ?? selectedRegisterSelectionId;

  const selectedStore = stores.find((store) => store.id === selectedStoreId);
  const selectedRegister = registers.find((register) => register.id === selectedRegisterId);
  const availablePaymentMethods = paymentMethods.filter(
    (method) => method.storeId === selectedStoreId,
  );
  const hasOpenShift =
    activeShift?.storeId === selectedStoreId &&
    activeShift.registerId === selectedRegisterId;
  const isOperational = Boolean(selectedStore && selectedRegister && hasOpenShift);

  useEffect(() => {
    const syncPreferences = () => {
      setItemLayout(readPosWorkspacePreferences(offlineScope).itemLayout);
    };

    syncPreferences();
    window.addEventListener("tindio-pos-preferences", syncPreferences);
    return () => window.removeEventListener("tindio-pos-preferences", syncPreferences);
  }, [offlineScope]);
  const favoriteItemKeys = useMemo(
    () => new Set(favoriteItems.map((item) => posItemKey(item))),
    [favoriteItems],
  );
  const displayedItems = catalogView === "favorites"
    ? favoriteItems
    : catalogView === "recent"
      ? recentItems
      : items;
  const cartSummary = useMemo(() => {
      const subtotalMinor = cart.reduce(
        (total, line) => total + lineTotalMinor(line.priceMinor, line.quantity),
        0,
      );
      const discount = discounts.find((item) => item.id === discountId);
      const discountMinor = discount
        ? Math.min(subtotalMinor, discount.discountType === "percentage" ? Math.round(subtotalMinor * (discount.percentageBps ?? 0) / 10_000) : (discount.amountMinor ?? 0))
        : 0;
      const tax = taxRates.find((item) => item.id === taxRateId);
      const taxableMinor = subtotalMinor - discountMinor;
      const taxMinor = tax ? (tax.isInclusive ? Math.round(taxableMinor * tax.rateBps / (10_000 + tax.rateBps)) : Math.round(taxableMinor * tax.rateBps / 10_000)) : 0;
      return { itemCount: cart.reduce((total, line) => total + line.quantity, 0), subtotalMinor, discountMinor, taxMinor, taxInclusive: tax?.isInclusive ?? false, totalMinor: taxableMinor + (tax?.isInclusive ? 0 : taxMinor) };
    }, [cart, discountId, discounts, taxRateId, taxRates]);
  const selectedDiscount = discounts.find((item) => item.id === discountId) ?? null;
  const selectedTaxRate = taxRates.find((item) => item.id === taxRateId) ?? null;
  const activeCustomerDisplaySession = customerDisplaySessions.find(
    (session) => session.registerId === selectedRegisterId,
  );
  const customerDisplayState = useMemo<CustomerDisplayState>(() => ({
    status: completedDisplaySale
      ? "complete"
      : isPaymentScreenOpen
        ? "payment"
        : cart.length > 0
          ? "cart"
          : "idle",
    currencyCode,
    items: cart.map((line) => ({
      name: line.productName,
      variantName: line.variantName,
      modifiers: (line.modifiers ?? []).map((modifier) => modifier.name),
      quantity: line.quantity,
      lineTotalMinor: lineTotalMinor(line.priceMinor, line.quantity),
    })),
    subtotalMinor: cartSummary.subtotalMinor,
    discountMinor: cartSummary.discountMinor,
    taxMinor: cartSummary.taxMinor,
    totalMinor: completedDisplaySale?.totalMinor ?? cartSummary.totalMinor,
    payments: completedDisplaySale?.payments.map((payment) => ({
      name: payment.name,
      amountMinor: payment.amountMinor,
      tenderedMinor: payment.tenderedMinor,
      changeMinor: payment.changeMinor,
    })) ?? [],
    customer: selectedCustomer
      ? { name: selectedCustomer.fullName, loyaltyPoints: selectedCustomer.loyaltyPoints }
      : null,
    saleId: completedDisplaySale?.saleId ?? null,
    receiptNumber: completedDisplaySale?.receiptNumber ?? null,
    changeMinor: completedDisplaySale?.changeMinor ?? 0,
    updatedAt: new Date().toISOString(),
  }), [
    cart,
    cartSummary.discountMinor,
    cartSummary.subtotalMinor,
    cartSummary.taxMinor,
    cartSummary.totalMinor,
    completedDisplaySale,
    currencyCode,
    isPaymentScreenOpen,
    selectedCustomer,
  ]);

  useEffect(() => {
    displayStateRef.current = customerDisplayState;
  }, [customerDisplayState]);

  useEffect(() => {
    if (!isOperational || !activeCustomerDisplaySession) {
      displayChannelRef.current = null;
      return;
    }

    const supabase = getRealtimeClient();
    const channel = customerDisplayChannel(activeCustomerDisplaySession.realtimeTopic)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          displayChannelRef.current = channel;
          const currentState = displayStateRef.current;
          if (currentState) {
            void channel.send({ type: "broadcast", event: "display-state", payload: currentState });
          }
        }
      });

    return () => {
      if (displayChannelRef.current === channel) displayChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [activeCustomerDisplaySession, isOperational]);

  useEffect(() => {
    if (!isOperational || !activeCustomerDisplaySession) return;

    const timeout = window.setTimeout(() => {
      void fetch("/api/pos/customer-display", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeCustomerDisplaySession.sessionId,
          state: customerDisplayState,
        }),
      });

      if (displayChannelRef.current) {
        void displayChannelRef.current.send({
          type: "broadcast",
          event: "display-state",
          payload: customerDisplayState,
        });
      }
    }, CUSTOMER_DISPLAY_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [activeCustomerDisplaySession, customerDisplayState, isOperational]);
  const canStartPayment =
    !isPaymentScreenOpen &&
    canAcceptPayments &&
    cart.length > 0 &&
    selectedRegister !== undefined &&
    isOperational &&
    availablePaymentMethods.length > 0;

  const requestCatalog = useCallback(
    async ({
      categoryId = selectedCategoryId,
      offset = 0,
      query = search,
      storeId = selectedStoreId,
    }: {
      categoryId?: string | null;
      offset?: number;
      query?: string;
      storeId?: string;
    } = {}) => {
      const params = new URLSearchParams({
        store: storeId,
        offset: String(offset),
        limit: String(PAGE_SIZE),
      });

      if (query.trim()) params.set("query", query.trim());
      if (categoryId) params.set("category", categoryId);

      const response = await fetch(`/api/pos/catalog?${params.toString()}`);
      const payload = (await response.json()) as PosCatalogResponse | { error?: string };

      if (!response.ok || !("items" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "The POS catalogue could not be loaded.",
        );
      }

      return payload;
    },
    [search, selectedCategoryId, selectedStoreId],
  );

  const loadCatalog = useCallback(
    async (
      offset = 0,
      append = false,
      overrides: { categoryId?: string | null; query?: string; storeId?: string } = {},
    ) => {
      if (!isOperational || (!selectedStoreId && !overrides.storeId)) return null;

      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setCatalogError(null);

      try {
        const payload = await requestCatalog({ ...overrides, offset });

        if (requestId !== requestIdRef.current) return null;

        setItems((current) => (append ? [...current, ...payload.items] : payload.items));
        setHasMore(payload.hasMore);
        return payload;
      } catch (error) {
        if (requestId === requestIdRef.current) {
          const offline = !navigator.onLine;
          const snapshot = offline && !append
            ? await getCachedPosCatalog(offlineScope, overrides.storeId ?? selectedStoreId)
            : undefined;

          if (snapshot) {
            const normalizedQuery = (overrides.query ?? search).trim().toLocaleLowerCase();
            const categoryId = overrides.categoryId ?? selectedCategoryId;
            const cachedItems = snapshot.items.filter((item) =>
              (!categoryId || item.categoryId === categoryId) &&
              (!normalizedQuery || [item.productName, item.variantName, item.sku, item.barcode]
                .filter((value): value is string => Boolean(value))
                .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))),
            );
            setItems(cachedItems);
            setHasMore(false);
            setCatalogError("Offline catalogue — showing items previously loaded on this device.");
            return { items: cachedItems, hasMore: false };
          }

          setCatalogError(
            error instanceof Error ? error.message : "The POS catalogue could not be loaded.",
          );
        }
        return null;
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [isOperational, offlineScope, requestCatalog, search, selectedCategoryId, selectedStoreId],
  );

  useEffect(() => {
    if (!offlineScope || !selectedStoreId || items.length === 0) return;
    void cachePosCatalog(offlineScope, selectedStoreId, items).catch(() => undefined);
  }, [items, offlineScope, selectedStoreId]);

  useEffect(() => {
    if (!offlineScope || !activeShift || !selectedStore || !selectedRegister) return;
    void cachePosRuntimeSnapshot({
      scope: offlineScope,
      organizationId,
      activeShift,
      store: selectedStore,
      register: selectedRegister,
      categories,
      paymentMethods: availablePaymentMethods,
      discounts,
      taxRates,
      deviceId: deviceCredential?.deviceId ?? null,
    }).catch(() => undefined);
  }, [
    activeShift,
    availablePaymentMethods,
    categories,
    deviceCredential?.deviceId,
    discounts,
    offlineScope,
    organizationId,
    selectedRegister,
    selectedStore,
    taxRates,
  ]);

  useEffect(() => {
    if (!isOperational || !selectedStoreId) return;

    const timer = window.setTimeout(
      () => void loadCatalog(),
      search.trim() ? 180 : 0,
    );

    return () => window.clearTimeout(timer);
  }, [isOperational, loadCatalog, search, selectedCategoryId, selectedStoreId]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isOperational) return;

      if (
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
        event.key === "F2"
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOperational]);

  const addToCart = useCallback(
    (
      item: PosCatalogItem,
      modifiers: Array<{ id: string; name: string; priceMinor: number }> = [],
      manualPriceMinor: number | null = null,
    ) => {
      if (!isOperational || isPaymentScreenOpen) return;

      setCart((current) => {
        const cartItem: PosCartLine = {
          ...item,
          priceMinor: (manualPriceMinor ?? item.priceMinor) + modifiers.reduce((sum, modifier) => sum + modifier.priceMinor, 0),
          manualPriceMinor,
          quantity: 1,
          modifierOptionIds: modifiers.map((modifier) => modifier.id),
          modifiers,
        };
        const itemKey = posItemKey(cartItem);
        const existing = current.find((line) => posItemKey(line) === itemKey);

        if (existing) {
          if (!canEditQuantity) {
            setNotice("You do not have permission to change cart quantities.");
            return current;
          }
          return current.map((line) =>
            posItemKey(line) === itemKey
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          );
        }

        return [...current, cartItem];
      });
      setCheckoutKey(createCheckoutKey());
      setCompletedDisplaySale(null);
      setNotice(`${item.productName}${item.variantName ? ` / ${item.variantName}` : ""} added.`);
    },
    [canEditQuantity, isOperational, isPaymentScreenOpen],
  );

  const addWithModifiers = async (item: PosCatalogItem, manualPriceMinor: number | null = null) => {
    if (!item.hasModifiers) { addToCart(item, [], manualPriceMinor); return; }
    try {
      const response = await fetch(`/api/pos/modifiers?${new URLSearchParams({ product: item.productId, store: selectedStoreId })}`);
      const payload = await response.json() as { groups?: ModifierGroup[]; error?: string };
      if (!response.ok || !payload.groups) throw new Error(payload.error);
      if (payload.groups.length === 0) { addToCart(item, [], manualPriceMinor); return; }
      setModifierPicker({ item, groups: payload.groups, manualPriceMinor });
    } catch { setNotice("Modifiers could not be loaded. Try again."); }
  };

  const handleProductClick = (item: PosCatalogItem) => {
    if (item.isVariablePrice) {
      setManualPricePicker(item);
      return;
    }
    void addWithModifiers(item);
  };

  const toggleFavorite = (item: PosCatalogItem) => {
    const itemKey = posItemKey(item);
    const isFavorite = favoriteItemKeys.has(itemKey);

    startFavoriteTransition(async () => {
      const result = await setPosFavoriteTileAction({
        storeId: selectedStoreId,
        productId: item.productId,
        variantId: item.variantId,
        isFavorite: !isFavorite,
      });
      setNotice(result.message);

      if (!result.ok) return;

      setFavoriteItems((current) => {
        if (result.isFavorite) {
          return current.some((candidate) => posItemKey(candidate) === itemKey)
            ? current
            : [...current, item];
        }

        return current.filter((candidate) => posItemKey(candidate) !== itemKey);
      });
    });
  };

  const setLineQuantity = useCallback(
    (itemKey: string, quantity: number) => {
      if (!isOperational || isPaymentScreenOpen) return;

      const normalizedQuantity = Math.round(quantity * 1000) / 1000;
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity > 10_000) {
        setNotice("Use a quantity between 0.001 and 10,000.");
        return;
      }

      setCart((current) => {
        const currentLine = current.find((line) => posItemKey(line) === itemKey);
        if (!currentLine) return current;
        if (normalizedQuantity <= 0 && !canRemoveItems) {
          setNotice("You do not have permission to remove cart items.");
          return current;
        }
        if (normalizedQuantity > 0 && normalizedQuantity !== currentLine.quantity && !canEditQuantity) {
          setNotice("You do not have permission to change cart quantities.");
          return current;
        }
        return normalizedQuantity <= 0
          ? current.filter((line) => posItemKey(line) !== itemKey)
          : current.map((line) =>
              posItemKey(line) === itemKey
                ? {
                    ...line,
                    quantity: line.allowFractionalQuantity
                      ? normalizedQuantity
                      : Math.max(1, Math.round(normalizedQuantity)),
                  }
                : line,
            );
      });
      setCheckoutKey(createCheckoutKey());
      setCompletedDisplaySale(null);
    },
    [canEditQuantity, canRemoveItems, isOperational, isPaymentScreenOpen],
  );

  const handleSearchSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isOperational) return;
    const term = search.trim();

    if (!term) {
      searchRef.current?.focus();
      return;
    }

    const result = await loadCatalog(0, false, { query: term });
    const normalizedTerm = term.toLocaleLowerCase();
    const exactMatch = result?.items.find(
      (item) =>
        item.barcode?.toLocaleLowerCase() === normalizedTerm ||
        item.sku?.toLocaleLowerCase() === normalizedTerm,
    );

    if (exactMatch) {
      handleProductClick(exactMatch);
      setSearch("");
      searchRef.current?.focus();
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOperational) return;
    if (event.key === "Escape") {
      setSearch("");
      setNotice(null);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      document.querySelector<HTMLButtonElement>("[data-pos-catalog-product]")?.focus();
    }
  };

  const handleProductKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const productButtons = document.querySelectorAll<HTMLButtonElement>(
      "[data-pos-catalog-product]",
    );
    const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? index + 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? index - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? productButtons.length - 1
            : null;

    if (nextIndex === null || productButtons.length === 0) return;

    event.preventDefault();
    productButtons[Math.min(Math.max(nextIndex, 0), productButtons.length - 1)]?.focus();
  };

  const clearCart = () => {
    if (!isOperational || isPaymentScreenOpen) return;
    if (!canRemoveItems) {
      setNotice("You do not have permission to remove cart items.");
      return;
    }

    setCart([]);
    setSelectedCustomer(null);
    setDiscountId(null);
    setTaxRateId(taxRates.find((rate) => rate.isDefault)?.id ?? null);
    setDiningOptionId(diningOptions.find((option) => option.isDefault)?.id ?? null);
    setCheckoutKey(createCheckoutKey());
    setCompletedDisplaySale(null);
    setNotice("Cart cleared.");
  };

  const openPaymentScreen = () => {
    if (!isOperational) return;

    if (!canStartPayment) {
      if (cart.length > 0 && availablePaymentMethods.length === 0) {
        setNotice("No payment methods are enabled for this store.");
      } else if (cart.length > 0 && selectedRegister && !hasOpenShift) {
        setNotice("Open a register shift before charging a sale.");
      }
      return;
    }

    setNotice(null);
    setIsPaymentScreenOpen(true);
  };

  const submitTicket = (values: { label: string; note: string; diningOptionId: string | null; assignedEmployeeId: string | null }) => {
    if (!canUseOpenTickets) {
      setNotice("Open tickets are disabled for this business.");
      return;
    }
    if (!selectedRegister || cart.length === 0) return;
    const savedCart = cart.map((line) => line.ticketLineId ? line : { ...line, ticketLineId: crypto.randomUUID() });
    startTicketTransition(async () => {
      const result = await saveOpenTicketAction({
        storeId: selectedStoreId,
        registerId: selectedRegister.id,
        ticketId: activeTicketId,
        device: deviceCredential,
        customerId: selectedCustomer?.id ?? null,
        diningOptionId: values.diningOptionId,
        assignedEmployeeId: values.assignedEmployeeId,
        label: values.label,
        note: values.note,
        cart: savedCart,
      });
      setNotice(result.message);
      if (!result.ok) return;

      const savedTicket: PosOpenTicket = {
        id: result.ticketId,
        label: values.label,
        note: values.note || null,
        customer: selectedCustomer,
        diningOptionId: values.diningOptionId,
        assignedEmployeeId: values.assignedEmployeeId,
        cart: savedCart,
        updatedAt: new Date().toISOString(),
      };
      setCart(savedCart);
      setActiveTicketId(result.ticketId);
      setOpenTickets((current) => [savedTicket, ...current.filter((ticket) => ticket.id !== result.ticketId)]);
      setIsTicketEditorOpen(false);
      router.refresh();
    });
  };

  const editLineNote = (itemKey: string, currentNote: string | null | undefined) => {
    const nextNote = window.prompt("Item note (up to 500 characters)", currentNote ?? "");
    if (nextNote === null) return;
    if (nextNote.trim().length > 500) {
      setNotice("Item notes can contain up to 500 characters.");
      return;
    }
    setCart((current) => current.map((line) => posItemKey(line) === itemKey ? { ...line, itemNote: nextNote.trim() || null } : line));
    setCheckoutKey(createCheckoutKey());
  };

  const handleShiftOpened = (shift: PosActiveShift) => {
    setActiveShift(shift);
    setSelectedStoreId(shift.storeId);
    setSelectedRegisterId(shift.registerId);
    setCart([]);
    setItems([]);
    setFavoriteItems([]);
    setRecentItems([]);
    setHasMore(false);
    setSearch("");
    setSelectedCategoryId(null);
    setCatalogError(null);
    setCheckoutKey(createCheckoutKey());
    setCompletedDisplaySale(null);
    setNotice("Shift open. The POS is ready for sales.");
    router.refresh();
  };

  const handleShiftClosed = () => {
    setIsShiftCloseOpen(false);
    setActiveShift(null);
    setCart([]);
    setSelectedCustomer(null);
    setActiveTicketId(null);
    setIsPaymentScreenOpen(false);
    setCheckoutKey(createCheckoutKey());
    router.refresh();
  };

  if (deviceManagementEnabled && posDevice.state !== "ready") {
    return <PosDeviceConfigurationState canAccessBackOffice={canAccessBackOffice} employeeName={employeeName} organizationName={organizationName} state={posDevice} />;
  }

  if (stores.length === 0) {
    return <PosConfigurationState canAccessBackOffice={canAccessBackOffice} employeeName={employeeName} organizationName={organizationName} type="store" />;
  }

  if (registers.length === 0) {
    return <PosConfigurationState canAccessBackOffice={canAccessBackOffice} employeeName={employeeName} organizationName={organizationName} type="register" />;
  }

  if (!isOperational) {
    return (
      <PosShiftGate
        canOpenShift={canOpenShift}
        canUseShiftControls={canUseShiftControls}
        canUseTimeClock={canUseTimeClock}
        canViewReceipts={canViewReceipts}
        currencyCode={currencyCode}
        employeeName={employeeName}
        device={deviceCredential}
        onShiftOpened={handleShiftOpened}
        organizationName={organizationName}
        registers={registers}
        stores={stores}
        timeClockEntry={timeClockEntry}
        timezone={timezone}
      />
    );
  }

  return (
    <>
      <main className="min-h-svh bg-background lg:h-svh lg:overflow-hidden">
        <div className="grid min-h-svh grid-rows-[auto_1fr] lg:h-svh">
        <PosWorkspaceHeader
          canAccessBackOffice={canAccessBackOffice}
          canCloseShift={canCloseShift}
          canCreateSales
          canUseShiftControls={canUseShiftControls}
          canUseTimeClock={canUseTimeClock}
          canViewReceipts={canViewReceipts}
          closeShiftDisabled={cart.length > 0 || isPaymentScreenOpen}
          employeeName={employeeName}
          itemCount={cartSummary.itemCount}
          onCloseShift={() => setIsShiftCloseOpen(true)}
          onSelectCustomer={canUseCustomerLoyalty && !isPaymentScreenOpen ? focusCustomerPicker : undefined}
          organizationName={organizationName}
          scope={offlineScope}
          stores={stores}
          timeClockEntry={timeClockEntry}
          timezone={timezone}
          title="Ticket"
        />
        <header className="hidden flex-col gap-3 border-b bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="order-1 self-start">
            <PosOperationalDrawer
              canCreateSales
              canUseShiftControls={canUseShiftControls}
              canUseTimeClock={canUseTimeClock}
              canViewReceipts={canViewReceipts}
              employeeName={employeeName}
              organizationName={organizationName}
              stores={stores}
              timeClockEntry={timeClockEntry}
              timezone={timezone}
            />
          </div>
          <div className="order-2 flex min-w-0 flex-col items-end gap-3 sm:flex-row sm:items-center">
          <div className="order-1 flex min-w-0 items-center gap-3 sm:order-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShoppingBag className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">TINDIO POS <span className="font-normal text-muted-foreground">· {organizationName}</span></p>
              <p className="truncate text-xs text-muted-foreground">
                {selectedStore?.name} · {selectedRegister?.name} · {employeeName} · Shift opened {activeShift ? formatShiftOpenedAt(activeShift.openedAt) : "just now"}
              </p>
            </div>
          </div>

          <div className="order-2 flex flex-wrap items-center gap-2 sm:order-1">
            <Badge variant="outline">{currencyCode}</Badge>
            <OfflineQueueStatus scope={offlineScope} />
            <Button
              aria-label="Select customer"
              disabled={isPaymentScreenOpen}
              onClick={focusCustomerPicker}
              size="icon"
              title="Select customer"
              type="button"
              variant="outline"
            >
              <UserRound aria-hidden="true" />
            </Button>
            {canCloseShift ? (
              <Button
                disabled={cart.length > 0 || isPaymentScreenOpen}
                onClick={() => setIsShiftCloseOpen(true)}
                size="sm"
                title={cart.length > 0 ? "Clear or hold the current cart before closing the shift." : undefined}
                type="button"
                variant="outline"
              >
                <LockKeyhole aria-hidden="true" />
                Close shift
              </Button>
            ) : null}
          </div>
          </div>
        </header>

        {stores.length > 0 ? (
          <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
            <section className="min-h-0 border-b lg:overflow-y-auto lg:border-r lg:border-b-0" aria-labelledby="pos-catalog-title">
              <div className="border-b bg-card px-4 py-4 sm:px-5 lg:sticky lg:top-0 lg:z-10">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h1 className="text-xl font-semibold tracking-[-0.025em]" id="pos-catalog-title">
                      {selectedStore?.name || "Product catalogue"}
                    </h1>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Select an item or scan a barcode to add it to this temporary cart.
                    </p>
                  </div>
                  <Badge variant="secondary">
                    <Keyboard aria-hidden="true" />
                    Ctrl K / F2 to search
                  </Badge>
                </div>

                <form className="mt-4" onSubmit={handleSearchSubmit}>
                  <label className="sr-only" htmlFor="pos-search">
                    Search by product, SKU, or barcode
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      autoComplete="off"
                      autoFocus
                      className="h-11 pr-11 pl-10 text-base"
                      id="pos-search"
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setCatalogView("all");
                      }}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Search products, SKU, or scan barcode"
                      ref={searchRef}
                      value={search}
                    />
                    <Barcode
                      className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-primary"
                      aria-hidden="true"
                    />
                  </div>
                </form>

                <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="POS workspace views">
                  <CategoryButton
                    active={catalogView === "all"}
                    label="Catalogue"
                    onClick={() => setCatalogView("all")}
                  />
                  <CategoryButton
                    active={catalogView === "favorites"}
                    label={`Favorites${favoriteItems.length ? ` (${favoriteItems.length})` : ""}`}
                    onClick={() => {
                      setCatalogView("favorites");
                      setSearch("");
                      setSelectedCategoryId(null);
                    }}
                  />
                  <CategoryButton
                    active={catalogView === "recent"}
                    label={`Recent${recentItems.length ? ` (${recentItems.length})` : ""}`}
                    onClick={() => {
                      setCatalogView("recent");
                      setSearch("");
                      setSelectedCategoryId(null);
                    }}
                  />
                </div>

                {categories.length > 0 ? (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categories">
                    <CategoryButton
                      active={catalogView === "all" && selectedCategoryId === null}
                      label="All items"
                      onClick={() => {
                        setCatalogView("all");
                        setSelectedCategoryId(null);
                      }}
                    />
                    {categories.map((category) => (
                      <CategoryButton
                        active={catalogView === "all" && selectedCategoryId === category.id}
                        color={category.color}
                        key={category.id}
                        label={category.name}
                        onClick={() => {
                          setCatalogView("all");
                          setSelectedCategoryId(category.id);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 p-4 sm:p-5">
                {catalogError ? (
                  <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
                    {catalogError}
                  </div>
                ) : null}
                {displayedItems.length > 0 ? (
                  <>
                    <div className={cn(
                      "grid gap-3",
                      itemLayout === "grid"
                        ? "min-[420px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                        : "grid-cols-1",
                    )}>
                      {displayedItems.map((item, index) => (
                        <ProductButton
                          canManageTiles={canManageTiles}
                          currencyCode={currencyCode}
                          disabled={!isOperational || isPaymentScreenOpen}
                          item={item}
                          key={posItemKey(item)}
                          isFavorite={favoriteItemKeys.has(posItemKey(item))}
                          isFavoritePending={isFavoritePending}
                          onClick={() => void handleProductClick(item)}
                          onKeyDown={(event) => handleProductKeyDown(event, index)}
                          onToggleFavorite={() => toggleFavorite(item)}
                        />
                      ))}
                    </div>
                    {catalogView === "all" && hasMore ? (
                      <div className="mt-5 flex justify-center">
                        <Button
                          disabled={!isOperational || isLoading}
                          onClick={() => void loadCatalog(items.length, true)}
                          size="lg"
                          type="button"
                          variant="outline"
                        >
                          {isLoading ? <LoaderCircle className="animate-spin" /> : null}
                          Load more items
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : catalogView === "all" && isLoading ? (
                  <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      Loading catalogue…
                    </span>
                  </div>
                ) : (
                  <EmptyCatalogue search={search} view={catalogView} />
                )}
              </div>
            </section>

            <aside className="flex min-h-0 flex-col bg-card" aria-labelledby="cart-title">
              <div className="flex items-center justify-between border-b px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-lg font-semibold" id="cart-title">
                    Current cart
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {cartSummary.itemCount} {cartSummary.itemCount === 1 ? "item" : "items"}
                  </p>
                </div>
                {cart.length > 0 ? (
                  <Button
                    disabled={isPaymentScreenOpen}
                    onClick={clearCart}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Eraser aria-hidden="true" />
                    Clear
                  </Button>
                ) : null}
              </div>

              <PosCustomerPicker
                disabled={isPaymentScreenOpen}
                onChange={(customer) => {
                  setSelectedCustomer(customer);
                  setCheckoutKey(createCheckoutKey());
                }}
                storeId={selectedStoreId}
                value={selectedCustomer}
              />
              <div className="border-b px-4 py-3 sm:px-5"><div className="flex flex-wrap items-center gap-2"><Button disabled={cart.length === 0 || isPaymentScreenOpen || isTicketPending} onClick={() => setIsTicketEditorOpen(true)} size="sm" type="button" variant="outline">{isTicketPending ? "Saving…" : activeTicketId ? "Update ticket" : "Hold ticket"}</Button>{openTickets.length > 1 ? <Button disabled={isPaymentScreenOpen || isTicketPending} onClick={() => setIsTicketWorkspaceOpen(true)} size="sm" type="button" variant="ghost">Manage tickets</Button> : null}{openTickets.map((ticket) => <span className="inline-flex items-center gap-1" key={ticket.id}><Button disabled={isPaymentScreenOpen} onClick={() => { setCart(ticket.cart); setSelectedCustomer(ticket.customer); setDiningOptionId(ticket.diningOptionId); setActiveTicketId(ticket.id); setCheckoutKey(createCheckoutKey()); setNotice(`${ticket.label} loaded.`); }} size="sm" type="button" variant={ticket.id === activeTicketId ? "secondary" : "ghost"}>{ticket.label}</Button><button aria-label={`Cancel ${ticket.label}`} className="text-xs text-muted-foreground hover:text-destructive" disabled={isTicketPending} onClick={() => startTicketTransition(async () => { const result = await cancelOpenTicketAction({ ticketId: ticket.id, device: deviceCredential }); setNotice(result.message); if (result.ok) { setOpenTickets((current) => current.filter((item) => item.id !== ticket.id)); if (activeTicketId === ticket.id) setActiveTicketId(null); router.refresh(); } })} type="button">×</button></span>)}</div></div>

              <div className="grid gap-2 border-b px-4 py-3 sm:grid-cols-3 sm:px-5">
                {canApplyDiscounts ? <label className="grid gap-1 text-xs font-medium text-muted-foreground">Discount
                  <select className={selectClassName} disabled={isPaymentScreenOpen} onChange={(event) => { setDiscountId(event.target.value || null); setCheckoutKey(createCheckoutKey()); }} value={discountId ?? ""}>
                    <option value="">No discount</option>{discounts.map((discount) => <option key={discount.id} value={discount.id}>{discount.name}</option>)}
                  </select>
                </label> : null}
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">Tax
                  <select className={selectClassName} disabled={isPaymentScreenOpen} onChange={(event) => { setTaxRateId(event.target.value || null); setCheckoutKey(createCheckoutKey()); }} value={taxRateId ?? ""}>
                    <option value="">No tax</option>{taxRates.map((tax) => <option key={tax.id} value={tax.id}>{tax.name}{tax.isInclusive ? " (inclusive)" : ""}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">Dining
                  <select className={selectClassName} disabled={isPaymentScreenOpen || !canUseDining} onChange={(event) => { setDiningOptionId(event.target.value || null); setCheckoutKey(createCheckoutKey()); }} value={diningOptionId ?? ""}>
                    <option value="">No dining option</option>{diningOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
              </div>

              {notice ? (
                <p aria-live="polite" className="border-b bg-secondary/60 px-4 py-2 text-xs text-secondary-foreground sm:px-5">
                  {notice}
                </p>
              ) : null}

              <div className="min-h-48 flex-1 overflow-y-auto">
                {cart.length > 0 ? (
                  <ul className="divide-y">
                    {cart.map((line) => (
                      <CartLine
                        currencyCode={currencyCode}
                        canEditQuantity={canEditQuantity}
                        canRemoveItems={canRemoveItems}
                        disabled={!isOperational || isPaymentScreenOpen}
                        key={posItemKey(line)}
                        line={line}
                        onEditNote={() => editLineNote(posItemKey(line), line.itemNote)}
                        onQuantityChange={(quantity) =>
                          setLineQuantity(posItemKey(line), quantity)
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="grid min-h-48 place-items-center px-8 text-center">
                    <div>
                      <span className="mx-auto grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
                        <ShoppingBag className="size-5" aria-hidden="true" />
                      </span>
                      <p className="mt-3 text-sm font-medium">Cart is ready</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Add products from the catalogue or use a barcode scanner.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t bg-muted/35 p-4 sm:p-5">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatMinorMoney(cartSummary.subtotalMinor, currencyCode)}</span>
                </div>
                {cartSummary.discountMinor > 0 ? <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground"><span>Discount</span><span>-{formatMinorMoney(cartSummary.discountMinor, currencyCode)}</span></div> : null}
                {cartSummary.taxMinor > 0 ? <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground"><span>{cartSummary.taxInclusive ? "Included tax" : "Tax"}</span><span>{formatMinorMoney(cartSummary.taxMinor, currencyCode)}</span></div> : null}
                <div className="mt-2 flex items-end justify-between gap-4">
                  <span className="text-base font-semibold">Total</span>
                  <span className="text-2xl font-semibold tracking-[-0.03em]">
                    {formatMinorMoney(cartSummary.totalMinor, currencyCode)}
                  </span>
                </div>
                <Button
                  className="mt-4 h-11 w-full"
                  disabled={!canStartPayment}
                  onClick={openPaymentScreen}
                  type="button"
                >
                  Charge
                </Button>
                <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
                  {!selectedRegister
                    ? "Choose an active register before charging a sale."
                    : !hasOpenShift
                      ? "Open a shift for this register before charging a sale."
                    : availablePaymentMethods.length === 0
                      ? "No payment method is enabled for this store."
                      : "Choose a payment method on the next screen. Prices, payments, receipt, and tracked stock changes are committed together."}
                </p>
              </div>
            </aside>
          </div>
        ) : (
          <div className="grid min-h-96 place-items-center p-6 text-center">
            <div className="max-w-sm">
              <PackageOpen className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
              <h1 className="mt-4 text-xl font-semibold">No assigned active store</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Ask a manager to assign this employee to an active store before opening the POS.
              </p>
              <Button
                className="mt-5"
                nativeButton={false}
                render={<Link href="/back-office/stores" />}
              >
                Return to stores
              </Button>
            </div>
          </div>
        )}
        </div>
      </main>
      {isPaymentScreenOpen && selectedRegister && activeShift ? (
        <PaymentScreen
          activeShift={activeShift}
          cart={cart}
          currencyCode={currencyCode}
          device={deviceCredential}
          deviceScope={organizationId}
          idempotencyKey={checkoutKey}
          customer={selectedCustomer}
          loyaltyProgram={loyaltyProgram}
          offlineScope={offlineScope}
          onCancel={() => setIsPaymentScreenOpen(false)}
          onComplete={(checkout) => {
            setCompletedDisplaySale({
              saleId: checkout.saleId,
              receiptNumber: checkout.receiptNumber,
              totalMinor: checkout.totalMinor,
              changeMinor: checkout.changeMinor,
              payments: checkout.payments,
            });
            setNotice(null);
          }}
          onNewSale={() => {
            setRecentItems((current) => {
              const saleItems = cart.filter(
                (line, index, allLines) =>
                  allLines.findIndex((candidate) => posItemKey(candidate) === posItemKey(line)) === index,
              );
              const combined = [...saleItems, ...current];
              return combined.filter(
                (line, index) =>
                  combined.findIndex((candidate) => posItemKey(candidate) === posItemKey(line)) === index,
              ).slice(0, 12);
            });
            setCart([]);
            setSelectedCustomer(null);
            setActiveTicketId(null);
            setOpenTickets((current) => current.filter((ticket) => ticket.id !== activeTicketId));
            setCheckoutKey(createCheckoutKey());
            setCompletedDisplaySale(null);
            setIsPaymentScreenOpen(false);
            setNotice("Ready for a new sale.");
          }}
          paymentMethods={availablePaymentMethods}
          register={selectedRegister}
          storeId={selectedStoreId}
          totalMinor={cartSummary.totalMinor}
          discountId={discountId}
          discountMinor={cartSummary.discountMinor}
          diningOptionId={diningOptionId}
          openTicketId={activeTicketId}
          taxRateId={taxRateId}
          taxMinor={cartSummary.taxMinor}
          subtotalMinor={cartSummary.subtotalMinor}
          selectedDiscount={selectedDiscount}
          selectedTaxRate={selectedTaxRate}
        />
      ) : null}
      {isShiftCloseOpen && activeShift ? (
        <PosCloseShiftDialog
          currencyCode={currencyCode}
          onCancel={() => setIsShiftCloseOpen(false)}
          onClosed={handleShiftClosed}
          shiftId={activeShift.id}
        />
      ) : null}
      {manualPricePicker ? (
        <ManualPriceDialog
          currencyCode={currencyCode}
          item={manualPricePicker}
          onCancel={() => setManualPricePicker(null)}
          onConfirm={(manualPriceMinor) => {
            setManualPricePicker(null);
            void addWithModifiers(manualPricePicker, manualPriceMinor);
          }}
        />
      ) : null}
      {modifierPicker ? (
        <ModifierPicker
          currencyCode={currencyCode}
          groups={modifierPicker.groups}
          item={modifierPicker.item}
          onCancel={() => setModifierPicker(null)}
          onConfirm={(modifiers) => {
            addToCart(modifierPicker.item, modifiers, modifierPicker.manualPriceMinor);
            setModifierPicker(null);
          }}
        />
      ) : null}
      {isTicketEditorOpen ? <TicketSaveDialog assignees={ticketAssignees} canAssign={canAssignTickets} diningOptions={diningOptions} onClose={() => setIsTicketEditorOpen(false)} onSave={submitTicket} templates={ticketTemplates} ticket={openTickets.find((ticket) => ticket.id === activeTicketId) ?? null} /> : null}
      {isTicketWorkspaceOpen ? <TicketOperationsDialog device={deviceCredential} onClose={() => setIsTicketWorkspaceOpen(false)} onComplete={(message) => { setNotice(message); setIsTicketWorkspaceOpen(false); router.refresh(); }} tickets={openTickets} /> : null}
    </>
  );
}

function PosCloseShiftDialog({
  currencyCode,
  onCancel,
  onClosed,
  shiftId,
}: {
  currencyCode: string;
  onCancel: () => void;
  onClosed: () => void;
  shiftId: string;
}) {
  const [countedCash, setCountedCash] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await closeShiftAction({ shiftId, countedCash, closingNote });
      setMessage(result.message);
      if (result.ok) onClosed();
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4">
      <section
        aria-labelledby="close-pos-shift-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-xl"
        role="dialog"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <LockKeyhole className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-destructive uppercase">End register shift</p>
            <h2 className="mt-1 text-lg font-semibold" id="close-pos-shift-title">Count the drawer before closing</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              TINDIO records the count, then calculates the cash difference according to your business&apos;s cash-close visibility setting.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Counted cash ({currencyCode})
            <Input
              autoFocus
              disabled={isPending}
              inputMode="decimal"
              min="0"
              onChange={(event) => setCountedCash(event.target.value)}
              placeholder="0.00"
              step="0.01"
              type="number"
              value={countedCash}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Closing note <span className="font-normal text-muted-foreground">(optional)</span>
            <Input
              disabled={isPending}
              maxLength={500}
              onChange={(event) => setClosingNote(event.target.value)}
              placeholder="e.g. Drawer counted with supervisor"
              value={closingNote}
            />
          </label>
        </div>

        {message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button disabled={isPending} onClick={onCancel} type="button" variant="outline">Cancel</Button>
          <Button disabled={isPending || !countedCash} onClick={submit} type="button">
            {isPending ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
            Close and record
          </Button>
        </div>
      </section>
    </div>
  );
}

function PosShiftGate({
  canOpenShift,
  canUseShiftControls,
  canUseTimeClock,
  canViewReceipts,
  currencyCode,
  device,
  employeeName,
  onShiftOpened,
  organizationName,
  registers,
  stores,
  timeClockEntry,
  timezone,
}: {
  canOpenShift: boolean;
  canUseShiftControls: boolean;
  canUseTimeClock: boolean;
  canViewReceipts: boolean;
  currencyCode: string;
  device: PosDeviceCredential | null;
  employeeName: string;
  onShiftOpened: (shift: PosActiveShift) => void;
  organizationName: string;
  registers: PosRegister[];
  stores: PosStore[];
  timeClockEntry: TimeClockEntry | null;
  timezone: string;
}) {
  const singleStoreId = stores.length === 1 ? stores[0].id : "";
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [storeId, setStoreId] = useState(singleStoreId);
  const availableRegisters = registers.filter((register) => register.storeId === storeId);
  const [registerId, setRegisterId] = useState(
    () => (singleStoreId && availableRegisters.length === 1 ? availableRegisters[0].id : ""),
  );
  const [openingCash, setOpeningCash] = useState("0.00");
  const [openingNote, setOpeningNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedStore = stores.find((store) => store.id === storeId);
  const selectedRegister = registers.find((register) => register.id === registerId);

  const changeStore = (nextStoreId: string) => {
    const nextRegisters = registers.filter((register) => register.storeId === nextStoreId);
    setStoreId(nextStoreId);
    setRegisterId(nextRegisters.length === 1 ? nextRegisters[0].id : "");
  };

  const submit = () => {
    startTransition(async () => {
      const result = await openShiftAction({ storeId, registerId, openingCash, openingNote, device });
      setMessage(result.message);

      if (result.ok) {
        onShiftOpened(result.shift);
        setIsDialogOpen(false);
      }
    });
  };

  return (
    <main className="min-h-svh bg-background">
      <section className="grid min-h-svh grid-rows-[auto_1fr] overflow-hidden bg-background">
        <header className="flex items-center justify-between gap-3 border-b bg-card px-5 py-4">
          <PosOperationalDrawer
            canCreateSales
            canUseShiftControls={canUseShiftControls}
            canUseTimeClock={canUseTimeClock}
            canViewReceipts={canViewReceipts}
            employeeName={employeeName}
            organizationName={organizationName}
            stores={stores}
            timeClockEntry={timeClockEntry}
            timezone={timezone}
          />
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShoppingBag className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">TINDIO POS <span className="font-normal text-muted-foreground">· {organizationName}</span></p>
              <p className="truncate text-xs text-muted-foreground">Cashier: {employeeName} · Register entry</p>
            </div>
          </div>
        </header>

        <div className="grid place-items-center px-5 py-12 text-center sm:px-10">
          <div className="max-w-lg">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
              <LockKeyhole className="size-7" aria-hidden="true" />
            </span>
            <p className="mt-6 text-xs font-bold tracking-[0.16em] text-destructive uppercase">Shift closed</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Open a register shift to start selling</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The POS stays locked until you open your assigned register. Products, barcode scanning, cart actions, and payments are unavailable while the shift is closed.
            </p>
            <p className="mt-5 text-sm font-medium">
              {selectedStore?.name ?? "Choose a store"} <span className="text-muted-foreground">·</span> {selectedRegister?.name ?? "Choose a register"}
            </p>
            {canOpenShift ? (
              <Button className="mt-6 h-11 px-5" onClick={() => setIsDialogOpen(true)} type="button">
                <LogIn aria-hidden="true" />
                Open shift
              </Button>
            ) : (
              <p className="mt-6 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Your role needs the shift-opening permission before this POS can be used.
              </p>
            )}
            {message && !isDialogOpen ? <p aria-live="polite" className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
          </div>
        </div>
      </section>

      {isDialogOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4" role="presentation">
          <div aria-labelledby="open-shift-title" aria-modal="true" className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-xl" role="dialog">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><LogIn className="size-5" /></span>
              <div>
                <h2 className="text-lg font-semibold" id="open-shift-title">Open shift</h2>
                <p className="mt-1 text-sm text-muted-foreground">Select the register you are opening and record its float.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Store
                <select className={selectClassName} disabled={isPending} onChange={(event) => changeStore(event.target.value)} value={storeId}>
                  <option value="">Choose a store</option>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Register
                <select className={selectClassName} disabled={isPending || !storeId} onChange={(event) => setRegisterId(event.target.value)} value={registerId}>
                  <option value="">Choose a register</option>
                  {availableRegisters.map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Cashier
                <Input disabled value={employeeName} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Opening cash ({currencyCode})
                <Input disabled={isPending} inputMode="decimal" min="0" onChange={(event) => setOpeningCash(event.target.value)} step="0.01" type="number" value={openingCash} />
              </label>
            </div>
            <label className="mt-4 grid gap-1.5 text-sm font-medium">
              Optional note
              <Input disabled={isPending} maxLength={500} onChange={(event) => setOpeningNote(event.target.value)} placeholder="e.g. Opening float counted" value={openingNote} />
            </label>
            {message ? <p aria-live="polite" className="mt-3 text-sm text-destructive">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button disabled={isPending} onClick={() => setIsDialogOpen(false)} type="button" variant="outline">Cancel</Button>
              <Button disabled={isPending || !storeId || !registerId} onClick={submit} type="button">
                {isPending ? <LoaderCircle className="animate-spin" /> : <LogIn />}
                Open shift
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PosConfigurationState({
  canAccessBackOffice,
  employeeName,
  organizationName,
  type,
}: {
  canAccessBackOffice: boolean;
  employeeName: string;
  organizationName: string;
  type: "store" | "register";
}) {
  const needsRegister = type === "register";

  return (
    <main className="grid min-h-svh place-items-center bg-muted/35 p-3 sm:p-5 lg:p-6">
      <section className="w-full max-w-2xl rounded-2xl border bg-background p-8 text-center shadow-sm">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive"><MonitorSmartphone className="size-7" /></span>
        <p className="mt-6 text-xs font-bold tracking-[0.16em] text-destructive uppercase">Configuration required</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{needsRegister ? "No register configured" : "No assigned active store"}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {needsRegister
            ? "This device needs an active register in one of your assigned stores before a shift or sale can begin."
            : "Ask a manager to assign you to an active store before opening the POS."}
        </p>
        <p className="mt-4 text-sm font-medium">{organizationName} · {employeeName}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {canAccessBackOffice ? (
            <Button nativeButton={false} render={<Link href="/back-office" />}>
              <ArrowLeft />
              Return to Back Office
            </Button>
          ) : null}
          <PosSignOutButton />
        </div>
      </section>
    </main>
  );
}

function PosDeviceConfigurationState({
  canAccessBackOffice,
  employeeName,
  organizationName,
  state,
}: {
  canAccessBackOffice: boolean;
  employeeName: string;
  organizationName: string;
  state: PosDeviceState;
}) {
  const loading = state.state === "loading";
  const message = loading
    ? "TINDIO is verifying this device before it can access a register."
    : state.state === "missing" || state.state === "invalid"
      ? state.message
      : "This POS device is unavailable.";

  return (
    <main className="grid min-h-svh place-items-center bg-muted/35 p-3 sm:p-5 lg:p-6">
      <section className="w-full max-w-2xl rounded-2xl border bg-background p-8 text-center shadow-sm">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          {loading ? <LoaderCircle className="size-7 animate-spin" /> : <MonitorSmartphone className="size-7" />}
        </span>
        <p className="mt-6 text-xs font-bold tracking-[0.16em] text-destructive uppercase">Device verification</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{loading ? "Checking this POS device" : "This device cannot use POS"}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <p className="mt-4 text-sm font-medium">{organizationName} · {employeeName}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Ask an owner or admin to register this browser from Back Office → POS devices, or to check whether its assigned register was changed or revoked.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {canAccessBackOffice ? (
            <Button nativeButton={false} render={<Link href="/back-office" />}>
              <ArrowLeft />
              Return to Back Office
            </Button>
          ) : null}
          <PosSignOutButton />
        </div>
      </section>
    </main>
  );
}

function formatShiftOpenedAt(value: string) {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function CategoryButton({
  active,
  color,
  label,
  onClick,
}: {
  active: boolean;
  color?: string | null;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {color ? (
        <span
          className="size-2 rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {label}
    </button>
  );
}

function ProductButton({
  canManageTiles,
  currencyCode,
  disabled,
  item,
  isFavorite,
  isFavoritePending,
  onClick,
  onKeyDown,
  onToggleFavorite,
}: {
  canManageTiles: boolean;
  currencyCode: string;
  disabled: boolean;
  item: PosCatalogItem;
  isFavorite: boolean;
  isFavoritePending: boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="relative">
      <button
        className="flex min-h-34 w-full flex-col rounded-xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0"
        data-pos-catalog-product
        disabled={disabled}
        onClick={onClick}
        onKeyDown={onKeyDown}
        type="button"
      >
        {item.imageUrl ? (
          // Catalogue image URLs are business-provided and can come from many
          // hosts, so a plain lazy image is safer than an unconfigured image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="size-11 rounded-lg border bg-muted object-cover"
            loading="lazy"
            src={item.imageUrl}
          />
        ) : (
          <span className="grid size-11 place-items-center rounded-lg bg-secondary text-primary">
            <ImageIcon className="size-5" aria-hidden="true" />
          </span>
        )}
        <span className="mt-3 line-clamp-2 pr-7 font-medium leading-5">{item.productName}</span>
        {item.variantName ? (
          <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            {item.variantName}
          </span>
        ) : (
          <span className="mt-1 text-xs text-muted-foreground">{item.unit}</span>
        )}
        {item.hasModifiers ? <span className="mt-1 text-xs text-primary">Customize available</span> : null}
        {item.isVariablePrice ? <span className="mt-1 text-xs text-primary">Enter price at sale</span> : null}
        <span className="mt-auto flex w-full items-end justify-between gap-2 pt-4">
          <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
            {item.sku || item.barcode || "No code"}
          </span>
          <span className="shrink-0 font-semibold">
            {item.isVariablePrice ? "Manual price" : formatMinorMoney(item.priceMinor, currencyCode)}
          </span>
        </span>
      </button>
      {canManageTiles ? (
        <button
          aria-label={isFavorite ? `Remove ${item.productName} from favorites` : `Add ${item.productName} to favorites`}
          aria-pressed={isFavorite}
          className={cn(
            "absolute top-2 right-2 grid size-8 place-items-center rounded-full border bg-background/95 shadow-sm transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            isFavorite ? "border-primary text-primary" : "border-border text-muted-foreground",
          )}
          disabled={disabled || isFavoritePending}
          onClick={onToggleFavorite}
          type="button"
        >
          <Star className={cn("size-4", isFavorite && "fill-current")} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function ManualPriceDialog({
  currencyCode,
  item,
  onCancel,
  onConfirm,
}: {
  currencyCode: string;
  item: PosCatalogItem;
  onCancel: () => void;
  onConfirm: (manualPriceMinor: number) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) {
      setError("Enter a positive price with up to 2 decimals.");
      return;
    }
    const [whole, fraction = ""] = value.trim().split(".");
    const manualPriceMinor = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
    if (manualPriceMinor <= 0) {
      setError("Enter a price greater than zero.");
      return;
    }
    onConfirm(manualPriceMinor);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <section aria-modal="true" className="w-full max-w-md rounded-2xl border bg-background p-5 shadow-xl" role="dialog">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Variable price</p>
        <h2 className="mt-1 text-lg font-semibold">Set price for {item.productName}</h2>
        <p className="mt-2 text-sm text-muted-foreground">This price is validated and captured on the receipt when the sale is completed.</p>
        <label className="mt-5 grid gap-2 text-sm font-medium">
          Selling price ({currencyCode})
          <Input autoFocus inputMode="decimal" onChange={(event) => setValue(event.target.value)} placeholder="0.00" value={value} />
        </label>
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="outline">Cancel</Button>
          <Button onClick={confirm} type="button">Continue</Button>
        </div>
      </section>
    </div>
  );
}

function ModifierPicker({ currencyCode, groups, item, onCancel, onConfirm }: { currencyCode: string; groups: ModifierGroup[]; item: PosCatalogItem; onCancel: () => void; onConfirm: (modifiers: Array<{ id: string; name: string; priceMinor: number }>) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectedOptions = groups.flatMap((group) => group.options).filter((option) => selected.includes(option.id));
  const valid = groups.every((group) => { const count = group.options.filter((option) => selected.includes(option.id)).length; return count >= group.minSelections && count <= group.maxSelections; });
  const toggle = (group: ModifierGroup, optionId: string) => setSelected((current) => {
    const groupSelected = group.options.filter((option) => current.includes(option.id));
    if (current.includes(optionId)) return current.filter((id) => id !== optionId);
    if (groupSelected.length >= group.maxSelections) return [...current.filter((id) => !group.options.some((option) => option.id === id)), optionId];
    return [...current, optionId];
  });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><section aria-modal="true" className="max-h-[85svh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-background p-5 shadow-xl" role="dialog"><h2 className="text-lg font-semibold">Customize {item.productName}</h2><p className="mt-1 text-sm text-muted-foreground">Choose options before adding this item.</p><div className="mt-5 grid gap-5">{groups.map((group) => <fieldset key={group.id}><legend className="font-medium">{group.name} <span className="text-xs font-normal text-muted-foreground">({group.minSelections === group.maxSelections ? `choose ${group.minSelections}` : `${group.minSelections}–${group.maxSelections}`})</span></legend><div className="mt-2 grid gap-2">{group.options.map((option) => <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm" key={option.id}><span><input checked={selected.includes(option.id)} className="mr-2 accent-primary" onChange={() => toggle(group, option.id)} type="checkbox"/>{option.name}</span><span>{option.priceMinor ? `+${formatMinorMoney(option.priceMinor, currencyCode)}` : "Included"}</span></label>)}</div></fieldset>)}</div><div className="mt-6 flex justify-end gap-2"><Button onClick={onCancel} type="button" variant="outline">Cancel</Button><Button disabled={!valid} onClick={() => onConfirm(selectedOptions)} type="button">Add to cart</Button></div></section></div>;
}

function CartLine({
  canEditQuantity,
  canRemoveItems,
  currencyCode,
  disabled,
  line,
  onEditNote,
  onQuantityChange,
}: {
  canEditQuantity: boolean;
  canRemoveItems: boolean;
  currencyCode: string;
  disabled: boolean;
  line: PosCartLine;
  onEditNote: () => void;
  onQuantityChange: (quantity: number) => void;
}) {
  return (
    <li className="p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{line.productName}</p>
          {line.variantName ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{line.variantName}</p>
          ) : null}
        </div>
        <Button
          aria-label={`Remove ${line.productName}`}
          disabled={disabled || !canRemoveItems}
          onClick={() => onQuantityChange(0)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2"><Button disabled={disabled} onClick={onEditNote} size="sm" type="button" variant="ghost">{line.itemNote ? "Edit item note" : "Add item note"}</Button>{line.itemNote ? <span className="truncate text-xs text-muted-foreground">{line.itemNote}</span> : null}</div>
      <div className="mt-3 flex items-center justify-between gap-3">
        {line.allowFractionalQuantity ? (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Quantity ({line.unit})
            <Input
              className="h-8 w-28 text-sm"
              disabled={disabled || !canEditQuantity}
              inputMode="decimal"
              min="0.001"
              onChange={(event) => {
                const quantity = Number(event.target.value);
                if (Number.isFinite(quantity)) onQuantityChange(quantity);
              }}
              step="0.001"
              type="number"
              value={line.quantity}
            />
          </label>
        ) : (
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            <Button
              aria-label={`Decrease ${line.productName} quantity`}
              disabled={disabled || !canEditQuantity || (line.quantity <= 1 && !canRemoveItems)}
              onClick={() => onQuantityChange(line.quantity - 1)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <CircleMinus aria-hidden="true" />
            </Button>
            <span className="min-w-8 text-center text-sm font-semibold">{line.quantity}</span>
            <Button
              aria-label={`Increase ${line.productName} quantity`}
              disabled={disabled || !canEditQuantity}
              onClick={() => onQuantityChange(line.quantity + 1)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <CirclePlus aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="text-right">
          <p className="font-semibold">
            {formatMinorMoney(lineTotalMinor(line.priceMinor, line.quantity), currencyCode)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMinorMoney(line.priceMinor, currencyCode)} per {line.unit}
          </p>
          {line.manualPriceMinor !== null ? <p className="mt-1 text-xs text-primary">Manual price</p> : null}
        </div>
      </div>
    </li>
  );
}

function EmptyCatalogue({
  search,
  view,
}: {
  search: string;
  view: "all" | "favorites" | "recent";
}) {
  const isFavorites = view === "favorites";
  const isRecent = view === "recent";

  return (
    <div className="grid min-h-64 place-items-center text-center">
      <div className="max-w-xs">
        {isRecent ? (
          <History className="mx-auto size-9 text-muted-foreground" aria-hidden="true" />
        ) : isFavorites ? (
          <Star className="mx-auto size-9 text-muted-foreground" aria-hidden="true" />
        ) : (
          <PackageOpen className="mx-auto size-9 text-muted-foreground" aria-hidden="true" />
        )}
        <p className="mt-4 font-medium">
          {isFavorites
            ? "No favorite tiles yet"
            : isRecent
              ? "No recent items yet"
              : search.trim()
                ? "No matching products"
                : "No saleable products yet"}
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {isFavorites
            ? "A manager can pin up to 24 saleable items using the star on a catalogue tile."
            : isRecent
              ? "Completed sales at this store will appear here as quick-add tiles."
              : search.trim()
                ? "Try a product name, SKU, or barcode."
                : "Create and enable products for this store in the Back Office catalog."}
        </p>
      </div>
    </div>
  );
}
