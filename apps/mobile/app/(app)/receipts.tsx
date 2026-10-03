import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { PosReceiptSummary } from "../../../../src/contracts/pos";
import {
  saveReceiptSummaries,
  searchCachedReceiptSummaries,
} from "../../src/db/receipt-cache";
import { formatMoney } from "../../src/features/cashier/cashier-format";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { fetchPosV2Receipts } from "../../src/lib/tindio-api";

export default function Receipts() {
  const { data, mode } = useBusinessContext();

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PosReceiptSummary[]>([]);
  const [message, setMessage] = useState("");

  if (!data) return <Text>Receipt workspace unavailable.</Text>;

  const { core } = data;

  if (!core.permissions.includes("receipts.view")) {
    return <Text>Receipt access is not permitted.</Text>;
  }

  const load = async () => {
    try {
      if (mode === "online") {
        const result = await fetchPosV2Receipts(
          core.organization.id,
          { query },
        );

        setRows(result.receipts);
        await saveReceiptSummaries(core.organization.id, result);
        setMessage("SERVER RECEIPTS");
        return;
      }

      setRows(
        await searchCachedReceiptSummaries(
          core.organization.id,
          query,
        ),
      );
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
