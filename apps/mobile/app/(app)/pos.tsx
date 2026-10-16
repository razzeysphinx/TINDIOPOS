import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
import { formatMoney } from "../../src/features/cashier/cashier-format";
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

const TABLET_CART_PANE_MIN_WIDTH = 900;

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
  const { width } = useWindowDimensions();
  const { data, mode, cashierReadinessState } = useBusinessContext();
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
  const usesTabletCartPane = width >= TABLET_CART_PANE_MIN_WIDTH;

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
    || !binding
    || !identity
  ) {
    return (
      <Text>
        Local catalog is not prepared.
      </Text>
    );
  }

  const markCartChanged = () => {
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

      clearSaleState();

      setSaleMessage(
        `SAVED LOCALLY ${result.event.localReference}. Change due: ${formatMoney(result.event.snapshot.changeMinor, core.organization.currencyCode)}.`,
      );

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
        clearSaleState();
        setSaleMessage(`SERVER RECEIPT #${result.data.receiptNumber}`);
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 20, paddingBottom: 64, gap: 12 }}
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
        terminalLabel={shiftMatches
          ? `${core.organization.name} · Register ready`
          : `${core.organization.name} · Shift required before checkout`}
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
      </View>
      </View>

      {canUseTickets ? (
        <View>
          <Text>OPEN TICKET</Text>
          <Pressable disabled={mode !== "online"} onPress={() => void loadTickets()}>
            <Text>Load tickets</Text>
          </Pressable>

          {openTickets.map((ticket) => (
            <Pressable key={ticket.id} onPress={() => loadTicketIntoCart(ticket)}>
              <Text>
                {activeTicketId === ticket.id ? "✓ " : ""}
                {ticket.label} — {ticket.cart.length} line(s)
              </Text>
            </Pressable>
          ))}

          <TextInput
            value={ticketLabel}
            onChangeText={setTicketLabel}
            placeholder="Ticket label"
          />

          <TextInput
            value={ticketNote}
            onChangeText={setTicketNote}
            placeholder="Ticket note"
            maxLength={500}
          />

          <Pressable
            disabled={
              mode !== "online"
              || ticketPending
              || !ticketLabel.trim()
              || cart.length === 0
            }
            onPress={() => void saveCurrentTicket()}
          >
            <Text>
              {ticketPending
                ? "Saving ticket..."
                : activeTicketId
                  ? "Update open ticket"
                  : "Save as open ticket"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {onlineIntent && !onlineIntentMatchesCurrentContext ? (
        <Text>
          This unresolved checkout belongs to its original employee, shift, store, and register.
          Restore that operating context or reconcile it under supervised recovery; do not start a new sale.
        </Text>
      ) : null}

      <Text>Current checkout operation: {checkoutKey}</Text>
      <Text>
        The operation key remains unchanged after an ambiguous retry and rotates only when the sale meaning changes or completes.
      </Text>

      <View
        style={{
          backgroundColor: "white",
          borderTopColor: "#d1d5db",
          borderTopWidth: 1,
          gap: 8,
          paddingBottom: 20,
          paddingHorizontal: 20,
          paddingTop: 12,
        }}
        testID="checkout-panel"
      >
      <Text>
        Checkout total: {formatMoney(totals.totalMinor, core.organization.currencyCode)}
      </Text>

      <TextInput
        accessibilityLabel="Cash tendered"
        value={cashTender}
        onChangeText={setCashTender}
        keyboardType="decimal-pad"
        placeholder="Cash tendered, e.g. 20.00"
        returnKeyType="done"
        style={{ minHeight: 48 }}
        testID="cash-tender-input"
      />

      <Text>
        Cash change preview:{" "}
        {changeMinor === null
          ? "Enter a valid tender"
          : formatMoney(changeMinor, core.organization.currencyCode)}
      </Text>

      {!cashMethod ? <Text>No enabled cash payment method is cached for this store.</Text> : null}

      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole={offlineSaleReady ? undefined : "alert"}
        testID="offline-readiness"
      >
        Offline readiness: {cashierReadinessLabel(cashierReadinessState)}
      </Text>
      {!offlineSaleReady && cart.length > 0 ? (
        <Text accessibilityRole="alert">
          Offline payment is paused. This cart remains available while you reconnect or complete preparation.
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save offline cash sale"
        testID="save-offline-cash-sale"
        disabled={
          onlineIntentLoading
          || savingOffline
          || !offlineSaleReady
          || Boolean(onlineIntent)
          || !offlineCartEligible
          || cart.length === 0
          || tenderedMinor === null
          || tenderedMinor < totals.totalMinor
        }
        onPress={() => void saveOfflineCashSale()}
        style={{ minHeight: 48, justifyContent: "center" }}
      >
        <Text>{savingOffline ? "Saving locally…" : "SAVE OFFLINE CASH SALE"}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={onlineIntent ? "Retry original online checkout" : "Complete online cash checkout"}
        testID="complete-online-cash-checkout"
        disabled={
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
        }
        onPress={() => void completeOnlineCashSale()}
        style={{ minHeight: 48, justifyContent: "center" }}
      >
        <Text>
          {onlineCheckoutPending
            ? "Processing server checkout…"
            : onlineIntent
              ? "RETRY ORIGINAL ONLINE CHECKOUT"
              : "COMPLETE ONLINE CASH CHECKOUT"}
        </Text>
      </Pressable>

      {saleMessage ? <Text accessibilityLiveRegion="polite">{saleMessage}</Text> : null}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  saleWorkspace: { gap: tindioTheme.space.md },
  saleWorkspaceTablet: { alignItems: "flex-start", flexDirection: "row" },
  cataloguePane: { flex: 3, minWidth: 0 },
  cartPane: { flex: 2, minWidth: 0 },
});
