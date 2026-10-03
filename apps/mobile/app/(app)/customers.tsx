import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import type { PosCustomer } from "../../../../src/contracts/pos";
import {
  saveCustomerSearchResults,
  searchCachedCustomers,
} from "../../src/db/customer-cache";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import {
  createPosV2Customer,
  searchPosV2Customers,
} from "../../src/lib/tindio-api";

export default function Customers() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);

  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [rows, setRows] = useState<PosCustomer[]>([]);
  const [message, setMessage] = useState("");

  if (!data || !terminal.identity?.binding) {
    return <Text>Customer workspace requires an enrolled terminal.</Text>;
  }

  const { core } = data;
  const binding = terminal.identity.binding;
  const canCreate = core.permissions.includes("customers.manage");

  const search = async () => {
    try {
      if (mode === "online") {
        const result = await searchPosV2Customers(
          core.organization.id,
          binding.storeId,
          query,
        );
        setRows(result.customers);
        await saveCustomerSearchResults(
          core.organization.id,
          binding.storeId,
          result,
        );
        setMessage("SERVER CUSTOMERS");
        return;
      }

      setRows(
        await searchCachedCustomers(
          core.organization.id,
          binding.storeId,
          query,
        ),
      );
      setMessage("CACHED CUSTOMERS — READ ONLY");
    } catch {
      setMessage("Customer search unavailable.");
    }
  };

  const create = async () => {
    if (mode !== "online" || !canCreate || !name.trim()) return;

    try {
      const result = await createPosV2Customer(core.organization.id, {
        fullName: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: "",
        birthday: "",
        notes: "",
        loyaltyCardCode: "",
      });

      setMessage(result.message);

      if (result.ok) {
        setName("");
        setEmail("");
        setPhone("");
        await search();
      }
    } catch {
      setMessage("Customer creation could not be confirmed.");
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Customers</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Name, phone, email or customer number"
      />

      <Pressable onPress={() => void search()}>
        <Text>{mode === "online" ? "Search customers" : "Search cached customers"}</Text>
      </Pressable>

      {rows.map((row) => (
        <Text key={row.id}>
          {row.fullName} — #{row.customerNumber} — loyalty {row.loyaltyPoints}
          {row.phone ? ` — ${row.phone}` : ""}
          {row.email ? ` — ${row.email}` : ""}
        </Text>
      ))}

      {canCreate ? (
        <>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="New customer name"
            editable={mode === "online"}
          />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            keyboardType="email-address"
            editable={mode === "online"}
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone"
            editable={mode === "online"}
          />

          <Pressable
            disabled={mode !== "online" || !name.trim()}
            onPress={() => void create()}
          >
            <Text>Create customer online</Text>
          </Pressable>
        </>
      ) : null}

      <Text>{message}</Text>
    </ScrollView>
  );
}
