import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type {
  PosCartLine,
  PosCatalogItem,
  PosCustomer,
  PosModifierGroup,
  PosModifierOption,
  PosOpenTicket,
} from "../../../../src/contracts/pos";
import { posItemKey } from "../../../../src/features/pos/pos-types";
import { saveCustomerSearchResults, searchCachedCustomers } from "../../src/db/customer-cache";
import { CashierCartLine } from "../../src/features/cashier/cashier-cart-line";
import { ModifierPicker, VariablePriceEditor } from "../../src/features/cashier/cashier-editors";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { formatMoney } from "../../src/features/cashier/cashier-format";
import {
  cartSupportsDurableOfflineCash,
  minorToMoney,
  sameConfiguration,
  sameSaleable,
} from "../../src/features/cashier/cashier-validation";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import {
  lookupLocalBarcode,
  lookupLocalSku,
  searchLocalCatalog,
} from "../../src/features/local-first/local-catalog";
import { calculateLocalCartTotals } from "../../src/features/local-first/local-cart";
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
  readOfflineInventoryIntelligence,
  type OfflineInventoryIntelligence,
} from "../../src/features/inventory/offline-inventory-intelligence";
import { createOfflineCashSale } from "../../src/features/outbox/create-offline-sale";
import { syncOutboxEvents } from "../../src/features/outbox/outbox-sync";
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
  const { data, mode } = useBusinessContext();
  const core = data?.core;
  const terminal = useTerminalDevice(core?.organization.id);
  const binding = terminal.identity?.binding;

  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [items, setItems] = useState<PosCatalogItem[]>([]);
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof getLocalCategories>>>([]);
  const [discounts, setDiscounts] = useState<Awaited<ReturnType<typeof getLocalDiscounts>>>([]);
  const [taxes, setTaxes] = useState<Awaited<ReturnType<typeof getLocalTaxRates>>>([]);
  const [diningOptions, setDiningOptions] = useState<Awaited<ReturnType<typeof getLocalDiningOptions>>>([]);
  const [paymentMethods, setPaymentMethods] = useState<Awaited<ReturnType<typeof getLocalPaymentMethods>>>([]);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [taxId, setTaxId] = useState<string | null>(null);
  const [diningOptionId, setDiningOptionId] = useState<string | null>(null);
  const [cashTender, setCashTender] = useState("");
  const [inventoryIntelligence, setInventoryIntelligence] =
    useState<OfflineInventoryIntelligence | null>(null);
  const [saleMessage, setSaleMessage] = useState<string | null>(null);
  const [savingOffline, setSavingOffline] = useState(false);
  const [onlineCheckoutPending, setOnlineCheckoutPending] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState(() => Crypto.randomUUID());

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

  const shiftMatches = Boolean(
    core?.activeShift
    && binding
    && core.activeShift.storeId === binding.storeId
    && core.activeShift.registerId === binding.registerId,
  );

  const load = useCallback(async () => {
    if (!core || !binding) return;

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
  }, [binding, categoryId, core, diningOptionId, query, taxId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

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

  const offlineCartEligible = cartSupportsDurableOfflineCash(cart, {
    customerId: selectedCustomer?.id ?? null,
    diningOptionId,
    openTicketId: activeTicketId,
  });

  if (!core || !binding || !terminal.identity) {
    return <Text>Local catalog is not prepared.</Text>;
  }

  const markCartChanged = () => {
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

    setInventoryIntelligence(
      await readOfflineInventoryIntelligence({
        organizationId: core.organization.id,
        storeId: binding.storeId,
        deviceId: terminal.identity.credential.deviceId,
        productId: item.productId,
        variantId: item.variantId,
      }),
    );
  };

  const find = async () => {
    const item =
      await lookupLocalBarcode(core.organization.id, binding.storeId, lookup)
      ?? await lookupLocalSku(core.organization.id, binding.storeId, lookup);

    if (item) {
      await add(item);
      setLookup("");
    } else {
      setSaleMessage("No local barcode/SKU match.");
    }
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
        device: terminal.identity.credential,
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
    setCheckoutKey(Crypto.randomUUID());
  };

  const saveOfflineCashSale = async () => {
    if (savingOffline || !offlineCartEligible) return;

    setSavingOffline(true);
    setSaleMessage(null);

    try {
      const result = await createOfflineCashSale({
        organizationId: core.organization.id,
        binding,
        deviceId: terminal.identity.credential.deviceId,
        cart,
        totals,
        discountId,
        taxRateId: taxId,
        tenderedMinor: tenderedMinor ?? -1,
      });

      if (!result.ok) {
        setSaleMessage(`Offline cash sale was not saved: ${result.reason}`);
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
      || mode !== "online"
      || !canCreateSales
      || !canAcceptPayments
      || !shiftMatches
      || !cashMethod
      || tenderedMinor === null
      || tenderedMinor < totals.totalMinor
      || cart.length === 0
    ) return;

    setOnlineCheckoutPending(true);
    setSaleMessage(null);

    try {
      const result = await checkoutPosV2(core.organization.id, {
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
          paymentMethodId: cashMethod.id,
          tenderedAmount: cashTender,
          referenceNumber: "",
          note: "",
        }],
      });

      if (result.ok) {
        clearSaleState();
        setSaleMessage(`SERVER RECEIPT #${result.data.receiptNumber}`);
        void syncOutboxEvents(core.organization.id);
        return;
      }

      setSaleMessage(
        result.retryable
          ? "CHECKOUT STATUS UNKNOWN — retry only this same checkout or verify Recent Receipts first."
          : result.message,
      );
    } catch {
      setSaleMessage(
        "CHECKOUT STATUS UNKNOWN — verify Recent Receipts before starting another sale. Retrying this unchanged sale will reuse the same idempotency key.",
      );
    } finally {
      setOnlineCheckoutPending(false);
    }
  };

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
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>LOCAL-FIRST POS</Text>
      <Text>Catalog source: SQLite</Text>
      <Text>Business: {core.organization.name}</Text>
      <Text>Store/register: {binding.storeId} / {binding.registerId}</Text>
      <Text>
        {shiftMatches
          ? "Active shift matches this terminal."
          : "Open the matching register shift before checkout."}
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search local catalog"
      />

      <TextInput
        value={lookup}
        onChangeText={setLookup}
        placeholder="Barcode or SKU"
      />

      <Pressable onPress={() => void find()}>
        <Text>Find local barcode/SKU</Text>
      </Pressable>

      <Pressable onPress={() => setCategoryId(null)}>
        <Text>All categories</Text>
      </Pressable>

      {categories.map((category) => (
        <Pressable
          key={category.id}
          onPress={() => setCategoryId(category.id)}
        >
          <Text>{category.name}</Text>
        </Pressable>
      ))}

      {items.map((item) => (
        <Pressable
          key={`${item.productId}:${item.variantId ?? "simple"}`}
          onPress={() => void add(item)}
        >
          <Text>
            {item.productName}
            {item.variantName ? ` / ${item.variantName}` : ""}
            {" — "}
            {formatMoney(item.priceMinor, core.organization.currencyCode)}
            {item.isVariablePrice ? " — variable price" : ""}
            {item.hasModifiers ? " — modifiers" : ""}
          </Text>
        </Pressable>
      ))}

      <Text>Cart lines: {cart.length}</Text>

      {cart.map((line) => (
        <CashierCartLine
          key={posItemKey(line)}
          line={line}
          currencyCode={core.organization.currencyCode}
          canEditQuantity={canEditQuantity}
          canRemove={canRemoveItems}
          onQuantity={(quantity) => setLineQuantity(line, quantity)}
          onNote={(note) => setLineNote(line, note)}
          onReconfigure={() => void startConfigure(line, line)}
          onRemove={() => removeLine(line)}
        />
      ))}

      <Text>LOCAL PREVIEW ONLY</Text>
      <Text>
        Subtotal {formatMoney(totals.subtotalMinor, core.organization.currencyCode)}
        {" — "}Discount {formatMoney(totals.discountMinor, core.organization.currencyCode)}
        {" — "}Tax {formatMoney(totals.taxMinor, core.organization.currencyCode)}
        {" — "}Total {formatMoney(totals.totalMinor, core.organization.currencyCode)}
      </Text>

      <View>
        <Text>INVENTORY INTELLIGENCE â€” ESTIMATE ONLY</Text>

        {inventoryIntelligence ? (
          <>
            <Text>
              Last confirmed cloud stock:{" "}
              {inventoryIntelligence.lastConfirmedCloudStock ?? "UNKNOWN"}
            </Text>
            <Text>
              Last confirmed at:{" "}
              {inventoryIntelligence.lastConfirmedAt ?? "NO CLOUD BASELINE"}
            </Text>
            <Text>
              Known synced activity from this terminal after baseline:{" "}
              {inventoryIntelligence.knownSyncedActivityFromThisTerminal}
            </Text>
            <Text>
              Device-only unsynced activity:{" "}
              {inventoryIntelligence.deviceOnlyUnsyncedActivity}
            </Text>
            <Text>
              Estimated available stock:{" "}
              {inventoryIntelligence.estimatedAvailableStock ?? "UNKNOWN"}
            </Text>
            <Text>
              Unresolved local sale events affecting this item:{" "}
              {inventoryIntelligence.unresolvedEventCount}
            </Text>
            <Text>
              Scope: CURRENT DEVICE ONLY. This value is not authoritative cloud stock.
            </Text>
          </>
        ) : (
          <Text>Select an item to calculate inventory intelligence.</Text>
        )}
      </View>

      {canApplyDiscounts ? (
        <>
          <Pressable onPress={() => { setDiscountId(null); markCartChanged(); }}>
            <Text>No discount</Text>
          </Pressable>
          {discounts.map((discount) => (
            <Pressable
              key={discount.id}
              onPress={() => {
                setDiscountId(discount.id);
                markCartChanged();
              }}
            >
              <Text>
                {discountId === discount.id ? "✓ " : ""}
                Discount {discount.name}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {taxes.map((tax) => (
        <Pressable
          key={tax.id}
          onPress={() => {
            setTaxId(tax.id);
            markCartChanged();
          }}
        >
          <Text>
            {taxId === tax.id ? "✓ " : ""}
            Tax {tax.name}
          </Text>
        </Pressable>
      ))}

      {gates?.dining ? (
        <View>
          <Text>Dining option</Text>
          {diningOptions.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => {
                setDiningOptionId(option.id);
                markCartChanged();
              }}
            >
              <Text>
                {diningOptionId === option.id ? "✓ " : ""}
                {option.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View>
        <Text>CUSTOMER</Text>

        {selectedCustomer ? (
          <>
            <Text>
              Selected: {selectedCustomer.fullName} — loyalty {selectedCustomer.loyaltyPoints}
            </Text>
            <Pressable
              onPress={() => {
                setSelectedCustomer(null);
                markCartChanged();
              }}
            >
              <Text>Clear customer</Text>
            </Pressable>
          </>
        ) : null}

        <TextInput
          value={customerQuery}
          onChangeText={setCustomerQuery}
          placeholder="Search customer"
        />

        <Pressable onPress={() => void searchCustomers()}>
          <Text>{mode === "online" ? "Search customers" : "Search cached customers"}</Text>
        </Pressable>

        {customerRows.map((customer) => (
          <Pressable
            key={customer.id}
            onPress={() => {
              setSelectedCustomer(customer);
              markCartChanged();
            }}
          >
            <Text>
              {customer.fullName} — #{customer.customerNumber} — loyalty {customer.loyaltyPoints}
            </Text>
          </Pressable>
        ))}

        {canCreateCustomers && mode === "online" ? (
          <>
            <TextInput
              value={newCustomerName}
              onChangeText={setNewCustomerName}
              placeholder="New customer name"
            />
            <TextInput
              value={newCustomerEmail}
              onChangeText={setNewCustomerEmail}
              placeholder="Email"
              keyboardType="email-address"
            />
            <TextInput
              value={newCustomerPhone}
              onChangeText={setNewCustomerPhone}
              placeholder="Phone"
            />
            <Pressable
              disabled={!newCustomerName.trim()}
              onPress={() => void createCustomer()}
            >
              <Text>Create + select customer</Text>
            </Pressable>
          </>
        ) : null}
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

      <TextInput
        value={cashTender}
        onChangeText={setCashTender}
        keyboardType="decimal-pad"
        placeholder="Cash tendered, e.g. 20.00"
      />

      <Text>
        Cash change preview:{" "}
        {changeMinor === null
          ? "Enter a valid tender"
          : formatMoney(changeMinor, core.organization.currencyCode)}
      </Text>

      {!cashMethod ? <Text>No enabled cash payment method is cached for this store.</Text> : null}

      <Pressable
        disabled={
          savingOffline
          || !offlineCartEligible
          || cart.length === 0
          || tenderedMinor === null
          || tenderedMinor < totals.totalMinor
        }
        onPress={() => void saveOfflineCashSale()}
      >
        <Text>{savingOffline ? "Saving locally…" : "SAVE OFFLINE CASH SALE"}</Text>
      </Pressable>

      {!offlineCartEligible && cart.length > 0 ? (
        <Text>
          This cart requires online checkout because it contains customer/ticket/dining,
          variable-price, modifier, or line-note state that the Phase 10 offline sale contract does not persist.
        </Text>
      ) : null}

      <Pressable
        disabled={
          mode !== "online"
          || onlineCheckoutPending
          || !canCreateSales
          || !canAcceptPayments
          || !shiftMatches
          || !cashMethod
          || cart.length === 0
          || tenderedMinor === null
          || tenderedMinor < totals.totalMinor
        }
        onPress={() => void completeOnlineCashSale()}
      >
        <Text>
          {onlineCheckoutPending
            ? "Processing server checkout…"
            : "COMPLETE ONLINE CASH CHECKOUT"}
        </Text>
      </Pressable>

      {saleMessage ? <Text>{saleMessage}</Text> : null}
      <Text>Current checkout operation: {checkoutKey}</Text>
      <Text>
        The operation key remains unchanged after an ambiguous retry and rotates only when the sale meaning changes or completes.
      </Text>
    </ScrollView>
  );
}
