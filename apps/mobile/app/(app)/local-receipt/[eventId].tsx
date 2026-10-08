import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import {
  getLocalReceipt,
  listReceiptCopyJobs,
  prepareReceiptCopy,
  type LocalReceipt,
  type ReceiptCopyJob,
} from "../../../src/db/local-receipts";
import { formatMoney } from "../../../src/features/cashier/cashier-format";
import { useBusinessContext } from "../../../src/features/business/use-business-context";

export default function LocalReceiptDetail() {
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const { data } = useBusinessContext();
  const [receipt, setReceipt] = useState<LocalReceipt | null>(null);
  const [copies, setCopies] = useState<ReceiptCopyJob[]>([]);
  const [message, setMessage] = useState("Loading saved receipt…");
  const eventId = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  const organizationId = data?.core.organization.id;
  const storeIds = data?.core.storeIds;
  const mayView = data?.core.permissions.includes("receipts.view") ?? false;

  useEffect(() => {
    let active = true;
    if (!organizationId || !storeIds || !eventId || !mayView) return () => { active = false; };
    void Promise.all([
      getLocalReceipt(organizationId, storeIds, eventId),
      listReceiptCopyJobs(organizationId, storeIds, eventId),
    ]).then(([nextReceipt, nextCopies]) => {
      if (!active) return;
      setReceipt(nextReceipt);
      setCopies(nextReceipt ? nextCopies : []);
      setMessage(nextReceipt ? "" : "Saved receipt not found or no longer authorized.");
    }).catch(() => {
      if (active) setMessage("Saved receipt could not be read.");
    });
    return () => { active = false; };
  }, [eventId, mayView, organizationId, storeIds]);

  if (!data) return <Text>Receipt workspace unavailable.</Text>;
  if (!mayView) return <Text>Receipt access is not permitted.</Text>;

  const prepareCopy = async () => {
    if (!receipt || !data.core.permissions.includes("receipts.reprint")) return;
    try {
      const job = await prepareReceiptCopy({
        jobId: Crypto.randomUUID(),
        organizationId: data.core.organization.id,
        authorizedStoreIds: data.core.storeIds,
        eventId: receipt.eventId,
        requestedByProfileId: data.core.profileId,
        requestedByEmployeeId: data.core.employee.id,
        createdAt: new Date().toISOString(),
      });
      if (!job) {
        setMessage("Copy could not be prepared for this store.");
        return;
      }
      setCopies((current) => [job, ...current]);
      setMessage(`Duplicate copy ${job.copyNumber} prepared. No physical printer adapter is configured.`);
    } catch {
      setMessage("Copy history could not be saved.");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
      <Text>Saved receipt</Text>
      {receipt ? (
        <>
          <Text>
            {receipt.officialReceiptNumber === null
              ? "PROVISIONAL SALE RECORD — NOT AN OFFICIAL RECEIPT"
              : `OFFICIAL RECEIPT #${receipt.officialReceiptNumber}`}
          </Text>
          <Text>{receipt.localReference}</Text>
          <Text>{new Date(receipt.createdAt).toLocaleString()}</Text>
          {receipt.snapshot.version === 2 ? (
            <>
              <Text>{receipt.snapshot.organizationName}</Text>
              <Text>{receipt.snapshot.storeName} — {receipt.snapshot.registerName}</Text>
              <Text>Cashier: {receipt.snapshot.employeeName}</Text>
              {receipt.snapshot.lines.map((line) => (
                <Text key={line.lineNumber}>
                  {line.quantity} {line.unit} × {line.productName}
                  {line.variantName ? ` — ${line.variantName}` : ""}
                  {" — "}{formatMoney(line.lineTotalMinor, receipt.snapshot.currencyCode)}
                </Text>
              ))}
            </>
          ) : (
            <Text>Legacy saved sale: item detail was not captured by this older app version.</Text>
          )}
          <Text>Subtotal: {formatMoney(receipt.snapshot.subtotalMinor, receipt.snapshot.currencyCode)}</Text>
          <Text>Discount: {formatMoney(receipt.snapshot.discountMinor, receipt.snapshot.currencyCode)}</Text>
          <Text>Tax: {formatMoney(receipt.snapshot.taxMinor, receipt.snapshot.currencyCode)}</Text>
          <Text>Total: {formatMoney(receipt.snapshot.totalMinor, receipt.snapshot.currencyCode)}</Text>
          <Text>Tendered: {formatMoney(receipt.snapshot.tenderedMinor, receipt.snapshot.currencyCode)}</Text>
          <Text>Change: {formatMoney(receipt.snapshot.changeMinor, receipt.snapshot.currencyCode)}</Text>
          {data.core.permissions.includes("receipts.reprint") ? (
            <Pressable accessibilityRole="button" onPress={() => void prepareCopy()}>
              <Text>Prepare duplicate copy</Text>
            </Pressable>
          ) : null}
          <Text>Copy history</Text>
          {copies.map((copy) => (
            <Text key={copy.jobId}>
              DUPLICATE COPY {copy.copyNumber} — {copy.documentKind} — {copy.state}
            </Text>
          ))}
        </>
      ) : null}
      <Text>{message}</Text>
    </ScrollView>
  );
}
