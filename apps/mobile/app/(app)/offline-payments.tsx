import { hasOfflinePaymentProvider, listOfflinePaymentProviders } from "../../src/features/payments/offline-payment-provider-registry";
import { failClosedOfflineElectronicPolicy } from "../../src/features/payments/offline-payment-risk";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioKeyValue, TindioWorkspaceHeader } from "../../src/ui/tindio-workspace";

export default function OfflinePaymentsScreen() {
  const providers = listOfflinePaymentProviders();
  const providerAvailable = hasOfflinePaymentProvider();
  return (
    <TindioScreen scroll testID="offline-payment-diagnostics">
      <TindioWorkspaceHeader description="Payment capabilities available when the authoritative cloud cannot be reached." eyebrow="AUTHORIZED SUPPORT" title="Offline payment policy" trailing={<TindioStatusBadge label="Electronic payments fail closed" tone="warning" />} />
      <TindioCard title="Current release">
        <TindioKeyValue label="Offline cash" value="Enabled through durable cash flow" />
        <TindioKeyValue label="Offline electronic payments" value={providerAvailable ? "Provider available" : "Disabled"} />
        <TindioKeyValue label="Registered providers" value={String(providers.length)} />
        <TindioKeyValue label="Default electronic policy" value={failClosedOfflineElectronicPolicy.electronicOfflineAllowed ? "Enabled" : "Fail closed"} />
      </TindioCard>
      <TindioFeedback description="TINDIO never stores raw card credentials to simulate offline card acceptance. Electronic offline payment requires a real compliant PSP or terminal store-and-forward adapter." kind="restriction" title="No offline card simulation" />
      <TindioCard description="The engine is ready to enforce these controls when a compliant provider enters scope." title="Risk controls">
        <TindioKeyValue label="Transaction exposure" value="Maximum amount" />
        <TindioKeyValue label="Aggregate exposure" value="Maximum offline total" />
        <TindioKeyValue label="Time exposure" value="Maximum offline duration" />
        <TindioKeyValue label="Escalation" value="Manager approval threshold" />
      </TindioCard>
    </TindioScreen>
  );
}
