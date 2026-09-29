import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PosCartLine, PosCatalogItem } from "../../../../src/contracts/pos";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { getLocalCategories, getLocalDiscounts, getLocalTaxRates } from "../../src/features/local-first/local-reference";
import { lookupLocalBarcode, lookupLocalSku, searchLocalCatalog } from "../../src/features/local-first/local-catalog";
import { calculateLocalCartTotals } from "../../src/features/local-first/local-cart";
import { readLocalStockEstimate } from "../../src/features/local-first/local-stock";
import { createOfflineCashSale } from "../../src/features/outbox/create-offline-sale";
import { syncOutboxEvents } from "../../src/features/outbox/outbox-sync";
import { checkoutPosV2 } from "../../src/lib/tindio-api";
import * as Crypto from "expo-crypto";

function parseMoneyToMinor(value: string) {
  const match = value.trim().match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
  return match ? Number(match[1]) * 100 + Number(`${match[2] ?? ""}00`.slice(0, 2)) : null;
}

function asCartLine(item: PosCatalogItem): PosCartLine {
  return { ...item, quantity: 1, manualPriceMinor: null, modifierOptionIds: [], modifiers: [] };
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
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [taxId, setTaxId] = useState<string | null>(null);
  const [cashTender, setCashTender] = useState("");
  const [stock, setStock] = useState("UNKNOWN");
  const [saleMessage, setSaleMessage] = useState<string | null>(null);
  const [savingOffline, setSavingOffline] = useState(false);
  const [onlineCheckoutPending, setOnlineCheckoutPending] = useState(false);

  const load = useCallback(async () => {
    if (!core || !binding) return;
    const [nextItems, nextCategories, nextDiscounts, nextTaxes] = await Promise.all([
      searchLocalCatalog({ organizationId: core.organization.id, storeId: binding.storeId, query, categoryId }),
      getLocalCategories(core.organization.id), getLocalDiscounts(core.organization.id), getLocalTaxRates(core.organization.id),
    ]);
    setItems(nextItems); setCategories(nextCategories); setDiscounts(nextDiscounts); setTaxes(nextTaxes);
  }, [binding, categoryId, core, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => calculateLocalCartTotals(
    cart, discounts.find((discount) => discount.id === discountId) ?? null,
    taxes.find((tax) => tax.id === taxId) ?? null,
  ), [cart, discountId, discounts, taxId, taxes]);
  const tenderedMinor = parseMoneyToMinor(cashTender);
  const changeMinor = tenderedMinor === null ? null : Math.max(0, tenderedMinor - totals.totalMinor);

  if (!core || !binding || !terminal.identity) return <Text>Local catalog is not prepared.</Text>;

  const add = async (item: PosCatalogItem) => {
    if (item.isVariablePrice || item.hasModifiers) {
      setSaleMessage("This item is not supported for an offline cash sale.");
      return;
    }
    setCart((current) => {
      const index = current.findIndex((line) => line.productId === item.productId && line.variantId === item.variantId);
      if (index < 0) return [...current, asCartLine(item)];
      return current.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: line.quantity + 1 } : line);
    });
    const estimate = await readLocalStockEstimate(core.organization.id, binding.storeId, item.productId, item.variantId);
    setStock(estimate.status === "CACHED_ESTIMATE" ? String(estimate.availableQuantity) : "UNKNOWN");
  };

  const find = async () => {
    const item = await lookupLocalBarcode(core.organization.id, binding.storeId, lookup) ??
      await lookupLocalSku(core.organization.id, binding.storeId, lookup);
    if (item) await add(item);
  };

  const saveOfflineCashSale = async () => {
    if (savingOffline) return;
    setSavingOffline(true); setSaleMessage(null);
    try {
      const result = await createOfflineCashSale({
        organizationId: core.organization.id, binding, deviceId: terminal.identity.credential.deviceId,
        cart, totals, discountId, taxRateId: taxId, tenderedMinor: tenderedMinor ?? -1,
      });
      if (!result.ok) {
        setSaleMessage(`Offline cash sale was not saved: ${result.reason}`);
        return;
      }
      // This happens only after the SQLite transaction committed the durable event.
      setCart([]); setCashTender(""); setDiscountId(null); setTaxId(null);
      setSaleMessage(`SAVED LOCALLY ${result.event.localReference}. Change due: ${result.event.snapshot.changeMinor}.`);
      if (mode === "online") void syncOutboxEvents(core.organization.id);
    } finally {
      setSavingOffline(false);
    }
  };
  const completeOnlineCashSale = async () => { if (onlineCheckoutPending || mode !== "online" || tenderedMinor === null || tenderedMinor < totals.totalMinor) return; setOnlineCheckoutPending(true); try { const result = await checkoutPosV2(core.organization.id,{storeId:binding.storeId,registerId:binding.registerId,idempotencyKey:Crypto.randomUUID(),customerId:null,loyaltyRedemptionPoints:0,discountId,taxRateId:taxId,diningOptionId:null,openTicketId:null,items:cart.map(line=>({productId:line.productId,variantId:line.variantId,quantity:line.quantity,unitPriceMinor:line.manualPriceMinor,modifierOptionIds:line.modifierOptionIds,itemNote:line.itemNote??null})),payments:[{paymentMethodId:"CASH",tenderedAmount:cashTender,referenceNumber:"",note:""}]});if(result.ok){setCart([]);setCashTender("");setSaleMessage(`SERVER RECEIPT #${result.data.receiptNumber}`);void syncOutboxEvents(core.organization.id);}else setSaleMessage(result.retryable?"Checkout not confirmed. Check Recent Receipts before retrying.":result.message);}finally{setOnlineCheckoutPending(false);} };

  return <View>
    <Text>LOCAL-FIRST POS</Text><Text>Catalog source: SQLite</Text>
    <Text>Offline checkout: CASH ONLY — server confirmation is required later.</Text>
    <TextInput value={query} onChangeText={setQuery} placeholder="Search local catalog" />
    <TextInput value={lookup} onChangeText={setLookup} placeholder="Barcode or SKU" />
    <Pressable onPress={() => void find()}><Text>Find local barcode/SKU</Text></Pressable>
    <Pressable onPress={() => setCategoryId(null)}><Text>All categories</Text></Pressable>
    {categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)}><Text>{category.name}</Text></Pressable>)}
    {items.map((item) => <Pressable key={`${item.productId}:${item.variantId ?? "simple"}`} onPress={() => void add(item)}><Text>{item.productName} — {item.priceMinor}</Text></Pressable>)}
    <Text>Cart lines: {cart.length}</Text>
    {cart.map((line) => <View key={`${line.productId}:${line.variantId ?? "simple"}`}><Text>{line.productName} × {line.quantity}</Text><Pressable onPress={() => setCart((current) => current.filter((entry) => entry !== line))}><Text>Remove</Text></Pressable></View>)}
    <Text>LOCAL PREVIEW ONLY</Text>
    <Text>Subtotal {totals.subtotalMinor}; Discount {totals.discountMinor}; Tax {totals.taxMinor}; Total {totals.totalMinor}</Text>
    <Text>Stock: {stock}</Text>
    {discounts.map((discount) => <Pressable key={discount.id} onPress={() => setDiscountId(discount.id)}><Text>Discount {discount.name}</Text></Pressable>)}
    {taxes.map((tax) => <Pressable key={tax.id} onPress={() => setTaxId(tax.id)}><Text>Tax {tax.name}</Text></Pressable>)}
    <TextInput value={cashTender} onChangeText={setCashTender} keyboardType="decimal-pad" placeholder="Cash tendered, e.g. 20.00" />
    <Text>Cash change preview: {changeMinor ?? "Enter a valid tender"}</Text>
    <Pressable disabled={savingOffline || cart.length === 0 || tenderedMinor === null || tenderedMinor < totals.totalMinor} onPress={() => void saveOfflineCashSale()}><Text>{savingOffline ? "Saving locally…" : "SAVE OFFLINE CASH SALE"}</Text></Pressable>
    <Pressable disabled={mode !== "online" || onlineCheckoutPending || cart.length === 0 || tenderedMinor === null || tenderedMinor < totals.totalMinor} onPress={() => void completeOnlineCashSale()}><Text>{onlineCheckoutPending ? "Processing server checkout…" : "COMPLETE ONLINE CASH CHECKOUT"}</Text></Pressable>
    {saleMessage ? <Text>{saleMessage}</Text> : null}
  </View>;
}
