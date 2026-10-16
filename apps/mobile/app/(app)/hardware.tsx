import { hardwareCapabilityMatrix } from "../../src/features/hardware/hardware-contracts";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioKeyValue, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

export default function HardwareScreen() {
  return (
    <TindioScreen scroll testID="hardware-diagnostics">
      <TindioWorkspaceHeader description="Release-scoped hardware support and transaction-safety boundaries." eyebrow="AUTHORIZED SUPPORT" title="Hardware diagnostics" trailing={<TindioStatusBadge label="Camera scanner supported" tone="success" />} />
      <TindioFeedback description="A hardware failure may fail that hardware action, but it must never duplicate, erase, or roll back a TINDIO transaction." kind="review" title="Hardware is not transaction authority" />
      <TindioWorkspaceSection description="Manual barcode and SKU entry remains available without hardware." title="Capability matrix">
        {hardwareCapabilityMatrix.map((item) => (
          <TindioCard description={item.note} key={item.capability} title={item.capability}>
            <TindioKeyValue label="Support" value={item.support} />
            <TindioKeyValue label="Transaction role" value={item.transactionRole} />
          </TindioCard>
        ))}
      </TindioWorkspaceSection>
      <TindioFeedback description="External scanners, receipt printers, cash drawers, customer displays, KDS transports, and payment terminals require a future adapter and physical release-binary certification." kind="restriction" title="Not supported in v1" />
    </TindioScreen>
  );
}
