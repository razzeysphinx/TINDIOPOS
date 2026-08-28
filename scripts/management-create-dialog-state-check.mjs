import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const forms = await readFile(
  new URL("../src/features/management/management-forms.tsx", import.meta.url),
  "utf8",
);

function componentSource(name, nextName) {
  const start = forms.indexOf(`export function ${name}`);
  const end = forms.indexOf(`export function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  return forms.slice(start, end === -1 ? undefined : end);
}

for (const [name, nextName] of [
  ["CreateStoreForm", "CreateRegisterForm"],
  ["CreateRegisterForm", "EditStoreButton"],
]) {
  const source = componentSource(name, nextName);
  assert.match(source, /const resetForm = \(\) => form\.reset\(/, `${name} must reset empty form values`);
  assert.match(source, /const handleOpenChange = \(nextOpen: boolean\) => \{[\s\S]*?if \(nextOpen\) \{[\s\S]*?setResult\(null\);[\s\S]*?resetForm\(\);/, `${name} must clear stale feedback before reopening`);
  assert.match(source, /<Dialog\.Root open=\{open\} onOpenChange=\{handleOpenChange\}>/, `${name} must use the reset handler`);
}

console.log("Create-store and create-register dialogs clear stale feedback on reopen.");
