import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type {
  PosPaymentMethod,
  PosReceiptDetail,
} from "@tindio/contracts";
import { CashierReceiptSummary } from "../../../src/features/cashier/cashier-receipt-summary";
import { formatMoney } from "../../../src/features/cashier/cashier-format";
import { useBusinessContext } from "../../../src/features/business/use-business-context";
import {
  deliverPosV2Receipt,
  fetchPosV2ReceiptDetail,
  fetchPosV2Reference,
  refundPosV2Receipt,
} from "../../../src/lib/tindio-api";
import { TindioButton } from "../../../src/ui/tindio-button";
import { TindioCard } from "../../../src/ui/tindio-card";
import { TindioFeedback } from "../../../src/ui/tindio-feedback";
import { TindioInput } from "../../../src/ui/tindio-input";
import { TindioScreen } from "../../../src/ui/tindio-screen";
import { TindioListItem, TindioWorkspaceSection } from "../../../src/ui/tindio-workspace";

export default function ReceiptDetailScreen() {
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const { data, mode } = useBusinessContext();

  const [detail, setDetail] = useState<PosReceiptDetail | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PosPaymentMethod[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [returnToStock, setReturnToStock] = useState(false);
  const [refundKey, setRefundKey] = useState(() => Crypto.randomUUID());
  const [deliveryKey, setDeliveryKey] = useState(() => Crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [deliveryPending, setDeliveryPending] = useState(false);
  const [refundPending, setRefundPending] = useState(false);

  const core = data?.core;
  const canRefund = Boolean(core?.permissions.includes("sales.refund"));
  const canDeliver = Boolean(core?.permissions.includes("receipts.reprint"));

  useEffect(() => {
    if (!core || mode !== "online" || !receiptId) return;

    let active = true;

    void Promise.all([
      fetchPosV2ReceiptDetail(core.organization.id, receiptId),
      fetchPosV2Reference(core.organization.id),
    ]).then(([nextDetail, reference]) => {
      if (!active) return;

      setDetail(nextDetail);
      setRecipient(nextDetail.customerEmail ?? "");

      const methods = reference.reference.paymentMethods.filter(
        (method) => method.storeId === nextDetail.sale.storeId,
      );

      setPaymentMethods(methods);
      setPaymentMethodId(methods[0]?.id ?? "");
      setQuantities(
        Object.fromEntries(
          nextDetail.items.map((item) => [item.id, "0"]),
        ),
      );
    }).catch(() => {
      if (active) setMessage("Receipt unavailable.");
    });

    return () => {
      active = false;
    };
  }, [core, mode, receiptId]);

  const refundedBySaleItem = useMemo(() => {
    const map = new Map<string, number>();

    for (const refund of detail?.refunds ?? []) {
      for (const item of refund.items) {
        map.set(
          item.saleItemId,
          (map.get(item.saleItemId) ?? 0) + item.quantity,
        );
      }
    }

    return map;
  }, [detail]);

  const selectedRefundItems = useMemo(
    () =>
      (detail?.items ?? []).flatMap((item) => {
        const remaining = Math.max(
          0,
          Math.floor(item.quantity - (refundedBySaleItem.get(item.id) ?? 0)),
        );
        const requested = Number(quantities[item.id] ?? 0);

        if (!Number.isInteger(requested) || requested <= 0 || requested > remaining) {
          return [];
        }

        return [{
          saleItemId: item.id,
          quantity: requested,
          returnToStock,
        }];
      }),
    [detail, quantities, refundedBySaleItem, returnToStock],
  );

  if (!core) return <TindioScreen><TindioFeedback description="Select an authorized business before viewing this receipt." kind="restriction" title="Receipt workspace unavailable" /></TindioScreen>;

  if (mode !== "online") {
    return <TindioScreen><TindioFeedback description="Official receipt detail, delivery, and refunds require connectivity. Saved device records remain available in receipt history." kind="restriction" title="Official receipt is online only" /></TindioScreen>;
  }

  if (!detail) {
    return (
      <View>
        <Text>Loading receipt…</Text>
        <Text>{message}</Text>
      </View>
    );
  }

  const delivery = async () => {
    if (deliveryPending || !canDeliver || !recipient.trim()) return;

    setDeliveryPending(true);
    try {
      const result = await deliverPosV2Receipt(
        core.organization.id,
        receiptId,
        {
          receiptId,
          recipient: recipient.trim(),
          idempotencyKey: deliveryKey,
        },
      );

      setMessage(result.message);

      if (result.ok) {
        setDeliveryKey(Crypto.randomUUID());
      }
    } catch {
      setMessage(
        "Receipt delivery status is unknown. Retry this unchanged request to reuse the same operation identity.",
      );
    } finally {
      setDeliveryPending(false);
    }
  };

  const refund = async () => {
    if (
      refundPending
      || !canRefund
      || !paymentMethodId
      || reason.trim().length < 2
      || selectedRefundItems.length === 0
    ) return;

    setRefundPending(true);
    try {
      const result = await refundPosV2Receipt(
        core.organization.id,
        receiptId,
        {
          receiptId,
          paymentMethodId,
          idempotencyKey: refundKey,
          reason: reason.trim(),
          referenceNumber: referenceNumber.trim(),
          items: selectedRefundItems,
        },
      );

      setMessage(result.message);

      if (result.ok) {
        setRefundKey(Crypto.randomUUID());
        const refreshed = await fetchPosV2ReceiptDetail(
          core.organization.id,
          receiptId,
        );
        setDetail(refreshed);
        setQuantities(
          Object.fromEntries(refreshed.items.map((item) => [item.id, "0"])),
        );
      }
    } catch {
      setMessage(
        "Refund status is unknown. Do not create a new refund key. Retry this exact refund or verify the receipt first.",
      );
    } finally {
      setRefundPending(false);
    }
  };

  return (
    <TindioScreen scroll testID="official-receipt-workspace">
      <CashierReceiptSummary
        cashierName={detail.sale.cashierName}
        currencyCode={detail.sale.currencyCode}
        discountMinor={detail.sale.discountMinor}
        issuedAt={detail.receipt.issuedAt}
        lines={detail.items.map((item) => ({
          detail: item.sku,
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          totalMinor: item.lineTotalMinor,
          unit: item.unit,
        }))}
        organizationName={detail.sale.organizationName}
        payments={detail.payments.map((payment) => ({
          amountMinor: payment.amountMinor,
          changeMinor: payment.changeMinor,
          id: payment.id,
          name: payment.name,
          tenderedMinor: payment.tenderedMinor,
        }))}
        reference={String(detail.receipt.number)}
        registerName={detail.sale.registerName}
        status="official"
        storeName={detail.sale.storeName}
        subtotalMinor={detail.sale.subtotalMinor}
        taxMinor={detail.sale.taxMinor}
        totalMinor={detail.sale.totalMinor}
      />

      {canRefund ? (
        <TindioWorkspaceSection description="Only whole, remaining quantities can be refunded." title="Refundable items">
          {detail.items.map((item) => {
            const refunded = refundedBySaleItem.get(item.id) ?? 0;
            const refundable = Math.max(0, Math.floor(item.quantity - refunded));
            return (
              <TindioCard description={`Purchased ${item.quantity} ${item.unit} / refundable ${refundable}`} key={item.id} title={item.name}>
                <TindioInput accessibilityLabel={`Refund quantity for ${item.name}`} editable={refundable > 0} keyboardType="number-pad" label="Refund quantity" onChangeText={(value) => setQuantities((current) => ({ ...current, [item.id]: value.replace(/[^\d]/g, "") }))} placeholder="0" value={quantities[item.id] ?? "0"} />
              </TindioCard>
            );
          })}
        </TindioWorkspaceSection>
      ) : null}

      {detail.refunds.length ? (
        <TindioWorkspaceSection title="Refund history">
          {detail.refunds.map((entry) => (
            <TindioCard description={entry.reason} key={entry.id} title={`Refund #${entry.number} / ${formatMoney(entry.totalMinor, detail.sale.currencyCode)}`}>
              {entry.items.map((item) => <Text key={item.id}>{item.name} / {item.quantity} {item.unit}</Text>)}
            </TindioCard>
          ))}
        </TindioWorkspaceSection>
      ) : null}

      {canDeliver ? (
        <TindioCard description="Delivery uses a stable operation identity when an outcome is unknown." title="Email receipt">
          <TindioInput keyboardType="email-address" label="Recipient" onChangeText={setRecipient} placeholder="Email recipient" value={recipient} />
          <TindioButton busy={deliveryPending} disabled={!recipient.trim()} onPress={() => void delivery()}>Email receipt</TindioButton>
        </TindioCard>
      ) : null}

      {canRefund ? (
        <TindioCard description="Refunds are online only. An unknown result must be retried unchanged with the original identity." title="Submit refund">
          {paymentMethods.map((method) => (
            <TindioListItem
              detail={method.requiresReference ? "Reference required" : undefined}
              key={method.id}
              onPress={() => setPaymentMethodId(method.id)}
              selected={paymentMethodId === method.id}
              title={method.name}
            />
          ))}
          <TindioInput label="Refund reference" maxLength={120} onChangeText={setReferenceNumber} placeholder="Reference" value={referenceNumber} />
          <TindioInput label="Refund reason" maxLength={500} onChangeText={setReason} placeholder="Required reason" value={reason} />
          <TindioListItem onPress={() => setReturnToStock((current) => !current)} selected={returnToStock} title="Return eligible items to stock" />
          <TindioButton
            busy={refundPending}
            disabled={
              !paymentMethodId
              || reason.trim().length < 2
              || selectedRefundItems.length === 0
            }
            onPress={() => void refund()}
            variant="destructive"
          >
            Submit selected refund
          </TindioButton>
        </TindioCard>
      ) : null}

      {message ? <TindioFeedback description={message} kind="review" title="Receipt update" /> : null}
    </TindioScreen>
  );
}
