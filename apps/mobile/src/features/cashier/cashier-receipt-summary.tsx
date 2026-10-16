import { StyleSheet, Text, View } from "react-native";

import { tindioTheme } from "../../ui/theme";
import { formatMoney } from "./cashier-format";

export type CashierReceiptLine = {
  id: string | number;
  name: string;
  detail?: string | null;
  quantity: number;
  unit: string;
  totalMinor: number;
};

export type CashierReceiptPayment = {
  id: string;
  name: string;
  amountMinor: number;
  tenderedMinor?: number | null;
  changeMinor?: number | null;
};

type CashierReceiptSummaryProps = {
  status: "official" | "provisional";
  reference: string;
  issuedAt: string;
  organizationName?: string;
  storeName?: string;
  registerName?: string;
  cashierName?: string;
  currencyCode: string;
  lines: CashierReceiptLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  payments: CashierReceiptPayment[];
};

export function CashierReceiptSummary({
  status,
  reference,
  issuedAt,
  organizationName,
  storeName,
  registerName,
  cashierName,
  currencyCode,
  lines,
  subtotalMinor,
  discountMinor,
  taxMinor,
  totalMinor,
  payments,
}: CashierReceiptSummaryProps) {
  const official = status === "official";

  return (
    <View style={styles.receipt} testID="cashier-receipt-summary">
      <View style={styles.header}>
        <Text style={styles.brand}>{organizationName ?? "TINDIO POS"}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {official ? `Official receipt #${reference}` : "Provisional sale record"}
        </Text>
        {!official ? <Text style={styles.provisionalReference}>{reference}</Text> : null}
        <Text style={styles.meta}>{formatReceiptDate(issuedAt)}</Text>
        {storeName ? <Text style={styles.meta}>{storeName}{registerName ? ` / ${registerName}` : ""}</Text> : null}
        {cashierName ? <Text style={styles.meta}>Cashier: {cashierName}</Text> : null}
      </View>

      {!official ? (
        <View style={styles.provisionalNotice}>
          <Text style={styles.provisionalTitle}>Saved on this device</Text>
          <Text style={styles.provisionalText}>
            This is durable sale evidence, not an official receipt. The official receipt number is added after synchronization.
          </Text>
        </View>
      ) : null}

      {lines.length ? (
        <View style={styles.lines}>
          <Text style={styles.sectionLabel}>Items</Text>
          {lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <View style={styles.lineCopy}>
                <Text style={styles.lineName}>{line.name}</Text>
                <Text style={styles.lineDetail}>
                  {formatQuantity(line.quantity)} {line.unit}{line.detail ? ` / ${line.detail}` : ""}
                </Text>
              </View>
              <Text style={styles.lineAmount}>{formatMoney(line.totalMinor, currencyCode)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View accessibilityLabel="Receipt totals" style={styles.totals}>
        <ReceiptRow label="Subtotal" value={formatMoney(subtotalMinor, currencyCode)} />
        <ReceiptRow label="Discount" value={`-${formatMoney(discountMinor, currencyCode)}`} />
        <ReceiptRow label="Tax" value={formatMoney(taxMinor, currencyCode)} />
        <View style={styles.divider} />
        <ReceiptRow emphasis label="Total" value={formatMoney(totalMinor, currencyCode)} />
      </View>

      {payments.length ? (
        <View style={styles.payment}>
          <Text style={styles.sectionLabel}>Payment</Text>
          {payments.map((payment) => (
            <View key={payment.id} style={styles.paymentEntry}>
              <ReceiptRow label={payment.name} value={formatMoney(payment.amountMinor, currencyCode)} />
              {payment.tenderedMinor !== undefined && payment.tenderedMinor !== null
                ? <ReceiptRow label="Cash received" value={formatMoney(payment.tenderedMinor, currencyCode)} />
                : null}
              {payment.changeMinor !== undefined && payment.changeMinor !== null
                ? <ReceiptRow emphasis label="Change" value={formatMoney(payment.changeMinor, currencyCode)} />
                : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ReceiptRow({ emphasis = false, label, value }: { emphasis?: boolean; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={emphasis ? styles.rowEmphasis : styles.rowLabel}>{label}</Text>
      <Text style={emphasis ? styles.rowEmphasis : styles.rowValue}>{value}</Text>
    </View>
  );
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatReceiptDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  receipt: { ...tindioTheme.shadow.card, alignSelf: "center", backgroundColor: tindioTheme.color.surface.card, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.lg, borderWidth: 1, gap: tindioTheme.space.lg, maxWidth: 640, padding: tindioTheme.space.lg, width: "100%" },
  header: { alignItems: "center", gap: tindioTheme.space.xxs },
  brand: { ...tindioTheme.typography.role.label, color: tindioTheme.color.brand.primary, letterSpacing: 1.2 },
  title: { ...tindioTheme.typography.role.title, color: tindioTheme.color.brand.ink, textAlign: "center" },
  provisionalReference: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  meta: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary, textAlign: "center" },
  provisionalNotice: { backgroundColor: tindioTheme.color.status.information.surface, borderColor: tindioTheme.color.status.information.border, borderRadius: tindioTheme.radius.md, borderWidth: 1, gap: tindioTheme.space.xxs, padding: tindioTheme.space.md },
  provisionalTitle: { ...tindioTheme.typography.role.label, color: tindioTheme.color.status.information.content },
  provisionalText: { ...tindioTheme.typography.role.body, color: tindioTheme.color.status.information.content },
  lines: { gap: tindioTheme.space.sm },
  sectionLabel: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  line: { alignItems: "flex-start", borderBottomColor: tindioTheme.color.border.default, borderBottomWidth: 1, flexDirection: "row", gap: tindioTheme.space.sm, justifyContent: "space-between", paddingBottom: tindioTheme.space.sm },
  lineCopy: { flex: 1 },
  lineName: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  lineDetail: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  lineAmount: { ...tindioTheme.typography.role.label, color: tindioTheme.color.brand.ink },
  totals: { backgroundColor: tindioTheme.color.brand.cream, borderRadius: tindioTheme.radius.md, gap: tindioTheme.space.xs, padding: tindioTheme.space.md },
  payment: { gap: tindioTheme.space.xs },
  paymentEntry: { gap: tindioTheme.space.xs },
  row: { flexDirection: "row", gap: tindioTheme.space.md, justifyContent: "space-between" },
  rowLabel: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  rowValue: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.primary },
  rowEmphasis: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink },
  divider: { backgroundColor: tindioTheme.color.border.strong, height: 1 },
});
