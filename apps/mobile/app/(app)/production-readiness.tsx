import * as Application from "expo-application";
import { useState } from "react";

import { getLocalSchemaVersion } from "../../src/db/database";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { armAppUpgradeProof, verifyAppUpgradeProof } from "../../src/features/runtime/app-upgrade-proof";
import { useSession } from "../../src/features/session/session-provider";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioKeyValue, TindioWorkspaceHeader } from "../../src/ui/tindio-workspace";

export default function ProductionReadinessScreen() {
  const { data } = useBusinessContext();
  const { authTransitionState } = useSession();
  const organizationId = data?.core.organization.id;
  const [message, setMessage] = useState("Not checked");
  const [busy, setBusy] = useState<"arm" | "verify" | "schema" | null>(null);

  const arm = async () => {
    if (!organizationId || busy) return;
    setBusy("arm");
    try {
      const proof = await armAppUpgradeProof(organizationId);
      const receipts = proof.events.filter((event) => event.receiptContentDigest).length;
      setMessage(`Upgrade proof armed: ${proof.events.length} unsynced event(s), ${receipts} receipt(s), ${proof.deviceSequences.length} sequence checkpoint(s), Auth ${proof.auth.state}, schema ${proof.schemaVersion}.`);
    } finally { setBusy(null); }
  };
  const verify = async () => {
    if (!organizationId || busy) return;
    setBusy("verify");
    try {
      const result = await verifyAppUpgradeProof(organizationId);
      if (!result.ok) { setMessage(`Upgrade proof failed: ${result.reason}${result.eventId ? ` / ${result.eventId}` : ""}.`); return; }
      setMessage(`Upgrade proof passed: Auth ${result.currentAuthState}; session, enrollment, offline grant, ${result.proof.events.length} event(s), receipts, and sequence checkpoints preserved; schema ${result.proof.schemaVersion} to ${result.currentSchemaVersion}.`);
    } finally { setBusy(null); }
  };
  const showSchema = async () => {
    if (busy) return;
    setBusy("schema");
    try { setMessage(`Current SQLite schema ${await getLocalSchemaVersion()}.`); } finally { setBusy(null); }
  };

  return (
    <TindioScreen scroll testID="production-readiness-diagnostics">
      <TindioWorkspaceHeader description="Build identity and non-destructive upgrade preservation checks for authorized support." eyebrow="AUTHORIZED SUPPORT" title="Production readiness" />
      <TindioCard title="Installed application">
        <TindioKeyValue label="Package" value="com.tindio.pos" />
        <TindioKeyValue label="App version" value={Application.nativeApplicationVersion ?? "DEV"} />
        <TindioKeyValue label="Build version" value={Application.nativeBuildVersion ?? "DEV"} />
        <TindioKeyValue label="Update channel" value="Signed Google Play binary" />
        <TindioKeyValue label="Auth transition" value={authTransitionState.replaceAll("_", " ")} />
      </TindioCard>
      <TindioFeedback description="App updates must preserve Auth-session continuity, device enrollment, offline authorization, locally accepted transactions, immutable receipts, and sequence checkpoints. These controls inspect that guarantee without clearing custody or displaying secrets." kind="review" title="Upgrade custody proof" />
      <TindioButton busy={busy === "arm"} disabled={!organizationId} onPress={() => void arm()}>Arm upgrade preservation proof</TindioButton>
      <TindioButton busy={busy === "verify"} disabled={!organizationId} onPress={() => void verify()} variant="secondary">Verify upgrade preservation proof</TindioButton>
      <TindioButton busy={busy === "schema"} onPress={() => void showSchema()} variant="secondary">Show SQLite schema version</TindioButton>
      <TindioFeedback description={message} kind="review" title="Diagnostic result" />
    </TindioScreen>
  );
}
