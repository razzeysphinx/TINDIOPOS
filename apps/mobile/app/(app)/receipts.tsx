import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { PosReceiptSummary } from "../../../../src/contracts/pos";
import {
  saveReceiptSummaries,
  searchCachedReceiptSummaries,
} from "../../src/db/receipt-cache";
import { searchLocalReceipts, type LocalReceipt } from "../../src/db/local-receipts";
import { formatMoney } from "../../src/features/cashier/cashier-format";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { fetchPosV2Receipts } from "../../src/lib/tindio-api";

export default function Receipts() {
  const { data, mode } = useBusinessContext();

  const [query, setQuery] = useState("");
  const queryRef = useRef("");
  const [rows, setRows] = useState<PosReceiptSummary[]>([]);
  const [localRows, setLocalRows] = useState<LocalReceipt[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async (searchQuery: string) => {
    if (!data || !data.core.permissions.includes("receipts.view")) return;
    const { core } = data;
    try {
      const localPromise = searchLocalReceipts(core.organization.id, core.storeIds, searchQuery);
      if (mode === "online") {
        const serverPromise = fetchPosV2Receipts(
          core.organization.id,
          { query: searchQuery },
        ).then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        const local = await localPromise;
        setLocalRows(local);
        const server = await serverPromise;
        if (!server.ok) throw server.error;
        const { result } = server;

        setRows(result.receipts);
        await saveReceiptSummaries(core.organization.id, result);
        setMessage("SERVER RECEIPTS");
        return;
      }

      const local = await localPromise;
      setLocalRows(local);
      setRows(
        await searchCachedReceiptSummaries(
          core.organization.id,
          core.storeIds,
          searchQuery,
        ),
      );
      setMessage("CACHED RECEIPT SUMMARIES — READ ONLY");
    } catch {
      setMessage("Receipt history is unavailable.");
    }
  }, [data, mode]);

  useFocusEffect(useCallback(() => {
    void load(queryRef.current);
  }, [load]));

  if (!data) return <Text>Receipt workspace unavailable.</Text>;

  const { core } = data;

  if (!core.permissions.includes("receipts.view")) {
    return <Text>Receipt access is not permitted.</Text>;
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 12 }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      testID="receipts-scroll"
    >
      <Text>Receipts</Text>
      <Text>
        {mode === "offline"
          ? "LOCAL RECEIPT SUMMARIES ONLY"
          : "SERVER RECEIPT HISTORY"}
      </Text>

      <TextInput
        accessibilityLabel="Receipt search"
        value={query}
        onChangeText={(value) => {
          queryRef.current = value;
          setQuery(value);
        }}
        placeholder="Receipt number, cashier, store"
      />

      <Pressable accessibilityRole="button" testID="search-receipts" onPress={() => void load(query)}>
        <Text>Search receipts</Text>
      </Pressable>

      <Text>Saved device sale records</Text>
      {localRows.map((row) => (
        <Pressable
          key={row.eventId}
          accessibilityRole="button"
          onPress={() => router.push(`/local-receipt/${row.eventId}` as never)}
        >
          <Text>
            {row.officialReceiptNumber === null
              ? `Provisional ${row.localReference}`
              : `Receipt #${row.officialReceiptNumber}`}
            {" — "}
            {formatMoney(row.snapshot.totalMinor, row.snapshot.currencyCode)}
            {" — "}
            {row.snapshot.version === 2 ? row.snapshot.storeName : "Saved device sale"}
          </Text>
        </Pressable>
      ))}

      <Text>Server receipt history</Text>
      {rows.map((row) => (
        <Pressable
          key={row.receipt_id}
          disabled={mode !== "online"}
          onPress={() => router.push(`/receipt/${row.receipt_id}` as never)}
        >
          <Text>
            Receipt #{row.receipt_number}
            {" — "}
            {formatMoney(row.total_minor, row.currency_code)}
            {" — "}
            {row.store_name}
            {" — "}
            {row.cashier_name}
            {row.refund_count ? ` — refunds ${row.refund_count}` : ""}
          </Text>
        </Pressable>
      ))}

      {mode === "offline" ? (
        <Text>Receipt detail/refund/delivery requires connectivity.</Text>
      ) : null}

      <Text accessibilityLiveRegion="polite">{message}</Text>
    </ScrollView>
  );
}
