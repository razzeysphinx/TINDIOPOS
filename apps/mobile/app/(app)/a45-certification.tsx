import { useEffect, useState } from "react";

import { getHistoricalAndroidExitEvents, isA45CertificationTriggerAvailable, triggerA45Anr, triggerA45NativeCrash, type AndroidExitEvent } from "../../modules/tindio-exit-observer";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioKeyValue, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

export default function A45CertificationScreen() {
  const available = isA45CertificationTriggerAvailable();
  const [events, setEvents] = useState<AndroidExitEvent[]>([]);
  useEffect(() => { void getHistoricalAndroidExitEvents().then(setEvents); }, []);
  return (
    <TindioScreen scroll testID="a45-certification-diagnostics">
      <TindioWorkspaceHeader description="Android process-exit evidence and destructive synthetic triggers for controlled certification only." eyebrow="AUTHORIZED CERTIFICATION" title="A45 exit diagnostics" trailing={<TindioStatusBadge label={available ? "Test triggers enabled" : "Production-safe build"} tone={available ? "danger" : "success"} />} />
      <TindioFeedback description="Only Android exit reason and timestamp are retained. No exception, stack, customer, payment, receipt, or transaction payload is collected." kind="review" title="Privacy boundary" />
      <TindioWorkspaceSection title="Historical actionable exits">
        <TindioKeyValue label="Recorded exits" value={String(events.length)} />
        {events.map((event) => <TindioCard key={`${event.type}-${event.timestampMs}`} title={event.type}><TindioKeyValue label="Timestamp" value={new Date(event.timestampMs).toISOString()} /></TindioCard>)}
      </TindioWorkspaceSection>
      {available ? (
        <TindioCard description="These actions intentionally terminate or stall the app. Use only during a controlled certification run." title="Destructive test triggers">
          <TindioButton onPress={triggerA45NativeCrash} variant="destructive">Trigger synthetic native crash</TindioButton>
          <TindioButton onPress={triggerA45Anr} variant="destructive">Trigger synthetic Android ANR</TindioButton>
        </TindioCard>
      ) : null}
    </TindioScreen>
  );
}
