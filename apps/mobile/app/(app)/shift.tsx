import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { closePosV2Shift, openPosV2Shift } from "../../src/lib/tindio-api";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";

export default function ShiftScreen() {
  const { data, reload, mode } = useBusinessContext(); const core = data?.core; const terminal = useTerminalDevice(core?.organization.id);
  const [openingCash, setOpeningCash] = useState("0"); const [countedCash, setCountedCash] = useState("0"); const [note, setNote] = useState("");
  if (!core) return <Text>Loading business context…</Text>;
  const binding = terminal.identity?.binding; const active = core.activeShift; const matches = !!active && !!binding && active.storeId === binding.storeId && active.registerId === binding.registerId;
  const offline = mode === "offline";
  const open = async () => { if (offline || !binding || !terminal.identity || !core.permissions.includes("shifts.open")) return; const result = await openPosV2Shift(core.organization.id, binding, terminal.identity.credential, { openingCash, openingNote: note }); if (result.ok) await reload(core.organization.id); };
  const close = async () => { if (offline || !active || !matches || !core.permissions.includes("shifts.close")) return; const result = await closePosV2Shift(core.organization.id, { shiftId: active.id, countedCash, closingNote: note }); if (result.ok) await reload(core.organization.id); };
  return <View><Text>Shift — {core.organization.name}</Text><Text>{binding ? `Terminal: ${binding.storeId} / ${binding.registerId}` : "Enroll or verify this terminal first."}</Text>{active ? <Text>Active shift: {active.id}</Text> : <Text>No active shift</Text>}{offline ? <Text>Shift changes require cloud connectivity until Phase 10 durable operations.</Text> : null}{active && !matches ? <Text>This active shift belongs to another terminal.</Text> : null}<TextInput value={openingCash} onChangeText={setOpeningCash} placeholder="Opening cash" editable={!offline} /><TextInput value={countedCash} onChangeText={setCountedCash} placeholder="Counted cash" editable={!offline} /><TextInput value={note} onChangeText={setNote} placeholder="Optional note" editable={!offline} /><Pressable disabled={offline || !binding || !!active || !core.permissions.includes("shifts.open")} onPress={() => void open()}><Text>Open shift</Text></Pressable><Pressable disabled={offline || !matches || !core.permissions.includes("shifts.close")} onPress={() => void close()}><Text>Close shift</Text></Pressable></View>;
}
