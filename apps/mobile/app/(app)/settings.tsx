import { useEffect, useState } from "react";

import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { canReleaseTransactionCustody } from "../../src/features/offline/transaction-custody";
import { useSession } from "../../src/features/session/session-provider";
import { clearStoreHubConfig, readStoreHubConfig, saveStoreHubConfig } from "../../src/features/store-hub/store-hub-config";
import { probeStoreHub } from "../../src/features/store-hub/store-hub-client";
import { isStoreHubEnabledForRelease } from "../../src/features/store-hub/store-hub-release-scope";
import { PublicPolicyLinks } from "../../src/features/support/public-policy-links";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioKeyValue, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

type SettingsAction = "save" | "test" | "remove" | "sign-out";

export default function SettingsScreen() {
  const { data } = useBusinessContext();
  const { signOut } = useSession();
  const core = data?.core;
  const terminal = useTerminalDevice(core?.organization.id);
  const binding = terminal.identity?.binding;
  const storeHubEnabled = isStoreHubEnabledForRelease();
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<SettingsAction | null>(null);

  useEffect(() => {
    if (!core || !storeHubEnabled) return;
    let active = true;
    void readStoreHubConfig(core.organization.id).then((config) => {
      if (!active || !config) return;
      setEndpoint(config.endpoint);
      setMessage("Store Hub credentials are securely stored on this device.");
    });
    return () => { active = false; };
  }, [core, storeHubEnabled]);

  if (!core) return <TindioScreen><TindioFeedback description="Loading account and terminal settings." kind="loading" title="Loading settings" /></TindioScreen>;

  const saveHub = async () => {
    if (!binding || pendingAction) return;
    setPendingAction("save");
    try {
      await saveStoreHubConfig({ organizationId: core.organization.id, storeId: binding.storeId, endpoint, token });
      setToken("");
      setMessage("Store Hub configuration saved securely.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Store Hub configuration failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const testHub = async () => {
    if (!binding || pendingAction) return;
    setPendingAction("test");
    try {
      const result = await probeStoreHub({ organizationId: core.organization.id, storeId: binding.storeId });
      setMessage(result.ok ? `Store Hub ready at revision ${result.currentRevision}.` : `Store Hub unavailable: ${result.reason}`);
    } finally {
      setPendingAction(null);
    }
  };

  const clearHub = async () => {
    if (pendingAction) return;
    setPendingAction("remove");
    try {
      const custody = await canReleaseTransactionCustody(core.organization.id);
      if (!custody.ok) {
        setMessage(`${custody.message} Store Hub configuration is being retained as a recovery path.`);
        return;
      }
      await clearStoreHubConfig(core.organization.id);
      setEndpoint("");
      setToken("");
      setMessage("Store Hub configuration removed.");
    } finally {
      setPendingAction(null);
    }
  };

  const performSignOut = async () => {
    if (pendingAction) return;
    setPendingAction("sign-out");
    const result = await signOut();
    if (!result.ok) {
      setMessage(result.message);
      setPendingAction(null);
    }
  };

  return (
    <TindioScreen scroll testID="settings-workspace">
      <TindioWorkspaceHeader description="Account, terminal assignment, support policy, and release-scoped connectivity settings." eyebrow="SETTINGS" title="Account & terminal" trailing={<TindioStatusBadge label={binding ? "Terminal assigned" : "Assignment required"} tone={binding ? "success" : "warning"} />} />

      <TindioCard title="Signed-in account">
        <TindioKeyValue label="Business" value={core.organization.name} />
        <TindioKeyValue label="Employee" value={core.employee.name} />
        <TindioKeyValue label="Roles" value={core.roleNames.join(", ") || "No roles"} />
      </TindioCard>

      <TindioCard title="This terminal">
        <TindioKeyValue label="Assignment" value={binding ? "Assigned store and register" : "Enrollment required"} />
        <TindioKeyValue label="App version" value={binding?.appVersion || "Not available"} />
        <TindioKeyValue label="Last verified" value={terminal.identity?.lastVerifiedAt ? new Date(terminal.identity.lastVerifiedAt).toLocaleString() : "Not verified"} />
      </TindioCard>

      <TindioWorkspaceSection description="Store Hub is a private-network capability and remains separate from routine cashier settings." title="Store Hub">
        {storeHubEnabled ? (
          <TindioCard>
            <TindioInput autoCapitalize="none" label="Private Hub endpoint" onChangeText={setEndpoint} placeholder="https://hub.example.local:8787" value={endpoint} />
            <TindioInput autoCapitalize="none" label="Hub token" onChangeText={setToken} placeholder="Enter or replace the 32+ character token" secureTextEntry value={token} />
            <TindioButton busy={pendingAction === "save"} disabled={!binding || !endpoint || token.length < 32} onPress={() => void saveHub()}>Save Store Hub</TindioButton>
            <TindioButton busy={pendingAction === "test"} disabled={!binding} onPress={() => void testHub()} variant="secondary">Test Store Hub</TindioButton>
            <TindioButton busy={pendingAction === "remove"} onPress={() => void clearHub()} variant="destructive">Remove Store Hub</TindioButton>
          </TindioCard>
        ) : <TindioFeedback description="Store Hub is not included in this release. Isolated offline cash remains available when this terminal is prepared. Any previously stored Hub configuration is retained and inactive." kind="restriction" title="Store Hub deferred" />}
      </TindioWorkspaceSection>

      <TindioWorkspaceSection description="Public support, privacy, and account-deletion information." title="Support & policies">
        <TindioCard><PublicPolicyLinks /></TindioCard>
      </TindioWorkspaceSection>

      {message ? <TindioFeedback description={message} kind="review" title="Settings update" /> : null}
      <TindioButton busy={pendingAction === "sign-out"} onPress={() => void performSignOut()} variant="secondary">Sign out</TindioButton>
    </TindioScreen>
  );
}
