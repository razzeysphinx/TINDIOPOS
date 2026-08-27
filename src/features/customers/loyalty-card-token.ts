import "server-only";

import { randomBytes } from "node:crypto";

export function createLoyaltyCardVerificationToken() {
  return randomBytes(32).toString("hex");
}

export function createLoyaltyCardCode() {
  return `TND-LY-${randomBytes(5).toString("hex").toUpperCase()}`;
}
