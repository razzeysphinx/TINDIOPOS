import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getLocalReceipt,
  listReceiptCopyJobs,
  prepareReceiptCopy,
  type LocalReceipt,
  type ReceiptCopyJob,
} from "../../../src/db/local-receipts";
import { CashierReceiptSummary } from "../../../src/features/cashier/cashier-receipt-summary";
import { useBusinessContext } from "../../../src/features/business/use-business-context";
import { TindioButton } from "../../../src/ui/tindio-button";
import { TindioFeedback } from "../../../src/ui/tindio-feedback";
import { TindioScreen } from "../../../src/ui/tindio-screen";
import { tindioTheme } from "../../../src/ui/theme";

export default function LocalReceiptDetail() {
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const { data } = useBusinessContext();
  const [receipt, setReceipt] = useState<LocalReceipt | null>(null);
  const [copies, setCopies] = useState<ReceiptCopyJob[]>([]);
  const [message, setMessage] = useState("Loading saved receipt...");
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

  if (!data) {
    return (
      <TindioScreen>
        <TindioFeedback description="Select an authorized business before viewing this record." kind="restriction" title="Receipt workspace unavailable" />
      </TindioScreen>
    );
  }

  if (!mayView) {
    return (
      <TindioScreen>
        <TindioFeedback description="Your current role does not include receipt access." kind="restriction" title="Receipt access is not permitted" />
      </TindioScreen>
    );
  }

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

  const snapshot = receipt?.snapshot;
  const modernSnapshot = snapshot?.version === 2 ? snapshot : null;

  return (
    <TindioScreen scroll testID="local-receipt-result">
      {receipt && snapshot ? (
        <>
          <CashierReceiptSummary
            cashierName={modernSnapshot?.employeeName}
            currencyCode={snapshot.currencyCode}
            discountMinor={snapshot.discountMinor}
            issuedAt={receipt.createdAt}
            lines={(modernSnapshot?.lines ?? []).map((line) => ({
              detail: line.variantName,
              id: line.lineNumber,
              name: line.productName,
              quantity: line.quantity,
              totalMinor: line.lineTotalMinor,
              unit: line.unit,
            }))}
            organizationName={modernSnapshot?.organizationName}
            payments={[{
              amountMinor: snapshot.totalMinor,
              changeMinor: snapshot.changeMinor,
              id: modernSnapshot?.payment.methodId ?? "cash",
              name: modernSnapshot?.payment.methodName ?? "Cash",
              tenderedMinor: snapshot.tenderedMinor,
            }]}
            reference={receipt.officialReceiptNumber === null ? receipt.localReference : String(receipt.officialReceiptNumber)}
            registerName={modernSnapshot?.registerName}
            status={receipt.officialReceiptNumber === null ? "provisional" : "official"}
            storeName={modernSnapshot?.storeName}
            subtotalMinor={snapshot.subtotalMinor}
            taxMinor={snapshot.taxMinor}
            totalMinor={snapshot.totalMinor}
          />

          {modernSnapshot === null ? (
            <TindioFeedback
              description="Item detail was not captured by the older app version that saved this sale. The stored totals remain the durable record."
              kind="review"
              title="Legacy saved sale"
            />
          ) : null}

          {data.core.permissions.includes("receipts.reprint") ? (
            <TindioButton onPress={() => void prepareCopy()} variant="secondary">
              Prepare duplicate copy
            </TindioButton>
          ) : null}

          <View style={styles.copySection}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Copy history</Text>
            {copies.length ? copies.map((copy) => (
              <View key={copy.jobId} style={styles.copyCard}>
                <Text style={styles.copyTitle}>Duplicate copy {copy.copyNumber}</Text>
                <Text style={styles.copyMeta}>{copy.documentKind} / {copy.state}</Text>
              </View>
            )) : (
              <Text style={styles.emptyCopy}>No duplicate copies prepared.</Text>
            )}
          </View>
        </>
      ) : null}

      {message ? (
        <TindioFeedback
          description={message}
          kind={message.startsWith("Loading") ? "loading" : "review"}
          title={message.startsWith("Loading") ? "Loading receipt" : "Receipt update"}
        />
      ) : null}
    </TindioScreen>
  );
}

const styles = StyleSheet.create({
  copySection: { gap: tindioTheme.space.sm },
  sectionTitle: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  copyCard: { backgroundColor: tindioTheme.color.surface.card, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.md, borderWidth: 1, gap: tindioTheme.space.xxs, padding: tindioTheme.space.md },
  copyTitle: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  copyMeta: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  emptyCopy: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
});
