import { z } from "zod";

export const POS_CUSTOMER_CREATION_PATH = "/api/pos/v2/customers/create" as const;
export const POS_CUSTOMER_CREATION_PERMISSION = "customers.manage" as const;
export const POS_CUSTOMER_CREATION_TABLE = "customers" as const;
export const POS_CUSTOMER_CREATION_SELECT =
  "id, customer_number, loyalty_card_code, full_name, email, phone" as const;

export const POS_CUSTOMER_CREATION_PERMISSION_MESSAGE =
  "You do not have permission to manage customers." as const;
export const POS_CUSTOMER_CREATION_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_CUSTOMER_CREATION_INPUT_MESSAGE =
  "Check the customer details and try again." as const;
export const POS_CUSTOMER_CREATION_DATABASE_MESSAGE =
  "TINDIO could not save this customer." as const;
export const POS_CUSTOMER_CREATION_SUCCESS_MESSAGE = "Customer created." as const;

const optionalCustomerText = (maximum: number) => z.string().trim().max(maximum);

export const createCustomerSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the customer's name.").max(160),
  email: optionalCustomerText(320).refine(
    (value) => !value || z.string().email().safeParse(value).success,
    "Enter a valid email address.",
  ),
  phone: optionalCustomerText(40),
  address: optionalCustomerText(500),
  birthday: z.string().trim().date().or(z.literal("")),
  notes: optionalCustomerText(1000),
  loyaltyCardCode: optionalCustomerText(80).refine(
    (value) => !value || value.length >= 3,
    "Enter at least 3 characters for the loyalty card.",
  ),
});

export type CreateCustomerValues = z.infer<typeof createCustomerSchema>;

export type PosCustomerCreationResult =
  | {
      ok: true;
      message: string;
      data: {
        id: string;
        customerNumber: number;
        loyaltyCardCode: string;
        fullName: string;
        phone: string | null;
        email: string | null;
        loyaltyPoints: number;
      };
    }
  | { ok: false; message: string };

export type CustomerCreationDatabaseRow = {
  id: string;
  customer_number: number;
  loyalty_card_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};
