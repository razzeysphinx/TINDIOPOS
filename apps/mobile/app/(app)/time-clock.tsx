import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { AttendanceEmployee } from "../../../../src/contracts/pos";
import { cashierFeatureGates } from "../../src/features/cashier/cashier-feature-gates";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import {
  clockInPosV2Employee,
  clockOutPosV2Employee,
  fetchPosV2AttendanceEmployees,
} from "../../src/lib/tindio-api";

type ClockAttempt = {
  signature: string;
  key: string;
};

export default function TimeClock() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);

  const [employees, setEmployees] = useState<AttendanceEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState<ClockAttempt | null>(null);

  const core = data?.core;
  const binding = terminal.identity?.binding;
  const enabled = Boolean(core && cashierFeatureGates(core).timeClock);

  const load = useCallback(async () => {
    if (!core || !binding || mode !== "online") return;

    try {
      const result = await fetchPosV2AttendanceEmployees(
        core.organization.id,
        binding.storeId,
      );

      setEmployees(result.employees);
      setMessage(result.ok ? "Employees loaded." : result.message);
    } catch {
      setMessage("Attendance employees could not be loaded.");
    }
  }, [binding, core, mode]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [enabled, load]);

  if (!enabled) {
    return <Text>Time clock disabled by feature or permission.</Text>;
  }

  if (!core || !binding) {
    return <Text>Time clock requires an enrolled terminal.</Text>;
  }

  const submit = async (clockOut: boolean) => {
    if (
      mode !== "online"
      || !employeeId
      || !/^\d{6,12}$/.test(pin)
    ) return;

    const signature = `${employeeId}:${clockOut ? "OUT" : "IN"}:${binding.storeId}`;
    const requestId =
      attempt?.signature === signature
        ? attempt.key
        : Crypto.randomUUID();

    setAttempt({ signature, key: requestId });

    try {
      const result = clockOut
        ? await clockOutPosV2Employee(core.organization.id, {
            employeeId,
            pin,
            requestId,
          })
        : await clockInPosV2Employee(core.organization.id, {
            storeId: binding.storeId,
            employeeId,
            pin,
            requestId,
          });

      setMessage(result.message);

      if (result.ok) {
        setPin("");
        setAttempt(null);
        await load();
      }
    } catch {
      setMessage(
        "Attendance status is unknown. Retry the unchanged action to reuse the same request ID.",
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Time clock — ONLINE ONLY</Text>

      <Pressable disabled={mode !== "online"} onPress={() => void load()}>
        <Text>Refresh employees</Text>
      </Pressable>

      {employees.map((employee) => (
        <Pressable
          key={employee.id}
          onPress={() => {
            setEmployeeId(employee.id);
            setAttempt(null);
          }}
        >
          <Text>
            {employeeId === employee.id ? "✓ " : ""}
            {employee.name}
            {" — #"}
            {employee.employeeNumber}
            {" — "}
            {employee.entry ? "CLOCKED IN" : "CLOCKED OUT"}
            {!employee.pinIsSet ? " — PIN NOT SET" : ""}
          </Text>
        </Pressable>
      ))}

      <TextInput
        value={pin}
        onChangeText={(value) => setPin(value.replace(/[^\d]/g, ""))}
        placeholder="6–12 digit PIN"
        secureTextEntry
        keyboardType="number-pad"
        maxLength={12}
      />

      <Pressable
        disabled={
          mode !== "online"
          || !employeeId
          || !/^\d{6,12}$/.test(pin)
        }
        onPress={() => void submit(false)}
      >
        <Text>Clock in</Text>
      </Pressable>

      <Pressable
        disabled={
          mode !== "online"
          || !employeeId
          || !/^\d{6,12}$/.test(pin)
        }
        onPress={() => void submit(true)}
      >
        <Text>Clock out</Text>
      </Pressable>

      <Text>{message}</Text>
    </ScrollView>
  );
}
