import { router } from "expo-router";
import { useState } from "react";
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
  const [rows, setRows] = useState<PosReceiptSummary[]>([]);
  const [localRows, setLocalRows] = useState<LocalReceipt[]>([]);
  const [message, setMessage] = useState("");

  if (!data) return <Text>Receipt workspace unavailable.</Text>;

  const { core } = data;

  if (!core.permissions.includes("receipts.view")) {
    return <Text>Receipt access is not permitted.</Text>;
  }

  const load = async () => {
    try {
      const localPromise = searchLocalReceipts(core.organization.id, core.storeIds, query);
      if (mode === "online") {
        const [result, local] = await Promise.all([
          fetchPosV2Receipts(core.organization.id, { query }),
          localPromise,
        ]);

        setRows(result.receipts);
        setLocalRows(local);
        await saveReceiptSummaries(core.organization.id, result);
        setMessage("SERVER RECEIPTS");
        return;
      }

      setRows(
        await searchCachedReceiptSummaries(
          core.organization.id,
          core.storeIds,
          query,
        ),
      );
      setLocalRows(await localPromise);
      setMessage("CACHED RECEIPT SUMMARIES — READ ONLY");
    } catch {
      setMessage("Receipt history is unavailable.");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Receipts</Text>
      <Text>
        {mode === "offline"
          ? "LOCAL RECEIPT SUMMARIES ONLY"
          : "SERVER RECEIPT HISTORY"}
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Receipt number, cashier, store"
      />

      <Pressable onPress={() => void load()}>
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

      <Text>{message}</Text>
    </ScrollView>
  );
}
