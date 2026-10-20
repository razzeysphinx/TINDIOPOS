import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_CREATION_COMPATIBILITY_CONTRACT,
  customerCreationDatabaseFailure,
  customerCreationPermissionFailure,
  mapCreatedCustomer,
  validateCustomerCreation,
} from "../dist/src/pos/customer-creation-compatibility.js";

const VALID_INPUT = {
  fullName: "  Ada Lovelace  ",
  email: " ada@example.com ",
  phone: " +63 912 345 6789 ",
  address: " 12 Computing Way ",
  birthday: "1815-12-10",
  notes: " First programmer ",
  loyaltyCardCode: " ADA-001 ",
};

test("customer-creation compatibility freezes route, authority, and response semantics", () => {
  assert.deepEqual(CUSTOMER_CREATION_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/customers/create",
    permission: "customers.manage",
    table: "customers",
    select: "id, customer_number, loyalty_card_code, full_name, email, phone",
    requiresAssignedStore: false,
    requiresOpenShift: false,
    actionResponse: { status: 200, headers: { "cache-control": "private, no-store" } },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: { ok: false, message: "The request data is invalid." },
    },
  });
});

test("customer-creation compatibility trims and accepts the complete input", () => {
  assert.deepEqual(validateCustomerCreation(VALID_INPUT), {
    ok: true,
    input: {
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+63 912 345 6789",
      address: "12 Computing Way",
      birthday: "1815-12-10",
      notes: "First programmer",
      loyaltyCardCode: "ADA-001",
    },
  });
});

test("customer-creation compatibility accepts blank optional fields and strips extras", () => {
  const result = validateCustomerCreation({
    fullName: "Ada",
    email: "",
    phone: "",
    address: "",
    birthday: "",
    notes: "",
    loyaltyCardCode: "",
    ignored: "strip-me",
  });
  assert.equal(result.ok, true);
  assert.equal("ignored" in result.input, false);
});

test("customer-creation compatibility rejects invalid customer details", () => {
  for (const value of [
    null,
    {},
    { ...VALID_INPUT, fullName: "" },
    { ...VALID_INPUT, email: "not-an-email" },
    { ...VALID_INPUT, birthday: "2026-02-30" },
    { ...VALID_INPUT, loyaltyCardCode: "ab" },
  ]) {
    assert.deepEqual(validateCustomerCreation(value), {
      ok: false,
      result: { ok: false, message: "Check the customer details and try again." },
    });
  }
});

test("customer-creation compatibility freezes permission failure", () => {
  assert.deepEqual(customerCreationPermissionFailure(), {
    ok: false,
    message: "You do not have permission to manage customers.",
  });
});

test("customer-creation compatibility distinguishes constraint and provider failures", () => {
  assert.deepEqual(customerCreationDatabaseFailure({ message: "customers_email_length" }), {
    ok: false,
    message: "Check the customer details and try again.",
  });
  assert.deepEqual(customerCreationDatabaseFailure({ message: "connection unavailable" }), {
    ok: false,
    message: "TINDIO could not save this customer.",
  });
  assert.deepEqual(customerCreationDatabaseFailure(null), {
    ok: false,
    message: "TINDIO could not save this customer.",
  });
});

test("customer-creation compatibility maps the exact POS customer projection", () => {
  assert.deepEqual(mapCreatedCustomer({
    id: "11111111-1111-4111-8111-111111111111",
    customer_number: 42,
    loyalty_card_code: "TND-00000042",
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    phone: null,
  }), {
    ok: true,
    message: "Customer created.",
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      customerNumber: 42,
      loyaltyCardCode: "TND-00000042",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: null,
      loyaltyPoints: 0,
    },
  });
});
