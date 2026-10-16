import { useState } from "react";

import type { PosCustomer } from "../../../../src/contracts/pos";
import { saveCustomerSearchResults, searchCachedCustomers } from "../../src/db/customer-cache";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { createPosV2Customer, searchPosV2Customers } from "../../src/lib/tindio-api";
import { TindioButton } from "../../src/ui/tindio-button";
import { TindioCard } from "../../src/ui/tindio-card";
import { TindioFeedback } from "../../src/ui/tindio-feedback";
import { TindioInput } from "../../src/ui/tindio-input";
import { TindioScreen } from "../../src/ui/tindio-screen";
import { TindioListItem, TindioWorkspaceHeader, TindioWorkspaceSection } from "../../src/ui/tindio-workspace";

export default function Customers() {
  const { data, mode } = useBusinessContext();
  const terminal = useTerminalDevice(data?.core.organization.id);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [rows, setRows] = useState<PosCustomer[]>([]);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!data || !terminal.identity?.binding) {
    return <TindioScreen><TindioFeedback description="Enroll and assign this terminal before accessing store customers." kind="restriction" title="Customer workspace unavailable" /></TindioScreen>;
  }

  const { core } = data;
  const binding = terminal.identity.binding;
  const canCreate = core.permissions.includes("customers.manage");

  const search = async () => {
    if (searching) return;
    setSearching(true);
    try {
      if (mode === "online") {
        const result = await searchPosV2Customers(core.organization.id, binding.storeId, query);
        setRows(result.customers);
        await saveCustomerSearchResults(core.organization.id, binding.storeId, result);
        setMessage("Customer results are up to date.");
        return;
      }
      setRows(await searchCachedCustomers(core.organization.id, binding.storeId, query));
      setMessage("Showing customers saved on this device. Search and creation require a connection.");
    } catch {
      setMessage("Customer search unavailable.");
    } finally {
      setSearching(false);
    }
  };

  const create = async () => {
    if (creating || mode !== "online" || !canCreate || !name.trim()) return;
    setCreating(true);
    try {
      const result = await createPosV2Customer(core.organization.id, {
        fullName: name.trim(), email: email.trim(), phone: phone.trim(), address: "", birthday: "", notes: "", loyaltyCardCode: "",
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
    } finally {
      setCreating(false);
    }
  };

  return (
    <TindioScreen scroll testID="customers-workspace">
      <TindioWorkspaceHeader description="Find a customer for the current store or add one while connected." eyebrow="CUSTOMERS" title="Customer directory" />
      {mode !== "online" ? <TindioFeedback description="You can search customers already saved on this device. Creating a customer requires a connection." kind="restriction" title="Offline customer access" /> : null}

      <TindioCard>
        <TindioInput accessibilityLabel="Customer search" label="Search" onChangeText={setQuery} placeholder="Name, phone, email or customer number" value={query} />
        <TindioButton busy={searching} onPress={() => void search()}>{mode === "online" ? "Search customers" : "Search saved customers"}</TindioButton>
      </TindioCard>

      <TindioWorkspaceSection description="Results are scoped to the assigned store." title="Results">
        {rows.length ? rows.map((row) => (
          <TindioListItem detail={[row.phone, row.email].filter(Boolean).join(" / ") || "No contact details"} key={row.id} meta={`#${row.customerNumber} / ${row.loyaltyPoints} points`} title={row.fullName} />
        )) : <TindioFeedback description="Search by name, phone, email, or customer number." kind="empty" title="No customers shown" />}
      </TindioWorkspaceSection>

      {canCreate ? (
        <TindioCard description="New customers are created in the connected business account." title="Add customer">
          <TindioInput editable={mode === "online"} label="Full name" onChangeText={setName} placeholder="New customer name" value={name} />
          <TindioInput editable={mode === "online"} keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="Email" value={email} />
          <TindioInput editable={mode === "online"} label="Phone" onChangeText={setPhone} placeholder="Phone" value={phone} />
          <TindioButton busy={creating} disabled={mode !== "online" || !name.trim()} onPress={() => void create()}>Create customer</TindioButton>
        </TindioCard>
      ) : null}

      {message ? <TindioFeedback description={message} kind="review" title="Customer update" /> : null}
    </TindioScreen>
  );
}
