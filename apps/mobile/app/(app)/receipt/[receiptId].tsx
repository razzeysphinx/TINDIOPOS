import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type {
  PosPaymentMethod,
  PosReceiptDetail,
} from "../../../../../src/contracts/pos";
import { formatMoney } from "../../../src/features/cashier/cashier-format";
import { useBusinessContext } from "../../../src/features/business/use-business-context";
import {
  deliverPosV2Receipt,
  fetchPosV2ReceiptDetail,
  fetchPosV2Reference,
  refundPosV2Receipt,
} from "../../../src/lib/tindio-api";

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

  if (!core) return <Text>Receipt workspace unavailable.</Text>;

  if (mode !== "online") {
    return <Text>Receipt detail, delivery, and refunds are online only.</Text>;
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
    if (!canDeliver || !recipient.trim()) return;

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
    }
  };

  const refund = async () => {
    if (
      !canRefund
      || !paymentMethodId
      || reason.trim().length < 2
      || selectedRefundItems.length === 0
    ) return;

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
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Receipt #{detail.receipt.number}</Text>
      <Text>{detail.sale.organizationName}</Text>
      <Text>{detail.sale.storeName} / {detail.sale.registerName}</Text>
      <Text>Cashier: {detail.sale.cashierName}</Text>
      <Text>{detail.receipt.issuedAt}</Text>

      <Text>ITEMS</Text>
      {detail.items.map((item) => {
        const refunded = refundedBySaleItem.get(item.id) ?? 0;
        const refundable = Math.max(0, Math.floor(item.quantity - refunded));

        return (
          <View key={item.id}>
            <Text>
              {item.name}
              {item.sku ? ` — ${item.sku}` : ""}
              {" — "}
              {item.quantity} {item.unit}
              {" — "}
              {formatMoney(item.lineTotalMinor, detail.sale.currencyCode)}
            </Text>

            {canRefund ? (
              <>
                <Text>Refundable whole quantity: {refundable}</Text>
                <TextInput
                  value={quantities[item.id] ?? "0"}
                  onChangeText={(value) =>
                    setQuantities((current) => ({
                      ...current,
                      [item.id]: value.replace(/[^\d]/g, ""),
                    }))
                  }
                  keyboardType="number-pad"
                  editable={refundable > 0}
                  placeholder="Refund qty"
                />
              </>
            ) : null}
          </View>
        );
      })}

      <Text>
        Subtotal {formatMoney(detail.sale.subtotalMinor, detail.sale.currencyCode)}
      </Text>
      <Text>
        Discount {formatMoney(detail.sale.discountMinor, detail.sale.currencyCode)}
      </Text>
      <Text>
        Tax {formatMoney(detail.sale.taxMinor, detail.sale.currencyCode)}
      </Text>
      <Text>
        Total {formatMoney(detail.sale.totalMinor, detail.sale.currencyCode)}
      </Text>

      <Text>PAYMENTS</Text>
      {detail.payments.map((payment) => (
        <Text key={payment.id}>
          {payment.name}
          {" — "}
          {formatMoney(payment.amountMinor, detail.sale.currencyCode)}
          {payment.tenderedMinor !== null
            ? ` — tendered ${formatMoney(payment.tenderedMinor, detail.sale.currencyCode)}`
            : ""}
          {payment.changeMinor !== null
            ? ` — change ${formatMoney(payment.changeMinor, detail.sale.currencyCode)}`
            : ""}
        </Text>
      ))}

      {detail.refunds.length ? (
        <>
          <Text>REFUNDS</Text>
          {detail.refunds.map((entry) => (
            <View key={entry.id}>
              <Text>
                Refund #{entry.number}
                {" — "}
                {formatMoney(entry.totalMinor, detail.sale.currencyCode)}
                {" — "}
                {entry.reason}
              </Text>
              {entry.items.map((item) => (
                <Text key={item.id}>
                  {item.name} — {item.quantity} {item.unit}
                </Text>
              ))}
            </View>
          ))}
        </>
      ) : null}

      {canDeliver ? (
        <>
          <Text>EMAIL RECEIPT</Text>
          <TextInput
            value={recipient}
            onChangeText={setRecipient}
            placeholder="Email recipient"
            keyboardType="email-address"
          />
          <Pressable disabled={!recipient.trim()} onPress={() => void delivery()}>
            <Text>Email receipt</Text>
          </Pressable>
        </>
      ) : null}

      {canRefund ? (
        <>
          <Text>REFUND — ONLINE ONLY</Text>

          {paymentMethods.map((method) => (
            <Pressable
              key={method.id}
              onPress={() => setPaymentMethodId(method.id)}
            >
              <Text>
                {paymentMethodId === method.id ? "✓ " : ""}
                {method.name}
                {method.requiresReference ? " — reference required" : ""}
              </Text>
            </Pressable>
          ))}

          <TextInput
            value={referenceNumber}
            onChangeText={setReferenceNumber}
            placeholder="Refund reference"
            maxLength={120}
          />

          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Refund reason"
            maxLength={500}
          />

          <Pressable onPress={() => setReturnToStock((current) => !current)}>
            <Text>{returnToStock ? "✓ " : ""}Return eligible items to stock</Text>
          </Pressable>

          <Pressable
            disabled={
              !paymentMethodId
              || reason.trim().length < 2
              || selectedRefundItems.length === 0
            }
            onPress={() => void refund()}
          >
            <Text>Submit selected refund</Text>
          </Pressable>
        </>
      ) : null}

      <Text>{message}</Text>
    </ScrollView>
  );
}
