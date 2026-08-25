import "server-only";

import { createHash, randomBytes } from "node:crypto";

export function createCustomerDisplayToken() {
  return randomBytes(32).toString("base64url");
}

export function createCustomerDisplayRealtimeTopic() {
  return randomBytes(32).toString("base64url");
}

export function hashCustomerDisplayToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
