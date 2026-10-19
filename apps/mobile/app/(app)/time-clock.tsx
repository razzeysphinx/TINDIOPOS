import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";

import type { AttendanceEmployee } from "@tindio/contracts";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { clockInPosV2Employee, clockOutPosV2Employee, fetchPosV2AttendanceEmployees } from "../../src/lib/tindio-api";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioStatusBadge } from "../../src/ui/tindio-status-badge";
import { TindioListItem, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

type ClockAttempt = { signature: string; key: string };

export default function TimeClock() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);
  const [employees, setEmployees] = useState<AttendanceEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState<ClockAttempt | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<"IN" | "OUT" | null>(null);
  const core = data?.core;
  const binding = terminal.identity?.binding;
  const enabled = Boolean(core && cashierFeatureGates(core).timeClock);

  const load = useCallback(async () => {
    if (!core || !binding || mode !== "online") return;
    setLoading(true);
    try {
      const result = await fetchPosV2AttendanceEmployees(core.organization.id, binding.storeId);
      setEmployees(result.employees);
      setMessage(result.ok ? "Employee status is up to date." : result.message);
    } catch {
      setMessage("Attendance employees could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [binding, core, mode]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [enabled, load]);

  if (!enabled) return <TindioScreen><TindioFeedback description="This feature is disabled or your role does not include attendance actions." kind="restriction" title="Time clock unavailable" /></TindioScreen>;
  if (!core || !binding) return <TindioScreen><TindioFeedback description="Enroll and assign this terminal before using the time clock." kind="restriction" title="Terminal assignment required" /></TindioScreen>;

  const selectedEmployee = employees.find((employee) => employee.id === employeeId);
  const validPin = /^\d{6,12}$/.test(pin);

  const submit = async (clockOut: boolean) => {
    if (pendingAction || mode !== "online" || !employeeId || !validPin) return;
    const action = clockOut ? "OUT" : "IN";
    const signature = `${employeeId}:${action}:${binding.storeId}`;
    const requestId = attempt?.signature === signature ? attempt.key : Crypto.randomUUID();
    setAttempt({ signature, key: requestId });
    setPendingAction(action);
    try {
      const result = clockOut
        ? await clockOutPosV2Employee(core.organization.id, { employeeId, pin, requestId })
        : await clockInPosV2Employee(core.organization.id, { storeId: binding.storeId, employeeId, pin, requestId });
      setMessage(result.message);
      if (result.ok) {
        setPin("");
        setAttempt(null);
        await load();
      }
    } catch {
      setMessage("Attendance status is unknown. Retry the unchanged action to reuse the same request ID.");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <TindioScreen scroll testID="time-clock-workspace">
      <TindioWorkspaceHeader description="Choose an employee, enter their PIN, and perform one attendance action." eyebrow="ATTENDANCE" title="Time clock" trailing={<TindioStatusBadge label={mode === "online" ? "Online" : "Connection required"} tone={mode === "online" ? "success" : "warning"} />} />
      {mode !== "online" ? <TindioFeedback description="Clock-in and clock-out require a connection. No attendance action is queued offline." kind="restriction" title="Time clock is online only" /> : null}

      <TindioWorkspaceSection description="Status is loaded from the connected business account." title="Employee">
        <TindioButton busy={loading} disabled={mode !== "online"} onPress={() => void load()} variant="secondary">Refresh employees</TindioButton>
        {employees.length ? employees.map((employee) => (
          <TindioListItem
            detail={`#${employee.employeeNumber}${!employee.pinIsSet ? " / PIN not set" : ""}`}
            key={employee.id}
            meta={employee.entry ? "Clocked in" : "Clocked out"}
            onPress={() => { setEmployeeId(employee.id); setAttempt(null); }}
            selected={employeeId === employee.id}
            title={employee.name}
          />
        )) : <TindioFeedback description="Refresh while connected to load employees for this store." kind="empty" title="No employees shown" />}
      </TindioWorkspaceSection>

      <TindioCard description={selectedEmployee ? `Selected: ${selectedEmployee.name}` : "Select an employee before entering a PIN."} title="Confirm attendance">
        <TindioInput accessibilityLabel="Employee PIN" keyboardType="number-pad" label="6-12 digit PIN" maxLength={12} onChangeText={(value) => setPin(value.replace(/[^\d]/g, ""))} placeholder="PIN" secureTextEntry value={pin} />
        {selectedEmployee?.entry ? (
          <TindioButton busy={pendingAction === "OUT"} disabled={mode !== "online" || !validPin} onPress={() => void submit(true)} variant="secondary">Clock out</TindioButton>
        ) : (
          <TindioButton busy={pendingAction === "IN"} disabled={mode !== "online" || !employeeId || !validPin} onPress={() => void submit(false)}>Clock in</TindioButton>
        )}
      </TindioCard>

      {message ? <TindioFeedback description={message} kind="review" title="Attendance update" /> : null}
    </TindioScreen>
  );
}
