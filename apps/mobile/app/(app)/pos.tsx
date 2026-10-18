import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  CheckoutSaleValues,
  PosCartLine,
  PosCatalogItem,
  PosCategory,
  PosCustomer,
  PosModifierGroup,
  PosModifierOption,
  PosOpenTicket,
} from "../../../../src/contracts/pos";
import { posItemKey } from "../../../../src/features/pos/pos-types";
import {
  getUnresolvedOnlineCheckoutIntent,
  markOnlineCheckoutIntentAcknowledged,
  markOnlineCheckoutIntentRejected,
  markOnlineCheckoutIntentSubmitting,
  markOnlineCheckoutIntentUnknown,
  prepareOnlineCheckoutIntent,
  recoverInterruptedOnlineCheckoutIntents,
  type DurableOnlineCheckoutIntent,
} from "../../src/db/checkout-intents";
import { saveCustomerSearchResults, searchCachedCustomers } from "../../src/db/customer-cache";
import { CashierCatalogue } from "../../src/features/cashier/cashier-catalogue";
import { CashierCartWorkspace } from "../../src/features/cashier/cashier-cart-workspace";
import { ModifierPicker, VariablePriceEditor } from "../../src/features/cashier/cashier-editors";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import {
  CashierRegisterHeader,
  CashierShiftGate,
} from "../../src/features/cashier/cashier-pos-frame";
import {
  CashierTenderPanel,
  type CashierSaleResult,
} from "../../src/features/cashier/cashier-tender-panel";
import {
  cartSupportsDurableOfflineCash,
  offlineCashCartRestriction,
  offlineCashCartRestrictionMessage,
  sameConfiguration,
  sameSaleable,
} from "../../src/features/cashier/cashier-validation";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import {
  CameraBarcodeScanner,
} from "../../src/features/hardware/camera-barcode-scanner";
import { createBarcodeScanGuard } from "../../src/features/hardware/barcode-scan-guard";
import {
  lookupLocalBarcode,
  lookupLocalSku,
  searchLocalCatalog,
} from "../../src/features/local-first/local-catalog";
import { calculateLocalCartTotals } from "../../src/features/local-first/local-cart";
import {
  canAcceptOfflineSale,
  cashierReadinessLabel,
} from "../../src/features/offline/cashier-readiness-policy";
import { getLocalFirstModifiers } from "../../src/features/local-first/local-modifiers";
import {
  getLocalCategories,
  getLocalDiningOptions,
  getLocalDiscounts,
  getLocalPaymentMethods,
  getLocalTaxRates,
} from "../../src/features/local-first/local-reference";
import { refreshCartStockEstimates } from "../../src/features/local-first/local-stock";
import {
  readCartOfflineInventoryIntelligence,
  type CartInventoryIntelligenceLine,
} from "../../src/features/inventory/offline-inventory-intelligence";
// readOfflineInventoryIntelligence remains the per-line foundation of cart intelligence.
import { createOfflineCashSale } from "../../src/features/outbox/create-offline-sale";
import { syncOutboxEvents } from "../../src/features/outbox/outbox-sync";
import { tindioTheme } from "../../src/ui/theme";
import { useTindioResponsiveLayout } from "../../src/ui/tindio-responsive";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioListItem, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";
import {
  checkoutPosV2,
  createPosV2Customer,
  fetchPosV2Live,
  savePosV2Ticket,
  searchPosV2Customers,
} from "../../src/lib/tindio-api";

type ConfigureState = {
  item: PosCatalogItem;
  editingKey: string | null;
  manualPriceMinor: number | null;
  initialModifierIds: string[];
};

type ModifierState = ConfigureState & {
  groups: PosModifierGroup[];
};

function baseCartLine(item: PosCatalogItem): PosCartLine {
  return {
    ...item,
    quantity: 1,
    manualPriceMinor: null,
    modifierOptionIds: [],
    modifiers: [],
    itemNote: null,
  };
}

export default function PosScreen() {
  const { allowsColumns, viewportClass } = useTindioResponsiveLayout();
  const router = useRouter();
  const { data, mode, cashierReadinessState, reload } = useBusinessContext();
  const core = data?.core;
  const terminal =
    useTerminalDevice(
      core?.organization.id,
    );

  const identity =
    terminal.identity;

  const binding =
    identity?.binding;

  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState("");
  const [
    cameraScannerOpen,
    setCameraScannerOpen,
  ] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [items, setItems] = useState<PosCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [cartExpanded, setCartExpanded] = useState(false);
  const [categories, setCategories] = useState<PosCategory[]>([]);
  const [discounts, setDiscounts] = useState<Awaited<ReturnType<typeof getLocalDiscounts>>>([]);
  const [taxes, setTaxes] = useState<Awaited<ReturnType<typeof getLocalTaxRates>>>([]);
  const [diningOptions, setDiningOptions] = useState<Awaited<ReturnType<typeof getLocalDiningOptions>>>([]);
  const [paymentMethods, setPaymentMethods] = useState<Awaited<ReturnType<typeof getLocalPaymentMethods>>>([]);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [taxId, setTaxId] = useState<string | null>(null);
  const [diningOptionId, setDiningOptionId] = useState<string | null>(null);
  const [cashTender, setCashTender] = useState("");
  const [cartInventoryIntelligence, setCartInventoryIntelligence] =
    useState<CartInventoryIntelligenceLine[]>([]);
  const [saleMessage, setSaleMessage] = useState<string | null>(null);
  const [saleResult, setSaleResult] = useState<CashierSaleResult | null>(null);
  const [savingOffline, setSavingOffline] = useState(false);
  const [onlineCheckoutPending, setOnlineCheckoutPending] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState(() => Crypto.randomUUID());
  const [onlineIntent, setOnlineIntent] =
    useState<DurableOnlineCheckoutIntent | null>(null);
  const [loadedOnlineIntentScope, setLoadedOnlineIntentScope] =
    useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerRows, setCustomerRows] = useState<PosCustomer[]>([]);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [openTickets, setOpenTickets] = useState<PosOpenTicket[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [ticketLabel, setTicketLabel] = useState("");
  const [ticketNote, setTicketNote] = useState("");
  const [ticketPending, setTicketPending] = useState(false);

  const [configureState, setConfigureState] = useState<ConfigureState | null>(null);
  const [modifierState, setModifierState] = useState<ModifierState | null>(null);
  const hidLookupGuard = useRef(createBarcodeScanGuard()).current;

  const gates = core ? cashierFeatureGates(core) : null;

  const canCreateSales = Boolean(
    core?.permissions.includes("pos.access")
    && core.permissions.includes("sales.create"),
  );
  const canAcceptPayments = Boolean(core?.permissions.includes("payments.accept"));
  const canEditQuantity = Boolean(core?.permissions.includes("pos.edit_quantity"));
  const canRemoveItems = Boolean(core?.permissions.includes("pos.remove_item"));
  const canApplyDiscounts = Boolean(core?.permissions.includes("discounts.apply"));
  const canCreateCustomers = Boolean(core?.permissions.includes("customers.manage"));
  const canUseTickets = Boolean(gates?.tickets);
  const usesTabletCartPane = allowsColumns;
  const usesCompactPhoneSpacing = viewportClass === "compact-phone";

  const shiftMatches = Boolean(
    core?.activeShift
    && binding
    && core.activeShift.storeId === binding.storeId
    && core.activeShift.registerId === binding.registerId,
  );

  const load = useCallback(async () => {
    if (!core || !binding) return;

    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const [
        nextItems,
        nextCategories,
        nextDiscounts,
        nextTaxes,
        nextDining,
        nextPayments,
      ] = await Promise.all([
        searchLocalCatalog({
          organizationId: core.organization.id,
          storeId: binding.storeId,
          query,
          categoryId,
        }),
        getLocalCategories(core.organization.id),
        getLocalDiscounts(core.organization.id),
        getLocalTaxRates(core.organization.id),
        getLocalDiningOptions(core.organization.id),
        getLocalPaymentMethods(core.organization.id, binding.storeId),
      ]);

      setItems(nextItems);
      setCategories(nextCategories);
      setDiscounts(nextDiscounts);
      setTaxes(nextTaxes);
      setDiningOptions(nextDining);
      setPaymentMethods(nextPayments);

      if (!taxId) {
        setTaxId(nextTaxes.find((tax) => tax.isDefault)?.id ?? null);
      }

      if (!diningOptionId && core.features.dining) {
        setDiningOptionId(nextDining.find((option) => option.isDefault)?.id ?? null);
      }
    } catch {
      setCatalogError(
        "Products saved on this device could not be opened. Try again or reconnect to TINDIO.",
      );
    } finally {
      setCatalogLoading(false);
    }
  }, [binding, categoryId, core, diningOptionId, query, taxId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const organizationId = core?.organization.id;
    const deviceId = identity?.credential.deviceId;
    const scope = organizationId && deviceId
      ? `${organizationId}:${deviceId}`
      : null;
    let active = true;

    if (!organizationId || !deviceId || !scope) {
      return () => {
        active = false;
      };
    }

    void recoverInterruptedOnlineCheckoutIntents(
      organizationId,
      deviceId,
    ).then(() =>
      getUnresolvedOnlineCheckoutIntent(
        organizationId,
        deviceId,
      ),
    ).then((intent) => {
      if (!active) return;
      setOnlineIntent(intent);
      setLoadedOnlineIntentScope(scope);

      if (intent) {
        setCheckoutKey(intent.idempotencyKey);
        setSaleMessage(
          "UNRESOLVED ONLINE CHECKOUT - retry the original transaction. Offline fallback is blocked.",
        );
      }
    }).catch(() => {
      if (active) {
        setSaleMessage(
          "Checkout recovery state is unavailable. Do not collect payment or start another checkout.",
        );
      }
    });

    return () => {
      active = false;
    };
  }, [core?.organization.id, identity?.credential.deviceId]);

  const currentOnlineIntentScope = core && identity
    ? `${core.organization.id}:${identity.credential.deviceId}`
    : null;
  const onlineIntentLoading = Boolean(
    currentOnlineIntentScope
    && currentOnlineIntentScope !== loadedOnlineIntentScope,
  );
  const onlineIntentMatchesCurrentContext = Boolean(
    !onlineIntent
    || (
      core
      && binding
      && core.activeShift
      && onlineIntent.employeeId === core.employee.id
      && onlineIntent.shiftId === core.activeShift.id
      && onlineIntent.storeId === binding.storeId
      && onlineIntent.registerId === binding.registerId
    )
  );

  const totals = useMemo(
    () =>
      calculateLocalCartTotals(
        cart,
        discounts.find((discount) => discount.id === discountId) ?? null,
        taxes.find((tax) => tax.id === taxId) ?? null,
      ),
    [cart, discountId, discounts, taxId, taxes],
  );

  const tenderedMinor = useMemo(() => {
    const match = cashTender.trim().match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
    return match
      ? Number(match[1]) * 100 + Number(`${match[2] ?? ""}00`.slice(0, 2))
      : null;
  }, [cashTender]);

  const changeMinor =
    tenderedMinor === null
      ? null
      : Math.max(0, tenderedMinor - totals.totalMinor);

  const cashMethod = paymentMethods.find((method) => method.type === "CASH") ?? null;

  const offlineCartInput = {
    customerId: selectedCustomer?.id ?? null,
    diningOptionId,
    openTicketId: activeTicketId,
  };
  const offlineCartRestriction = offlineCashCartRestriction(cart, offlineCartInput);
  const offlineCartEligible = cartSupportsDurableOfflineCash(cart, offlineCartInput);
  const offlineSaleReady = canAcceptOfflineSale(cashierReadinessState);
  const offlinePaymentDisabled = (
    onlineIntentLoading
    || savingOffline
    || !offlineSaleReady
    || Boolean(onlineIntent)
    || !offlineCartEligible
    || cart.length === 0
    || tenderedMinor === null
    || tenderedMinor < totals.totalMinor
  );
  const onlinePaymentDisabled = (
    mode !== "online"
    || onlineCheckoutPending
    || onlineIntentLoading
    || !canCreateSales
    || !canAcceptPayments
    || !onlineIntentMatchesCurrentContext
    || (
      !onlineIntent
      && (
        !shiftMatches
        || !cashMethod
        || cart.length === 0
        || tenderedMinor === null
        || tenderedMinor < totals.totalMinor
      )
    )
  );

  useEffect(() => {
    if (!core || !binding || !identity) return;

    let active = true;

    void readCartOfflineInventoryIntelligence({
      organizationId: core.organization.id,
      storeId: binding.storeId,
      deviceId: identity.credential.deviceId,
      cart,
    }).then((next) => {
      if (active) setCartInventoryIntelligence(next);
    }).catch(() => {
      if (active) setCartInventoryIntelligence([]);
    });

    return () => {
      active = false;
    };
  }, [binding, cart, core, identity]);

  if (
    !core
    || terminal.loading
    || !binding
    || !identity
  ) {
    const preparing = Boolean(core) && terminal.loading;
    const retrySetup = async () => {
      await reload();
      await terminal.reload();
    };

    return (
      <TindioScreen
        contentContainerStyle={styles.unavailableScreen}
        edges={[]}
        testID="pos-setup-state"
      >
        <TindioCard style={styles.unavailableCard}>
          <Text style={styles.eyebrow}>TINDIO POS</Text>
          <Text accessibilityRole="header" style={styles.stateTitle}>
            {preparing ? "Preparing this register" : "Finish register setup"}
          </Text>
          <TindioFeedback
            description={
              preparing
                ? "TINDIO is checking this device assignment and saved catalog."
                : terminal.error
                  ?? "This device needs its terminal assignment and saved catalog before selling can begin. Return to the register home to review sync and setup. Saved work remains on this device."
            }
            kind={preparing ? "loading" : "restriction"}
            title={preparing ? "Checking register" : "Catalog unavailable"}
          />
          {!preparing ? (
            <View style={styles.unavailableActions}>
              <TindioButton
                accessibilityLabel="Try preparing the register again"
                onPress={() => void retrySetup()}
              >
                Try again
              </TindioButton>
              <TindioButton
                onPress={() => router.replace("/(app)")}
                variant="secondary"
              >
                Back to register
              </TindioButton>
            </View>
          ) : null}
        </TindioCard>
      </TindioScreen>
    );
  }

  const markCartChanged = () => {
    setSaleResult(null);
    if (onlineIntent) {
      setSaleMessage(
        "The unresolved online checkout is frozen. Retry its original payload before starting another sale.",
      );
      return;
    }

    setCheckoutKey(Crypto.randomUUID());
    setSaleMessage(null);
  };

  const commitConfiguredLine = (
    item: PosCatalogItem,
    manualPriceMinor: number | null,
    modifiers: PosModifierOption[],
    editingKey: string | null,
  ) => {
    const nextLine: PosCartLine = {
      ...baseCartLine(item),
      manualPriceMinor,
      modifierOptionIds: modifiers.map((modifier) => modifier.id),
      modifiers,
    };

    setCart((current) => {
      if (editingKey) {
        const existing = current.find((line) => posItemKey(line) === editingKey);
        if (!existing) return current;

        return current.map((line) =>
          posItemKey(line) === editingKey
            ? {
                ...nextLine,
                quantity: existing.quantity,
                itemNote: existing.itemNote ?? null,
                ticketLineId: existing.ticketLineId,
              }
            : line,
        );
      }

      const sameSaleableLine = current.find((line) => sameSaleable(line, nextLine));

      if (sameSaleableLine) {
        if (!sameConfiguration(sameSaleableLine, nextLine)) {
          setSaleMessage(
            "This product already has a different price/modifier configuration. Edit the existing cart line instead.",
          );
          return current;
        }

        if (!canEditQuantity) {
          setSaleMessage("You do not have permission to change cart quantities.");
          return current;
        }

        return current.map((line) =>
          posItemKey(line) === posItemKey(sameSaleableLine)
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }

      return [...current, nextLine];
    });

    markCartChanged();
  };

  const continueWithModifiers = async (
    state: ConfigureState,
    manualPriceMinor: number | null,
  ) => {
    const nextState = { ...state, manualPriceMinor };

    if (!state.item.hasModifiers) {
      commitConfiguredLine(
        state.item,
        manualPriceMinor,
        [],
        state.editingKey,
      );
      setConfigureState(null);
      return;
    }

    const result = await getLocalFirstModifiers(
      core.organization.id,
      binding.storeId,
      state.item.productId,
      mode,
    );

    if (!result.ok) {
      setSaleMessage(
        mode === "offline"
          ? "This modifier set is not cached. Reconnect before configuring this item."
          : "Modifiers could not be loaded.",
      );
      return;
    }

    setConfigureState(null);
    setModifierState({
      ...nextState,
      groups: result.groups,
    });
  };

  const startConfigure = async (
    item: PosCatalogItem,
    editingLine?: PosCartLine,
  ) => {
    const state: ConfigureState = {
      item,
      editingKey: editingLine ? posItemKey(editingLine) : null,
      manualPriceMinor: editingLine?.manualPriceMinor ?? null,
      initialModifierIds: editingLine?.modifierOptionIds ?? [],
    };

    if (item.isVariablePrice) {
      setConfigureState(state);
      return;
    }

    await continueWithModifiers(state, null);
  };

  const add = async (item: PosCatalogItem) => {
    await startConfigure(item);

    if (mode === "online") {
      try {
        await refreshCartStockEstimates(core.organization.id, {
          storeId: binding.storeId,
          registerId: binding.registerId,
          items: [{
            productId: item.productId,
            variantId: item.variantId,
            quantity: 1,
          }],
        });
      } catch {
        // A cached baseline can still provide honest offline inventory intelligence.
      }
    }

    // Cart-wide intelligence refreshes through the cart effect below.
  };

  const findLookupValue = async (
    value: string,
  ) => {
    const normalized =
      value.trim();

    if (!normalized) {
      return;
    }

    if (!hidLookupGuard.tryAcquire()) {
      return;
    }

    try {
      const item =
        await lookupLocalBarcode(
          core.organization.id,
          binding.storeId,
          normalized,
        )
        ?? await lookupLocalSku(
          core.organization.id,
          binding.storeId,
          normalized,
        );

      if (item) {
        await add(item);
        setLookup("");
        setSaleMessage(null);
        return;
      }

      setSaleMessage(
        "No local barcode/SKU match.",
      );
    } finally {
      hidLookupGuard.release();
    }
  };

  const find = async () => {
    await findLookupValue(lookup);
  };

  const acceptCameraBarcode =
    async (barcode: string) => {
      setCameraScannerOpen(false);
      setLookup(barcode);

      const item =
        await lookupLocalBarcode(
          core.organization.id,
          binding.storeId,
          barcode,
        );

      if (item) {
        await add(item);
        setLookup("");
        setSaleMessage(null);
        return;
      }

      setSaleMessage(
        `No local barcode match for ${barcode}.`,
      );
    };

  const setLineQuantity = (line: PosCartLine, quantity: number) => {
    if (!canEditQuantity) return;

    setCart((current) =>
      current.map((entry) =>
        posItemKey(entry) === posItemKey(line)
          ? { ...entry, quantity }
          : entry,
      ),
    );

    markCartChanged();
  };

  const setLineNote = (line: PosCartLine, note: string | null) => {
    setCart((current) =>
      current.map((entry) =>
        posItemKey(entry) === posItemKey(line)
          ? { ...entry, itemNote: note }
          : entry,
      ),
    );

    markCartChanged();
  };

  const removeLine = (line: PosCartLine) => {
    if (!canRemoveItems) return;

    setCart((current) =>
      current.filter((entry) => posItemKey(entry) !== posItemKey(line)),
    );

    markCartChanged();
  };

  const searchCustomers = async () => {
    try {
      if (mode === "online") {
        const result = await searchPosV2Customers(
          core.organization.id,
          binding.storeId,
          customerQuery,
        );

        setCustomerRows(result.customers);
        await saveCustomerSearchResults(
          core.organization.id,
          binding.storeId,
          result,
        );
        return;
      }

      setCustomerRows(
        await searchCachedCustomers(
          core.organization.id,
          binding.storeId,
          customerQuery,
        ),
      );
    } catch {
      setSaleMessage("Customer search is unavailable.");
    }
  };

  const createCustomer = async () => {
    if (
      mode !== "online"
      || !canCreateCustomers
      || !newCustomerName.trim()
    ) return;

    try {
      const result = await createPosV2Customer(core.organization.id, {
        fullName: newCustomerName.trim(),
        email: newCustomerEmail.trim(),
        phone: newCustomerPhone.trim(),
        address: "",
        birthday: "",
        notes: "",
        loyaltyCardCode: "",
      });

      setSaleMessage(result.message);

      if (result.ok && result.data) {
        setSelectedCustomer(result.data);
        setNewCustomerName("");
        setNewCustomerEmail("");
        setNewCustomerPhone("");
        markCartChanged();
      }
    } catch {
      setSaleMessage("Customer creation could not be confirmed.");
    }
  };

  const loadTickets = async () => {
    if (!canUseTickets || mode !== "online") return;

    try {
      const live = await fetchPosV2Live(core.organization.id, binding);
      setOpenTickets(live.live.openTickets);
    } catch {
      setSaleMessage("Open tickets could not be loaded.");
    }
  };

  const loadTicketIntoCart = (ticket: PosOpenTicket) => {
    setCart(ticket.cart);
    setSelectedCustomer(ticket.customer);
    setDiningOptionId(ticket.diningOptionId);
    setActiveTicketId(ticket.id);
    setTicketLabel(ticket.label);
    setTicketNote(ticket.note ?? "");
    markCartChanged();
  };

  const saveCurrentTicket = async () => {
    if (
      !canUseTickets
      || mode !== "online"
      || ticketPending
      || cart.length === 0
      || !ticketLabel.trim()
    ) return;

    setTicketPending(true);

    try {
      const result = await savePosV2Ticket(core.organization.id, {
        storeId: binding.storeId,
        registerId: binding.registerId,
        ticketId: activeTicketId,
        customerId: selectedCustomer?.id ?? null,
        diningOptionId,
        assignedEmployeeId: null,
        label: ticketLabel.trim(),
        note: ticketNote.trim(),
        cart,
        device: identity.credential,
      });

      setSaleMessage(result.message);

      if (result.ok) {
        setActiveTicketId(result.ticketId);
        await loadTickets();
      }
    } catch {
      setSaleMessage("Ticket save could not be confirmed.");
    } finally {
      setTicketPending(false);
    }
  };

  const clearSaleState = () => {
    setCart([]);
    setCashTender("");
    setDiscountId(null);
    setSelectedCustomer(null);
    setActiveTicketId(null);
    setTicketLabel("");
    setTicketNote("");
    setOnlineIntent(null);
    setCheckoutKey(Crypto.randomUUID());
  };

  const saveOfflineCashSale = async () => {
    if (onlineIntentLoading || savingOffline) return;

    if (offlineCartRestriction) {
      setSaleMessage(offlineCashCartRestrictionMessage(offlineCartRestriction));
      return;
    }

    if (!offlineSaleReady) {
      setSaleMessage(
        "Offline cash acceptance is paused. Your cart is preserved; reconnect and restore terminal readiness before collecting payment.",
      );
      return;
    }

    if (onlineIntent) {
      setSaleMessage(
        "Offline fallback is blocked while the original online checkout result is unresolved.",
      );
      return;
    }

    setSavingOffline(true);
    setSaleMessage(null);

    try {
      const result = await createOfflineCashSale({
        organizationId: core.organization.id,
        binding,
        deviceId: identity.credential.deviceId,
        cart,
        totals,
        discountId,
        taxRateId: taxId,
        tenderedMinor: tenderedMinor ?? -1,
      });

      if (!result.ok) {
        setSaleMessage(result.message ?? `Offline cash sale was not saved: ${result.reason}`);
        return;
      }

      const acceptedResult: CashierSaleResult = {
        kind: "saved",
        reference: result.event.localReference,
        totalMinor: result.event.snapshot.totalMinor,
        changeMinor: result.event.snapshot.changeMinor,
      };

      clearSaleState();
      setSaleMessage(null);
      setSaleResult(acceptedResult);

      if (mode === "online") {
        void syncOutboxEvents(core.organization.id);
      }
    } finally {
      setSavingOffline(false);
    }
  };

  const completeOnlineCashSale = async () => {
    if (
      onlineCheckoutPending
      || onlineIntentLoading
      || mode !== "online"
      || !canCreateSales
      || !canAcceptPayments
      || !onlineIntentMatchesCurrentContext
    ) return;

    if (
      !onlineIntent
      && (
        !shiftMatches
        || !cashMethod
        || tenderedMinor === null
        || tenderedMinor < totals.totalMinor
        || cart.length === 0
      )
    ) return;

    setOnlineCheckoutPending(true);
    setSaleMessage(null);

    let intent = onlineIntent;

    try {
      if (!intent) {
        const payload: CheckoutSaleValues = {
          storeId: binding.storeId,
          registerId: binding.registerId,
          idempotencyKey: checkoutKey,
          customerId: selectedCustomer?.id ?? null,
          loyaltyRedemptionPoints: 0,
          discountId,
          taxRateId: taxId,
          diningOptionId,
          openTicketId: activeTicketId,
          items: cart.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            unitPriceMinor: line.manualPriceMinor,
            modifierOptionIds: line.modifierOptionIds,
            itemNote: line.itemNote ?? null,
          })),
          payments: [{
            paymentMethodId: cashMethod!.id,
            tenderedAmount: cashTender,
            referenceNumber: "",
            note: "",
          }],
        };

        intent = await prepareOnlineCheckoutIntent({
          organizationId: core.organization.id,
          deviceId: identity.credential.deviceId,
          employeeId: core.employee.id,
          shiftId: core.activeShift!.id,
          payload,
        });
        setOnlineIntent(intent);
      }

      await markOnlineCheckoutIntentSubmitting(
        core.organization.id,
        intent.intentId,
      );

      const result = await checkoutPosV2(
        core.organization.id,
        intent.payload,
      );

      if (result.ok) {
        await markOnlineCheckoutIntentAcknowledged(
          core.organization.id,
          intent.intentId,
          result.data,
        );
        const acceptedResult: CashierSaleResult = {
          kind: "official",
          reference: String(result.data.receiptNumber),
          totalMinor: result.data.totalMinor,
          changeMinor: result.data.changeMinor,
          replayed: result.data.wasReplayed,
        };

        clearSaleState();
        setSaleMessage(null);
        setSaleResult(acceptedResult);
        void syncOutboxEvents(core.organization.id);
        return;
      }

      if (result.retryable) {
        await markOnlineCheckoutIntentUnknown(
          core.organization.id,
          intent.intentId,
          result.message,
        );
        setOnlineIntent({ ...intent, state: "UNKNOWN", lastError: result.message });
      } else {
        await markOnlineCheckoutIntentRejected(
          core.organization.id,
          intent.intentId,
          result.message,
        );
        setOnlineIntent(null);
        setCheckoutKey(Crypto.randomUUID());
      }

      setSaleMessage(
        result.retryable
          ? "CHECKOUT STATUS UNKNOWN — retry only this same checkout or verify Recent Receipts first."
          : result.message,
      );
    } catch {
      if (intent) {
        await markOnlineCheckoutIntentUnknown(
          core.organization.id,
          intent.intentId,
          "The server response could not be confirmed.",
        ).catch(() => undefined);
        setOnlineIntent({
          ...intent,
          state: "UNKNOWN",
          lastError: "The server response could not be confirmed.",
        });
      }

      setSaleMessage(
        intent
          ? "CHECKOUT STATUS UNKNOWN - retrying will use the exact persisted payload and idempotency key. Offline fallback is blocked."
          : "CHECKOUT WAS NOT SENT because its durable intent could not be saved. Keep the cart and try again.",
      );
    } finally {
      setOnlineCheckoutPending(false);
    }
  };

  if (cameraScannerOpen) {
    return (
      <CameraBarcodeScanner
        onScanned={
          acceptCameraBarcode
        }
        onClose={() =>
          setCameraScannerOpen(false)
        }
      />
    );
  }

  if (configureState) {
    return (
      <VariablePriceEditor
        item={configureState.item}
        initialMinor={configureState.manualPriceMinor}
        onCancel={() => setConfigureState(null)}
        onContinue={(minor) => void continueWithModifiers(configureState, minor)}
      />
    );
  }

  if (modifierState) {
    return (
      <ModifierPicker
        item={modifierState.item}
        groups={modifierState.groups}
        initialIds={modifierState.initialModifierIds}
        onCancel={() => setModifierState(null)}
        onConfirm={(options) => {
          commitConfiguredLine(
            modifierState.item,
            modifierState.manualPriceMinor,
            options,
            modifierState.editingKey,
          );
          setModifierState(null);
        }}
      />
    );
  }

  const assignedStore = core.stores.find((store) => store.id === binding.storeId);
  const assignedRegister = core.registers.find((register) => register.id === binding.registerId);
  const cartItemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const registerHeader = (
    <CashierRegisterHeader
      employeeName={core.employee.name}
      itemCount={cartItemCount}
      mode={mode}
      onMenu={() => router.push("/(app)")}
      organizationName={core.organization.name}
      shiftOpen={shiftMatches}
    />
  );

  if (!shiftMatches) {
    return (
      <View style={styles.screen}>
        {registerHeader}
        <ScrollView contentContainerStyle={styles.gateScroll} testID="pos-scroll">
          <CashierShiftGate
            canOpenShift={core.permissions.includes("shifts.open")}
            conflict={Boolean(core.activeShift)}
            mode={mode}
            onOpenShift={() => router.push("/(app)/shift")}
            registerName={assignedRegister?.name ?? "Assigned register"}
            storeName={assignedStore?.name ?? "Assigned store"}
          />
        </ScrollView>
      </View>
    );
  }

  const renderTenderPanel = () => (
    <CashierTenderPanel
      cashMethodAvailable={Boolean(cashMethod)}
      cashTender={cashTender}
      changeMinor={changeMinor}
      currencyCode={core.organization.currencyCode}
      hasCart={cart.length > 0}
      offlineDisabled={offlinePaymentDisabled}
      offlineReadinessLabel={cashierReadinessLabel(cashierReadinessState)}
      offlineSaleReady={offlineSaleReady}
      onCashTender={setCashTender}
      onCompleteOnline={() => void completeOnlineCashSale()}
      onDismissResult={() => setSaleResult(null)}
      online={mode === "online"}
      onlineCheckoutPending={onlineCheckoutPending}
      onlineDisabled={onlinePaymentDisabled}
      onlineIntent={Boolean(onlineIntent)}
      onlineIntentMatchesCurrentContext={onlineIntentMatchesCurrentContext}
      onSaveOffline={() => void saveOfflineCashSale()}
      saleMessage={saleMessage}
      saleResult={saleResult}
      savingOffline={savingOffline}
      tenderedMinor={tenderedMinor}
      totalMinor={totals.totalMinor}
    />
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      {registerHeader}
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[
          styles.scrollContent,
          usesCompactPhoneSpacing ? styles.scrollContentCompact : null,
        ]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        testID="pos-scroll"
      >
      <View style={[styles.saleWorkspace, usesTabletCartPane ? styles.saleWorkspaceTablet : null]}>
      <View style={styles.cataloguePane}>
      <CashierCatalogue
        categories={categories}
        categoryId={categoryId}
        currencyCode={core.organization.currencyCode}
        error={catalogError}
        items={items}
        loading={catalogLoading}
        lookup={lookup}
        onCategory={setCategoryId}
        onFindBarcode={() => void find()}
        onLookupChange={setLookup}
        onOpenCamera={() => setCameraScannerOpen(true)}
        onProduct={(item) => void add(item)}
        onQueryChange={setQuery}
        query={query}
        storeName={assignedStore?.name ?? core.organization.name}
      />
      </View>

      <View style={styles.cartPane}>
      <CashierCartWorkspace
        canApplyDiscounts={canApplyDiscounts}
        canCreateCustomers={canCreateCustomers}
        canEditQuantity={canEditQuantity}
        canRemove={canRemoveItems}
        cart={cart}
        compact={!usesTabletCartPane}
        currencyCode={core.organization.currencyCode}
        customerQuery={customerQuery}
        customerRows={customerRows}
        diningEnabled={Boolean(gates?.dining)}
        diningOptionId={diningOptionId}
        diningOptions={diningOptions}
        discountId={discountId}
        discounts={discounts}
        expanded={usesTabletCartPane || cartExpanded}
        inventory={cartInventoryIntelligence}
        newCustomerEmail={newCustomerEmail}
        newCustomerName={newCustomerName}
        newCustomerPhone={newCustomerPhone}
        onCreateCustomer={() => void createCustomer()}
        onCustomerQuery={setCustomerQuery}
        onDining={(value) => { setDiningOptionId(value); markCartChanged(); }}
        onDiscount={(value) => { setDiscountId(value); markCartChanged(); }}
        onNewCustomerEmail={setNewCustomerEmail}
        onNewCustomerName={setNewCustomerName}
        onNewCustomerPhone={setNewCustomerPhone}
        onNote={setLineNote}
        onQuantity={setLineQuantity}
        onReconfigure={(line) => void startConfigure(line, line)}
        onRemove={removeLine}
        onSearchCustomers={() => void searchCustomers()}
        onSelectCustomer={(value) => { setSelectedCustomer(value); markCartChanged(); }}
        onTax={(value) => { setTaxId(value); markCartChanged(); }}
        onToggle={() => setCartExpanded((current) => !current)}
        online={mode === "online"}
        restrictionMessage={offlineCartRestriction && offlineCartRestriction !== "EMPTY_CART"
          ? offlineCashCartRestrictionMessage(offlineCartRestriction)
          : null}
        selectedCustomer={selectedCustomer}
        taxId={taxId}
        taxes={taxes}
        totals={totals}
      />
      {usesTabletCartPane ? renderTenderPanel() : null}
      </View>
      </View>

      {canUseTickets ? (
        <TindioWorkspaceSection
          description="Save this cart for later or reopen an existing ticket. Ticket changes require a connection."
          title="Open ticket"
        >
          <TindioButton disabled={mode !== "online"} onPress={() => void loadTickets()} variant="secondary">
            Load tickets
          </TindioButton>

          {openTickets.map((ticket) => (
            <TindioListItem
              detail={`${ticket.cart.length} line(s)`}
              key={ticket.id}
              meta={activeTicketId === ticket.id ? "Selected" : undefined}
              onPress={() => loadTicketIntoCart(ticket)}
              selected={activeTicketId === ticket.id}
              title={ticket.label}
            />
          ))}

          <TindioInput
            label="Ticket label"
            value={ticketLabel}
            onChangeText={setTicketLabel}
            placeholder="Ticket label"
          />

          <TindioInput
            label="Ticket note"
            value={ticketNote}
            onChangeText={setTicketNote}
            placeholder="Ticket note"
            maxLength={500}
          />

          <TindioButton
            busy={ticketPending}
            disabled={
              mode !== "online"
              || ticketPending
              || !ticketLabel.trim()
              || cart.length === 0
            }
            onPress={() => void saveCurrentTicket()}
          >
            {ticketPending
              ? "Saving ticket"
              : activeTicketId
                ? "Update open ticket"
                : "Save as open ticket"}
          </TindioButton>
        </TindioWorkspaceSection>
      ) : null}

      {!usesTabletCartPane ? renderTenderPanel() : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: tindioTheme.color.surface.app, flex: 1 },
  unavailableScreen: { alignItems: "center", justifyContent: "center" },
  unavailableCard: { maxWidth: 520, width: "100%" },
  unavailableActions: { gap: tindioTheme.space.sm },
  eyebrow: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.primary, letterSpacing: 1.2 },
  stateTitle: { ...tindioTheme.typography.role.title, color: tindioTheme.color.content.primary },
  gateScroll: { flexGrow: 1 },
  scrollContent: { gap: tindioTheme.space.sm, padding: tindioTheme.space.md, paddingBottom: 64 },
  scrollContentCompact: { padding: tindioTheme.space.sm, paddingBottom: 48 },
  saleWorkspace: { gap: tindioTheme.space.md },
  saleWorkspaceTablet: { alignItems: "flex-start", flexDirection: "row" },
  cataloguePane: { flex: 3, minWidth: 0 },
  cartPane: { flex: 2, minWidth: 0 },
});
