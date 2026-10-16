import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

import type { PosReceiptSummary } from "../../../../src/contracts/pos";
import { saveReceiptSummaries, searchCachedReceiptSummaries } from "../../src/db/receipt-cache";
import { searchLocalReceipts, type LocalReceipt } from "../../src/db/local-receipts";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { formatMoney } from "../../src/features/cashier/cashier-format";
import { fetchPosV2Receipts } from "../../src/lib/tindio-api";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioListItem, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

export default function Receipts() {
  const { data, mode } = useBusinessContext();
  const [query, setQuery] = useState("");
  const queryRef = useRef("");
  const [rows, setRows] = useState<PosReceiptSummary[]>([]);
  const [localRows, setLocalRows] = useState<LocalReceipt[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (searchQuery: string) => {
    if (!data || !data.core.permissions.includes("receipts.view")) return;
    const { core } = data;
    setLoading(true);
    try {
      const localPromise = searchLocalReceipts(core.organization.id, core.storeIds, searchQuery);
      if (mode === "online") {
        const serverPromise = fetchPosV2Receipts(core.organization.id, { query: searchQuery }).then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        const local = await localPromise;
        setLocalRows(local);
        const server = await serverPromise;
        if (!server.ok) throw server.error;
        setRows(server.result.receipts);
        await saveReceiptSummaries(core.organization.id, server.result);
        setMessage("Official receipt history is up to date.");
        return;
      }
      setLocalRows(await localPromise);
      setRows(await searchCachedReceiptSummaries(core.organization.id, core.storeIds, searchQuery));
      setMessage("Showing receipt information saved on this device.");
    } catch {
      setMessage("Receipt history is unavailable. Saved device records remain available below.");
    } finally {
      setLoading(false);
    }
  }, [data, mode]);

  useFocusEffect(useCallback(() => {
    void load(queryRef.current);
  }, [load]));

  if (!data) return <TindioScreen><TindioFeedback description="Select an authorized business before viewing receipts." kind="restriction" title="Receipt workspace unavailable" /></TindioScreen>;
  if (!data.core.permissions.includes("receipts.view")) return <TindioScreen><TindioFeedback description="Your current role does not include receipt access." kind="restriction" title="Receipt access is not permitted" /></TindioScreen>;

  return (
    <TindioScreen contentContainerStyle={{ paddingBottom: 48 }} scroll testID="receipts-scroll">
      <TindioWorkspaceHeader
        description="Search official receipts and durable sale records saved on this device."
        eyebrow="RECEIPTS"
        title="Receipt history"
        trailing={<TindioStatusBadge label={mode === "online" ? "Official history available" : "Saved device records"} tone={mode === "online" ? "success" : "warning"} />}
      />

      {mode !== "online" ? <TindioFeedback description="Official detail, delivery, and refunds require connectivity. Durable device records remain available." kind="restriction" title="Offline receipt access" /> : null}

      <TindioCard>
        <TindioInput
          accessibilityLabel="Receipt search"
          label="Search"
          onChangeText={(value) => { queryRef.current = value; setQuery(value); }}
          placeholder="Receipt number, cashier, store"
          value={query}
        />
        <TindioButton busy={loading} onPress={() => void load(query)} testID="search-receipts">Search receipts</TindioButton>
      </TindioCard>

      <TindioWorkspaceSection description="These immutable records remain visible before and after synchronization." title="Saved on this device">
        {localRows.length ? localRows.map((row) => (
          <TindioListItem
            detail={row.snapshot.version === 2 ? row.snapshot.storeName : "Saved device sale"}
            key={row.eventId}
            meta={formatMoney(row.snapshot.totalMinor, row.snapshot.currencyCode)}
            onPress={() => router.push(`/local-receipt/${row.eventId}` as never)}
            title={row.officialReceiptNumber === null ? `Provisional ${row.localReference}` : `Receipt #${row.officialReceiptNumber}`}
          />
        )) : <TindioFeedback description="No matching durable sale records are saved on this device." kind="empty" title="No saved records" />}
      </TindioWorkspaceSection>

      <TindioWorkspaceSection description="Official receipt detail is available while connected." title="Official receipts">
        {rows.length ? rows.map((row) => (
          <TindioListItem
            detail={`${row.store_name} / ${row.cashier_name}${row.refund_count ? ` / ${row.refund_count} refund${row.refund_count === 1 ? "" : "s"}` : ""}`}
            disabled={mode !== "online"}
            key={row.receipt_id}
            meta={formatMoney(row.total_minor, row.currency_code)}
            onPress={() => router.push(`/receipt/${row.receipt_id}` as never)}
            title={`Receipt #${row.receipt_number}`}
          />
        )) : <TindioFeedback description="No official receipts match this search." kind="empty" title="No official receipts" />}
      </TindioWorkspaceSection>

      {message ? <TindioFeedback description={message} kind="review" title="Receipt update" /> : null}
    </TindioScreen>
  );
}
