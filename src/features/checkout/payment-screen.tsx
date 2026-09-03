"use client";

import {
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  CloudOff,
  CreditCard,
  Landmark,
  LoaderCircle,
  Minus,
  Plus,
  Printer,
  Smartphone,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import type { CheckoutSaleValues } from "@/features/checkout/checkout-schema";
import type { PosDeviceCredential } from "@/features/devices/device-schema";
import type {
  CheckoutPaymentSummary,
  CheckoutSaleActionResult,
} from "@/features/checkout/checkout-types";
import { enqueueOfflineCheckout } from "@/features/offline/offline-store";
import type {
  PosCartLine,
  PosCustomer,
  PosDiscount,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosRegister,
  PosTaxRate,
} from "@/features/pos/pos-types";
import { cn } from "@/lib/utils";

type DraftPayment = {
  method: PosPaymentMethod;
  amountMinor: number;
  tenderedMinor: number | null;
  changeMinor: number | null;
  referenceNumber: string;
  note: string;
};

type CompletedCheckout = {
  saleId: string;
  receiptNumber: number;
  totalMinor: number;
  changeMinor: number;
  payments: CheckoutPaymentSummary[];
  inventoryWarning: string | null;
};

type QueuedCheckout = {
  localReceiptReference: string;
  totalMinor: number;
  tenderedMinor: number;
  changeMinor: number;
};

const CASH_DENOMINATIONS_MINOR = [
  5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000,
  2_000_000, 5_000_000, 10_000_000,
];

function moneyInputToMinor(value: string) {
  const match = value.trim().match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  return Number(match[1]) * 100 + Number(`${match[2] ?? ""}00`.slice(0, 2));
}

function minorToMoneyInput(value: number) {
  return (value / 100).toFixed(2);
}

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

async function submitOnlineCheckout(
  payload: CheckoutSaleValues,
  device: PosDeviceCredential | null,
): Promise<CheckoutSaleActionResult> {
  const response = await fetch("/api/pos/checkout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkout: payload, device }),
  });
  const result = await response.json().catch(() => null) as CheckoutSaleActionResult | null;

  if (!result || typeof result.ok !== "boolean") {
    throw new Error("The checkout endpoint returned an invalid response.");
  }

  return result;
}

function cashTenderSuggestions(remainingMinor: number) {
  const banknoteIndex = CASH_DENOMINATIONS_MINOR.findIndex(
    (denomination) => denomination >= remainingMinor,
  );
  const firstBanknote =
    banknoteIndex >= 0
      ? CASH_DENOMINATIONS_MINOR[banknoteIndex]
      : roundUp(remainingMinor, 10_000_000);
  const nextBanknote =
    banknoteIndex >= 0 && banknoteIndex < CASH_DENOMINATIONS_MINOR.length - 1
      ? CASH_DENOMINATIONS_MINOR[banknoteIndex + 1]
      : firstBanknote * 2;

  return [...new Set([
    remainingMinor,
    ...[100, 1_000, 5_000, 10_000, 50_000].map((step) => roundUp(remainingMinor, step)),
    firstBanknote,
    nextBanknote,
  ])]
    .filter((value) => value >= remainingMinor)
    .sort((left, right) => left - right)
    .slice(0, 5);
}

function paymentIcon(type: PosPaymentMethod["type"]): LucideIcon {
  switch (type) {
    case "CASH":
      return Banknote;
    case "CARD":
      return CreditCard;
    case "E_WALLET":
      return Smartphone;
    case "BANK_TRANSFER":
      return Landmark;
    case "VOUCHER":
      return CircleDollarSign;
    default:
      return Building2;
  }
}

export function PaymentScreen({
  cart,
  currencyCode,
  device,
  deviceScope,
  idempotencyKey,
  customer,
  loyaltyProgram,
  paymentMethods,
  register,
  storeId,
  totalMinor,
  discountId,
  discountMinor,
  diningOptionId,
  openTicketId,
  offlineScope,
  taxRateId,
  taxMinor,
  subtotalMinor,
  activeShift,
  canApplyDiscounts,
  selectedDiscount,
  selectedTaxRate,
  discounts,
  onDiscountChange,
  onCancel,
  onComplete,
  onNewSale,
}: {
  cart: PosCartLine[];
  customer: PosCustomer | null;
  currencyCode: string;
  device: PosDeviceCredential | null;
  deviceScope: string | null;
  idempotencyKey: string;
  loyaltyProgram: PosLoyaltyProgram | null;
  paymentMethods: PosPaymentMethod[];
  register: PosRegister;
  storeId: string;
  totalMinor: number;
  discountId: string | null;
  discountMinor: number;
  diningOptionId: string | null;
  openTicketId: string | null;
  offlineScope: string;
  taxRateId: string | null;
  taxMinor: number;
  subtotalMinor: number;
  activeShift: { id: string; openedAt: string; openingCashMinor: number };
  canApplyDiscounts: boolean;
  selectedDiscount: PosDiscount | null;
  selectedTaxRate: PosTaxRate | null;
  discounts: PosDiscount[];
  onDiscountChange: (discountId: string | null) => void;
  onCancel: () => void;
  onComplete: (checkout: CompletedCheckout) => void;
  onNewSale: () => void;
}) {
  const [activeMethodId, setActiveMethodId] = useState<string | null>(
    () => paymentMethods.find((method) => method.type === "CASH")?.id ?? null,
  );
  const [amount, setAmount] = useState("");
  const [cashTendered, setCashTendered] = useState(() => minorToMoneyInput(totalMinor));
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState("");
  const [draftPayments, setDraftPayments] = useState<DraftPayment[]>([]);
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completedCheckout, setCompletedCheckout] = useState<CompletedCheckout | null>(null);
  const [queuedCheckout, setQueuedCheckout] = useState<QueuedCheckout | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isCheckoutPending, startCheckoutTransition] = useTransition();

  const requestedLoyaltyPoints = /^\d+$/.test(loyaltyPointsInput.trim())
    ? Number(loyaltyPointsInput.trim())
    : loyaltyPointsInput.trim() === "" ? 0 : null;
  const maximumLoyaltyPoints = customer && loyaltyProgram && loyaltyProgram.isEnabled
    ? Math.min(
        customer.loyaltyPoints,
        Math.floor(totalMinor / loyaltyProgram.redemptionValueMinor),
      )
    : 0;
  const loyaltyInputIsValid =
    requestedLoyaltyPoints !== null &&
    (requestedLoyaltyPoints === 0 || (
      customer !== null &&
      loyaltyProgram !== null &&
      loyaltyProgram.isEnabled &&
      requestedLoyaltyPoints >= loyaltyProgram.minimumRedemptionPoints &&
      requestedLoyaltyPoints <= maximumLoyaltyPoints
    ));
  const loyaltyRedemptionMinor = loyaltyInputIsValid && requestedLoyaltyPoints
    ? requestedLoyaltyPoints * (loyaltyProgram?.redemptionValueMinor ?? 0)
    : 0;
  const appliedPaymentMinor = useMemo(
    () => draftPayments.reduce((total, payment) => total + payment.amountMinor, 0),
    [draftPayments],
  );
  const paidMinor = loyaltyRedemptionMinor + appliedPaymentMinor;
  const totalChangeMinor = useMemo(
    () => draftPayments.reduce((total, payment) => total + (payment.changeMinor ?? 0), 0),
    [draftPayments],
  );
  const remainingMinor = Math.max(0, totalMinor - paidMinor);
  const activeMethod = paymentMethods.find((method) => method.id === activeMethodId) ?? null;
  const cashMethod = paymentMethods.find((method) => method.type === "CASH") ?? null;
  const nonCashMethods = paymentMethods.filter((method) => method.type !== "CASH");
  const activeCashTenderMinor = moneyInputToMinor(cashTendered);
  const cashSuggestions = cashTenderSuggestions(remainingMinor);

  const offlineQueueEligible =
    draftPayments.length === 1 &&
    draftPayments[0]?.method.type === "CASH" &&
    draftPayments[0]?.method.offlinePolicy === "cash" &&
    draftPayments[0]?.tenderedMinor !== null &&
    requestedLoyaltyPoints === 0 &&
    openTicketId === null;
  const completionBlockMessage = isCheckoutPending
    ? "This sale is already being completed."
    : remainingMinor !== 0
      ? "Payments must cover the remaining sale total before completion."
      : !loyaltyInputIsValid || requestedLoyaltyPoints === null
        ? "Check the loyalty points before completing the sale."
        : !isOnline && !offlineQueueEligible
          ? "Offline selling supports one cash payment only. Reconnect before completing this sale."
          : null;
  const canCompleteSale = completionBlockMessage === null;
  const completionLabel =
    draftPayments.length === 1 && draftPayments[0]?.method.type === "CASH"
      ? "Complete cash sale"
      : "Complete sale";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCheckoutPending && !completedCheckout) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [completedCheckout, isCheckoutPending, onCancel]);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  const chooseMethod = (method: PosPaymentMethod) => {
    if (isCheckoutPending || completedCheckout) return;

    if (!isOnline && method.offlinePolicy !== "cash") {
      setMessage("This payment method needs an internet connection. Offline selling is limited to cash methods approved in Payment methods.");
      return;
    }

    setActiveMethodId(method.id);
    setAmount(minorToMoneyInput(remainingMinor));
    setCashTendered(minorToMoneyInput(remainingMinor));
    setReferenceNumber("");
    setNote("");
    setMessage(null);
  };

  const addPayment = () => {
    if (!activeMethod || remainingMinor <= 0) return;

    const isCash = activeMethod.type === "CASH";
    const enteredMinor = moneyInputToMinor(isCash ? cashTendered : amount);
    if (enteredMinor === null || enteredMinor <= 0) {
      setMessage(`Enter a valid ${isCash ? "cash tender" : "payment amount"}.`);
      return;
    }

    if (!isCash && enteredMinor > remainingMinor) {
      setMessage("Payment amount cannot be more than the remaining balance.");
      return;
    }

    if (enteredMinor < remainingMinor && !isSplitPayment) {
      setMessage("This amount is short. Choose Split payment to add another method.");
      return;
    }

    if (activeMethod.requiresReference && !referenceNumber.trim()) {
      setMessage("Enter the required reference number before adding this payment.");
      return;
    }

    const amountMinor = isCash ? Math.min(enteredMinor, remainingMinor) : enteredMinor;
    const nextPayment: DraftPayment = {
      method: activeMethod,
      amountMinor,
      tenderedMinor: isCash ? enteredMinor : null,
      changeMinor: isCash ? enteredMinor - amountMinor : null,
      referenceNumber: referenceNumber.trim(),
      note: note.trim(),
    };

    setDraftPayments((current) => [...current, nextPayment]);
    setActiveMethodId(null);
    setAmount("");
    setCashTendered("");
    setReferenceNumber("");
    setNote("");
    setMessage(
      amountMinor < remainingMinor
        ? `${formatMinorMoney(remainingMinor - amountMinor, currencyCode)} remains. Add another payment.`
        : null,
    );
  };

  const removePayment = (index: number) => {
    if (isCheckoutPending || completedCheckout) return;

    setDraftPayments((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setMessage(null);
  };

  const completeSale = () => {
    if (process.env.NODE_ENV === "development") {
      console.info("TINDIO checkout completion diagnostic", {
        saleTotal: totalMinor,
        displayedPaid: paidMinor,
        calculatedPaidForValidation: loyaltyRedemptionMinor + appliedPaymentMinor,
        remaining: remainingMinor,
        paymentEntries: draftPayments.map((payment) => ({
          method: payment.method.code,
          appliedMinor: payment.amountMinor,
          tenderedMinor: payment.tenderedMinor,
          changeMinor: payment.changeMinor,
        })),
        canCompleteSale,
        reason: completionBlockMessage,
      });
    }

    if (!canCompleteSale) {
      setMessage(completionBlockMessage ?? "This sale cannot be completed yet.");
      return;
    }

    const payload: CheckoutSaleValues = {
      storeId,
      registerId: register.id,
      idempotencyKey,
      customerId: customer?.id ?? null,
      loyaltyRedemptionPoints: requestedLoyaltyPoints ?? 0,
      discountId,
      taxRateId,
      diningOptionId,
      openTicketId,
      offlineExpectedTotalMinor: totalMinor,
      items: cart.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPriceMinor: line.manualPriceMinor,
        modifierOptionIds: line.modifierOptionIds,
        itemNote: line.itemNote ?? null,
      })),
      payments: draftPayments.map((payment) => ({
        paymentMethodId: payment.method.id,
        ...(payment.tenderedMinor !== null
          ? { tenderedAmount: minorToMoneyInput(payment.tenderedMinor) }
          : { amount: minorToMoneyInput(payment.amountMinor) }),
        referenceNumber: payment.referenceNumber,
        note: payment.note,
      })),
    };

    const queueCashSale = async () => {
      if (!offlineQueueEligible) {
        setMessage("Offline selling supports one cash payment only. Reconnect before completing this sale.");
        return;
      }

      const cashPayment = draftPayments[0];
      if (!cashPayment || cashPayment.tenderedMinor === null) return;

      try {
        const saved = await enqueueOfflineCheckout({
          idempotencyKey,
          scope: offlineScope,
          deviceScope,
          deviceId: device?.deviceId ?? null,
          payload,
          snapshot: {
            version: 1,
            capturedAt: new Date().toISOString(),
            shift: {
              id: activeShift.id,
              storeId,
              registerId: register.id,
              openedAt: activeShift.openedAt,
              openingCashMinor: activeShift.openingCashMinor,
            },
            customer: customer ? { id: customer.id, fullName: customer.fullName } : null,
            discount: selectedDiscount ? {
              id: selectedDiscount.id,
              name: selectedDiscount.name,
              discountType: selectedDiscount.discountType,
              percentageBps: selectedDiscount.percentageBps,
              amountMinor: selectedDiscount.amountMinor,
              appliedMinor: discountMinor,
            } : null,
            tax: selectedTaxRate ? {
              id: selectedTaxRate.id,
              name: selectedTaxRate.name,
              rateBps: selectedTaxRate.rateBps,
              isInclusive: selectedTaxRate.isInclusive,
              appliedMinor: taxMinor,
            } : null,
            payment: {
              id: cashPayment.method.id,
              name: cashPayment.method.name,
              type: cashPayment.method.type,
              offlinePolicy: cashPayment.method.offlinePolicy,
              tenderedMinor: cashPayment.tenderedMinor,
              appliedMinor: cashPayment.amountMinor,
              changeMinor: cashPayment.changeMinor ?? 0,
            },
            items: cart.map((line) => {
              const modifierTotalMinor = (line.modifiers ?? []).reduce(
                (sum, modifier) => sum + modifier.priceMinor,
                0,
              );
              const unitPriceMinor = line.manualPriceMinor ?? line.priceMinor;
              return {
                productId: line.productId,
                variantId: line.variantId,
                productName: line.productName,
                variantName: line.variantName,
                sku: line.sku,
                unit: line.unit,
                quantity: line.quantity,
                unitPriceMinor,
                modifierOptionIds: line.modifierOptionIds,
                modifierTotalMinor,
                lineSubtotalMinor: Math.round((unitPriceMinor + modifierTotalMinor) * line.quantity),
                itemNote: line.itemNote ?? null,
              };
            }),
            subtotalMinor,
            discountMinor,
            taxMinor,
            totalMinor,
          },
          summary: {
            currencyCode,
            totalMinor,
            tenderedMinor: cashPayment.tenderedMinor,
            changeMinor: cashPayment.changeMinor ?? 0,
            itemCount: cart.reduce((count, line) => count + line.quantity, 0),
          },
        });
        setQueuedCheckout({
          localReceiptReference: saved.localReceiptReference,
          totalMinor,
          tenderedMinor: cashPayment.tenderedMinor,
          changeMinor: cashPayment.changeMinor ?? 0,
        });
      } catch {
        setMessage("TINDIO could not save this offline sale on this device. Reconnect before accepting payment.");
      }
    };

    if (!isOnline && !offlineQueueEligible) {
      setMessage("Offline selling supports one cash payment only. Reconnect before completing this sale.");
      return;
    }

    setMessage(null);
    startCheckoutTransition(async () => {
      if (!navigator.onLine) {
        await queueCashSale();
        return;
      }

      try {
        const result = await submitOnlineCheckout(payload, device);

        if (!result.ok) {
          setMessage(result.message);
          return;
        }

        const checkout: CompletedCheckout = {
          saleId: result.data.saleId,
          receiptNumber: result.data.receiptNumber,
          totalMinor: result.data.totalMinor,
          changeMinor: result.data.changeMinor,
          payments: result.data.payments,
          inventoryWarning: result.data.inventoryWarning,
        };
        setCompletedCheckout(checkout);
        onComplete(checkout);
      } catch {
        if (offlineQueueEligible) {
          await queueCashSale();
          return;
        }
        setMessage(
          "TINDIO could not confirm this sale. Check Recent receipts before retrying.",
        );
      }
    });
  };

  if (queuedCheckout) {
    return (
      <section
        aria-labelledby="payment-queued-title"
        className="fixed inset-0 z-50 grid overflow-y-auto bg-background p-0 pb-[env(safe-area-inset-bottom)] sm:p-6"
      >
        <div className="m-auto w-full max-w-xl rounded-none border-y bg-card p-5 shadow-xl sm:rounded-2xl sm:border sm:p-8">
          <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
            <CloudOff className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.16em] text-primary">
            Cash sale queued
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]" id="payment-queued-title">
            {formatMinorMoney(queuedCheckout.totalMinor, currencyCode)}
          </h1>
          {queuedCheckout.changeMinor > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Give change: {formatMinorMoney(queuedCheckout.changeMinor, currencyCode)}
            </p>
          ) : null}
          <div className="mt-7 rounded-xl border bg-muted/30 p-4 text-sm leading-6">
            Temporary receipt {queuedCheckout.localReceiptReference}. Cash received: {formatMinorMoney(queuedCheckout.tenderedMinor, currencyCode)}. This sale is saved only on this device for now and will create an official receipt after TINDIO reconnects and verifies it.
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Do not enter the same sale again. Its checkout key prevents a duplicate if the first sync request was already received.
          </p>
          <Button className="mt-7 w-full" onClick={onNewSale} type="button">
            <Plus aria-hidden="true" />
            New sale
          </Button>
        </div>
      </section>
    );
  }

  if (completedCheckout) {
    return (
      <section
        aria-labelledby="payment-complete-title"
        className="fixed inset-0 z-50 grid overflow-y-auto bg-background p-0 pb-[env(safe-area-inset-bottom)] sm:p-6"
      >
        <div className="m-auto w-full max-w-xl rounded-none border-y bg-card p-5 shadow-xl sm:rounded-2xl sm:border sm:p-8">
          <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.16em] text-primary">
            Payment complete
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]" id="payment-complete-title">
            {formatMinorMoney(completedCheckout.totalMinor, currencyCode)}
          </h1>
          {completedCheckout.changeMinor > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Change: {formatMinorMoney(completedCheckout.changeMinor, currencyCode)}
            </p>
          ) : null}

          <div className="mt-7 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">Receipt #{completedCheckout.receiptNumber}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {completedCheckout.payments.map((payment, index) => (
                <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1" key={`${payment.paymentMethodId}-${index}`}>
                  <span>{payment.name}</span>
                  <span className="font-medium">
                    {formatMinorMoney(payment.amountMinor, currencyCode)}
                  </span>
                  {payment.tenderedMinor !== null ? (
                    <span className="col-span-2 text-xs text-muted-foreground">
                      Tendered {formatMinorMoney(payment.tenderedMinor, currencyCode)}
                      {payment.changeMinor ? ` · Change ${formatMinorMoney(payment.changeMinor, currencyCode)}` : ""}
                    </span>
                  ) : null}
                  {payment.referenceNumber ? (
                    <span className="col-span-2 text-xs text-muted-foreground">
                      Reference: {payment.referenceNumber}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {completedCheckout.inventoryWarning ? (
            <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{completedCheckout.inventoryWarning}</p>
            </div>
          ) : null}

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Button onClick={() => window.print()} type="button" variant="outline">
              <Printer aria-hidden="true" />
              Print receipt
            </Button>
            <Button onClick={onNewSale} type="button">
              <Plus aria-hidden="true" />
              New sale
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="payment-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex min-h-[100dvh] flex-col overflow-y-auto bg-background p-0 pb-[env(safe-area-inset-bottom)] sm:p-6"
      role="dialog"
    >
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-1 flex-col rounded-none border-y bg-card shadow-xl sm:rounded-2xl sm:border">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-primary">TINDIO payment</p>
            <h1 className="mt-1 text-xl font-semibold" id="payment-title">Payment</h1>
          </div>
          <Button disabled={isCheckoutPending} onClick={onCancel} size="icon" type="button" variant="ghost">
            <X aria-hidden="true" />
            <span className="sr-only">Return to cart</span>
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <div className="rounded-2xl bg-primary p-5 text-primary-foreground sm:p-6">
              <p className="text-sm font-medium text-primary-foreground/80">Total due</p>
              <p className="mt-2 text-4xl font-semibold tracking-[-0.05em]">
                {formatMinorMoney(totalMinor, currencyCode)}
              </p>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-primary-foreground/15 pt-4 text-sm">
                <span className="text-primary-foreground/75">Paid</span>
                <span className="col-span-2 text-right font-medium">
                  {formatMinorMoney(paidMinor, currencyCode)}
                </span>
                <span className="text-primary-foreground/75">Remaining</span>
                <span className="col-span-2 text-right font-semibold">
                  {formatMinorMoney(remainingMinor, currencyCode)}
                </span>
              </div>

              {!isOnline ? (
                <p className="mt-4 rounded-xl border border-primary-foreground/15 bg-primary-foreground/5 p-3 text-xs leading-5 text-primary-foreground/85">
                  You are offline. One cash payment without loyalty redemption or an open ticket can be queued safely and will sync when the POS reconnects.
                </p>
              ) : null}

            {customer ? (
              <div className="mt-4 rounded-xl border border-primary-foreground/15 bg-primary-foreground/5 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{customer.fullName}</span>
                  <span className="text-xs text-primary-foreground/75">
                    {customer.loyaltyPoints.toLocaleString()} points
                  </span>
                </div>
                {loyaltyProgram?.isEnabled ? (
                  <label className="mt-3 grid gap-1.5 text-xs font-medium text-primary-foreground/90" htmlFor="loyalty-points">
                    Redeem loyalty points
                    <Input
                      className="h-10 border-primary-foreground/20 bg-background text-foreground"
                      id="loyalty-points"
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setLoyaltyPointsInput(event.target.value)}
                      placeholder={`Min. ${loyaltyProgram.minimumRedemptionPoints.toLocaleString()} points`}
                      value={loyaltyPointsInput}
                    />
                  </label>
                ) : (
                  <p className="mt-3 text-xs text-primary-foreground/75">Loyalty redemption is disabled for this business.</p>
                )}
                {loyaltyProgram?.isEnabled ? (
                  <p className="mt-2 text-xs text-primary-foreground/75">
                    {loyaltyInputIsValid
                      ? requestedLoyaltyPoints && loyaltyRedemptionMinor > 0
                        ? `${requestedLoyaltyPoints.toLocaleString()} points will cover ${formatMinorMoney(loyaltyRedemptionMinor, currencyCode)}.`
                        : `Up to ${maximumLoyaltyPoints.toLocaleString()} points can be used on this sale.`
                      : `Use at least ${loyaltyProgram.minimumRedemptionPoints.toLocaleString()} points and no more than ${maximumLoyaltyPoints.toLocaleString()}.`}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-xs text-primary-foreground/75">Add a customer to this cart to earn or redeem loyalty points.</p>
            )}
          </div>

            {canApplyDiscounts && discounts.length > 0 ? (
              <section className="mt-5 rounded-xl border bg-muted/20 p-4" aria-labelledby="checkout-discount-title">
                <label className="grid gap-1.5 text-sm font-medium" htmlFor="checkout-discount">
                  <span id="checkout-discount-title">Discount</span>
                  <select
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    disabled={draftPayments.length > 0 || isCheckoutPending}
                    id="checkout-discount"
                    onChange={(event) => onDiscountChange(event.target.value || null)}
                    value={selectedDiscount?.id ?? ""}
                  >
                    <option value="">No discount</option>
                    {discounts.map((discount) => (
                      <option key={discount.id} value={discount.id}>{discount.name}</option>
                    ))}
                  </select>
                </label>
                {draftPayments.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Remove recorded payments before changing the discount.</p>
                ) : null}
              </section>
            ) : null}

            {cashMethod ? (
              <section className="mt-5 rounded-xl border bg-muted/20 p-4 sm:p-5" aria-labelledby="cash-payment-title">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold" id="cash-payment-title">Cash</p>
                    <p className="mt-1 text-xs text-muted-foreground">Enter the amount received, then apply the cash payment.</p>
                  </div>
                  <Button
                    className="h-11"
                    disabled={isCheckoutPending || remainingMinor === 0}
                    onClick={() => chooseMethod(cashMethod)}
                    size="sm"
                    type="button"
                    variant={activeMethod?.id === cashMethod.id ? "secondary" : "outline"}
                  >
                    <Banknote aria-hidden="true" />
                    {activeMethod?.id === cashMethod.id ? "Cash selected" : "Use cash"}
                  </Button>
                </div>
                <label className="mt-4 grid gap-1.5 text-sm font-medium" htmlFor="cash-tendered">
                  Amount tendered
                  <Input
                    className="h-11"
                    disabled={activeMethod?.id !== cashMethod.id || isCheckoutPending || remainingMinor === 0}
                    id="cash-tendered"
                    inputMode="decimal"
                    onChange={(event) => setCashTendered(event.target.value)}
                    value={activeMethod?.id === cashMethod.id ? cashTendered : ""}
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {cashSuggestions.map((suggestion) => (
                    <Button
                      className="h-10"
                      disabled={isCheckoutPending || remainingMinor === 0}
                      key={suggestion}
                      onClick={() => {
                        chooseMethod(cashMethod);
                        setCashTendered(minorToMoneyInput(suggestion));
                      }}
                      size="sm"
                      type="button"
                      variant={suggestion === remainingMinor ? "secondary" : "outline"}
                    >
                      {suggestion === remainingMinor ? "Exact " : ""}
                      {formatMinorMoney(suggestion, currencyCode)}
                    </Button>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Change</span>
                  <span className="font-semibold">
                    {activeMethod?.id !== cashMethod.id || activeCashTenderMinor === null
                      ? "Enter cash"
                      : activeCashTenderMinor >= remainingMinor
                        ? formatMinorMoney(activeCashTenderMinor - remainingMinor, currencyCode)
                        : `${formatMinorMoney(remainingMinor - activeCashTenderMinor, currencyCode)} remaining`}
                  </span>
                </div>
                <Button
                  className="mt-4 h-11 w-full"
                  disabled={isCheckoutPending || remainingMinor === 0 || activeMethod?.id !== cashMethod.id}
                  onClick={addPayment}
                  type="button"
                >
                  <Banknote aria-hidden="true" />
                  Apply cash payment
                </Button>
              </section>
            ) : null}

            {nonCashMethods.length > 0 ? (
              <section className="mt-5" aria-labelledby="other-payment-methods-title">
                <p className="text-sm font-semibold" id="other-payment-methods-title">Other payment methods</p>
                <div className="mt-3 divide-y overflow-hidden rounded-xl border bg-background">
                  {nonCashMethods.map((method) => {
                    const Icon = paymentIcon(method.type);
                    const isActive = activeMethod?.id === method.id;

                    return (
                      <button
                        aria-pressed={isActive}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/50",
                        )}
                        disabled={remainingMinor === 0 || isCheckoutPending}
                        key={method.id}
                        onClick={() => chooseMethod(method)}
                        type="button"
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{method.name}</span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {paymentMethods.length === 0 ? (
              <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                No payment methods are enabled for this store. Ask a settings manager to configure one.
              </p>
            ) : null}

            <Button
              className="mt-4 h-11 w-full"
              disabled={isCheckoutPending || remainingMinor === 0}
              onClick={() => {
                setIsSplitPayment(true);
                setMessage("Add each portion of the sale, then complete once the remaining balance is zero.");
              }}
              type="button"
              variant={isSplitPayment ? "secondary" : "outline"}
            >
              <Plus aria-hidden="true" />
              Split payment
            </Button>

            {activeMethod && activeMethod.type !== "CASH" ? (
              <div className="mt-5 rounded-xl border bg-muted/25 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{activeMethod.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Confirm this manual external payment after processing it outside TINDIO.</p>
                  </div>
                  <Button onClick={() => setActiveMethodId(null)} size="sm" type="button" variant="ghost">
                    Cancel
                  </Button>
                </div>

                <label className="mt-5 grid gap-1.5 text-sm font-medium" htmlFor="payment-amount">
                  Amount
                  <Input
                    autoFocus
                    id="payment-amount"
                    inputMode="decimal"
                    onChange={(event) => setAmount(event.target.value)}
                    value={amount}
                  />
                </label>

                <label className="mt-4 grid gap-1.5 text-sm font-medium" htmlFor="payment-reference">
                  Reference number {activeMethod.requiresReference ? "(required)" : "(optional)"}
                  <Input
                    id="payment-reference"
                    maxLength={120}
                    onChange={(event) => setReferenceNumber(event.target.value)}
                    value={referenceNumber}
                  />
                </label>
                <label className="mt-4 grid gap-1.5 text-sm font-medium" htmlFor="payment-note">
                  Note (optional)
                  <Input
                    id="payment-note"
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                    value={note}
                  />
                </label>
                <Button className="mt-5 h-11 w-full" onClick={addPayment} type="button">
                  <Plus aria-hidden="true" />
                  Add {activeMethod.name} payment
                </Button>
              </div>
            ) : null}
          </div>

          <aside className="rounded-xl border bg-muted/20 p-4 sm:p-5 lg:sticky lg:top-0 lg:self-start">
            <p className="text-sm font-semibold">{isSplitPayment ? "Split payment" : "Payment summary"}</p>
            <div className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="text-right font-medium">{formatMinorMoney(totalMinor, currencyCode)}</span>
              {loyaltyRedemptionMinor > 0 ? (
                <>
                  <span className="text-muted-foreground">Loyalty points</span>
                  <span className="text-right font-medium">{formatMinorMoney(loyaltyRedemptionMinor, currencyCode)}</span>
                </>
              ) : null}
              <span className="text-muted-foreground">Paid</span>
              <span className="text-right font-medium">{formatMinorMoney(paidMinor, currencyCode)}</span>
              <span className="text-muted-foreground">Remaining</span>
              <span className={cn("text-right font-semibold", remainingMinor === 0 && "text-primary")}>
                {formatMinorMoney(remainingMinor, currencyCode)}
              </span>
            </div>

            {draftPayments.length > 0 ? (
              <ul className="mt-5 divide-y border-y">
                {draftPayments.map((payment, index) => (
                  <li className="py-3" key={`${payment.method.id}-${index}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{payment.method.name}</p>
                        {payment.referenceNumber ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">Ref. {payment.referenceNumber}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-semibold">
                          {formatMinorMoney(payment.amountMinor, currencyCode)}
                        </span>
                        <Button
                          aria-label={`Remove ${payment.method.name} payment`}
                          onClick={() => removePayment(index)}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Minus aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    {payment.tenderedMinor !== null ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Tendered {formatMinorMoney(payment.tenderedMinor, currencyCode)}
                        {payment.changeMinor ? ` · Change ${formatMinorMoney(payment.changeMinor, currencyCode)}` : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                Choose a payment method to begin. Use Split payment when more than one method is needed.
              </p>
            )}

            {totalChangeMinor > 0 ? (
              <p className="mt-4 rounded-lg bg-background p-3 text-sm">
                Change due <span className="float-right font-semibold">{formatMinorMoney(totalChangeMinor, currencyCode)}</span>
              </p>
            ) : null}

            {message ? (
              <p aria-live="polite" className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
                {message}
              </p>
            ) : null}

            <Button
              className="mt-5 h-11 w-full"
              disabled={!canCompleteSale}
              onClick={completeSale}
              type="button"
            >
              {isCheckoutPending ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
              {isCheckoutPending ? "Completing sale…" : completionLabel}
            </Button>
            <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
              Payments, receipt, and tracked inventory changes are committed together.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
