import { StyleSheet, Text, View } from "react-native";

import { TindioButton } from "../../ui/tindio-button";
import { TindioFeedback } from "../../ui/tindio-feedback";
import { TindioInput } from "../../ui/tindio-input";
import { tindioTheme } from "../../ui/theme";
import { useTindioResponsiveLayout } from "../../ui/tindio-responsive";
import { formatMoney } from "./cashier-format";

export type CashierSaleResult = {
  kind: "official" | "saved";
  reference: string;
  totalMinor: number;
  changeMinor: number;
  replayed?: boolean;
};

type CashierTenderPanelProps = {
  currencyCode: string;
  totalMinor: number;
  cashTender: string;
  tenderedMinor: number | null;
  changeMinor: number | null;
  cashMethodAvailable: boolean;
  online: boolean;
  offlineReadinessLabel: string;
  offlineSaleReady: boolean;
  hasCart: boolean;
  onlineIntent: boolean;
  onlineIntentMatchesCurrentContext: boolean;
  savingOffline: boolean;
  onlineCheckoutPending: boolean;
  offlineDisabled: boolean;
  onlineDisabled: boolean;
  saleMessage: string | null;
  saleResult: CashierSaleResult | null;
  onCashTender(value: string): void;
  onSaveOffline(): void;
  onCompleteOnline(): void;
  onDismissResult(): void;
};

export function CashierTenderPanel({
  currencyCode,
  totalMinor,
  cashTender,
  tenderedMinor,
  changeMinor,
  cashMethodAvailable,
  online,
  offlineReadinessLabel,
  offlineSaleReady,
  hasCart,
  onlineIntent,
  onlineIntentMatchesCurrentContext,
  savingOffline,
  onlineCheckoutPending,
  offlineDisabled,
  onlineDisabled,
  saleMessage,
  saleResult,
  onCashTender,
  onSaveOffline,
  onCompleteOnline,
  onDismissResult,
}: CashierTenderPanelProps) {
  const { isLargeText, viewportClass } = useTindioResponsiveLayout();
  const stacked = isLargeText || viewportClass === "compact-phone";

  if (saleResult) {
    return (
      <SaleResult
        currencyCode={currencyCode}
        onDismiss={onDismissResult}
        result={saleResult}
      />
    );
  }

  const tenderShort = tenderedMinor !== null && tenderedMinor < totalMinor;

  return (
    <View style={styles.panel} testID="checkout-panel">
      <View style={[styles.heading, stacked ? styles.stacked : null]}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>PAYMENT</Text>
          <Text accessibilityRole="header" style={styles.title}>Cash tender</Text>
          <Text style={styles.description}>Confirm the amount received before accepting this sale.</Text>
        </View>
        <View style={[styles.amountDue, stacked ? styles.alignStart : null]}>
          <Text style={styles.amountLabel}>Amount due</Text>
          <Text accessibilityLabel={`Amount due ${formatMoney(totalMinor, currencyCode)}`} style={styles.amountValue}>
            {formatMoney(totalMinor, currencyCode)}
          </Text>
        </View>
      </View>

      <TindioInput
        accessibilityLabel="Cash tendered"
        error={tenderShort ? `Enter at least ${formatMoney(totalMinor, currencyCode)}.` : undefined}
        keyboardType="decimal-pad"
        label="Cash received"
        onChangeText={onCashTender}
        placeholder="0.00"
        returnKeyType="done"
        testID="cash-tender-input"
        value={cashTender}
      />

      <View accessibilityLiveRegion="polite" style={[styles.changeCard, stacked ? styles.stacked : null]}>
        <Text style={styles.changeLabel}>Change due</Text>
        <Text style={styles.changeValue}>
          {changeMinor === null ? "Enter cash received" : formatMoney(changeMinor, currencyCode)}
        </Text>
      </View>

      {!cashMethodAvailable ? (
        <TindioFeedback
          description="Reconnect and prepare this register before accepting payment."
          kind="restriction"
          title="Cash payment method unavailable"
        />
      ) : null}

      <View style={styles.readiness} testID="offline-readiness">
        <Text style={styles.readinessLabel}>Offline readiness</Text>
        <Text style={offlineSaleReady ? styles.ready : styles.notReady}>{offlineReadinessLabel}</Text>
      </View>

      {!offlineSaleReady && hasCart ? (
        <TindioFeedback
          description="This cart remains available while you reconnect or finish terminal preparation."
          kind="restriction"
          title="Offline payment is paused"
        />
      ) : null}

      {onlineIntent ? (
        <TindioFeedback
          description={onlineIntentMatchesCurrentContext
            ? "Retry only this original checkout. Offline fallback stays blocked until its result is resolved."
            : "Restore the original employee, shift, store, and register context or use supervised recovery."}
          kind="review"
          title="Checkout result needs confirmation"
        />
      ) : null}

      <View style={styles.actions}>
        {online ? (
          <>
            <TindioButton
              accessibilityLabel={onlineIntent ? "Retry original online checkout" : "Complete online cash checkout"}
              busy={onlineCheckoutPending}
              disabled={onlineDisabled}
              onPress={onCompleteOnline}
              testID="complete-online-cash-checkout"
            >
              {onlineCheckoutPending
                ? "Confirming sale"
                : onlineIntent
                  ? "Retry original checkout"
                  : "Accept cash payment"}
            </TindioButton>
            <TindioButton
              accessibilityLabel="Save offline cash sale"
              busy={savingOffline}
              disabled={offlineDisabled}
              onPress={onSaveOffline}
              testID="save-offline-cash-sale"
              variant="secondary"
            >
              {savingOffline ? "Saving on this device" : "Save as offline sale"}
            </TindioButton>
          </>
        ) : (
          <TindioButton
            accessibilityLabel="Save offline cash sale"
            busy={savingOffline}
            disabled={offlineDisabled}
            onPress={onSaveOffline}
            testID="save-offline-cash-sale"
          >
            {savingOffline ? "Saving on this device" : "Accept cash and save on device"}
          </TindioButton>
        )}
      </View>

      {saleMessage ? (
        <TindioFeedback description={saleMessage} kind="review" title="Sale update" />
      ) : null}
    </View>
  );
}

function SaleResult({
  currencyCode,
  onDismiss,
  result,
}: {
  currencyCode: string;
  onDismiss(): void;
  result: CashierSaleResult;
}) {
  const official = result.kind === "official";

  return (
    <View accessibilityLiveRegion="polite" style={styles.result} testID="checkout-result">
      <Text style={styles.resultMark}>✓</Text>
      <Text accessibilityRole="header" style={styles.resultTitle}>
        {official ? "Sale complete" : "Sale saved on this device"}
      </Text>
      <Text style={styles.resultReference}>
        {official ? `Official receipt #${result.reference}` : `Provisional record ${result.reference}`}
      </Text>
      <Text style={styles.resultDescription}>
        {official
          ? result.replayed
            ? "TINDIO confirmed the original checkout without creating a duplicate sale."
            : "TINDIO confirmed the sale and issued an official receipt."
          : "The sale was durably accepted on this register. It will receive an official receipt after synchronization."}
      </Text>
      <View style={styles.resultAmounts}>
        <View>
          <Text style={styles.amountLabel}>Total</Text>
          <Text style={styles.amountValue}>{formatMoney(result.totalMinor, currencyCode)}</Text>
        </View>
        <View>
          <Text style={styles.amountLabel}>Change</Text>
          <Text style={styles.amountValue}>{formatMoney(result.changeMinor, currencyCode)}</Text>
        </View>
      </View>
      <TindioButton onPress={onDismiss}>Start next sale</TindioButton>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { ...tindioTheme.shadow.overlay, backgroundColor: tindioTheme.color.surface.elevated, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.lg, borderWidth: 1, gap: tindioTheme.space.md, padding: tindioTheme.space.lg },
  heading: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.md, justifyContent: "space-between" },
  headingCopy: { flex: 1, minWidth: 210 },
  eyebrow: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.primary, letterSpacing: 1.2 },
  title: { ...tindioTheme.typography.role.title, color: tindioTheme.color.content.primary },
  description: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  amountDue: { alignItems: "flex-end" },
  amountLabel: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  amountValue: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink },
  changeCard: { alignItems: "center", backgroundColor: tindioTheme.color.brand.cream, borderRadius: tindioTheme.radius.md, flexDirection: "row", justifyContent: "space-between", padding: tindioTheme.space.md },
  changeLabel: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  changeValue: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.primary },
  readiness: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xs, justifyContent: "space-between" },
  readinessLabel: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.secondary },
  ready: { ...tindioTheme.typography.role.label, color: tindioTheme.color.status.success.content },
  notReady: { ...tindioTheme.typography.role.label, color: tindioTheme.color.status.warning.content },
  actions: { gap: tindioTheme.space.sm },
  stacked: { alignItems: "stretch", flexDirection: "column" },
  alignStart: { alignItems: "flex-start" },
  result: { ...tindioTheme.shadow.overlay, alignItems: "center", backgroundColor: tindioTheme.color.status.success.surface, borderColor: tindioTheme.color.status.success.border, borderRadius: tindioTheme.radius.lg, borderWidth: 1, gap: tindioTheme.space.md, padding: tindioTheme.space.lg },
  resultMark: { ...tindioTheme.typography.role.display, color: tindioTheme.color.status.success.content },
  resultTitle: { ...tindioTheme.typography.role.title, color: tindioTheme.color.status.success.content, textAlign: "center" },
  resultReference: { ...tindioTheme.typography.role.section, color: tindioTheme.color.brand.ink, textAlign: "center" },
  resultDescription: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.primary, textAlign: "center" },
  resultAmounts: { flexDirection: "row", gap: tindioTheme.space.xl, justifyContent: "center" },
});
