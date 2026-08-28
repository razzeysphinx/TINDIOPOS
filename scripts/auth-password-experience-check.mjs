import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [authForm, authSchema, authActions] = await Promise.all([
  source("../src/features/auth/auth-form.tsx"),
  source("../src/features/auth/auth-schema.ts"),
  source("../src/features/auth/actions.ts"),
]);

test("password fields provide an accessible visibility toggle", () => {
  assert.match(authForm, /function PasswordInput\(/);
  assert.match(authForm, /type=\{isVisible \? "text" : "password"\}/);
  assert.match(authForm, /aria-label=\{`\$\{isVisible \? "Hide" : "Show"\} \$\{fieldLabel\}`\}/);
  assert.match(authForm, /aria-pressed=\{isVisible\}/);
  assert.match(authForm, /type="button"/);
  assert.match(authForm, /<Eye aria-hidden="true" \/>/);
  assert.match(authForm, /<EyeOff aria-hidden="true" \/>/);
});

test("signup requires and validates a matching password confirmation before Supabase signup", () => {
  assert.match(authForm, /id="confirmPassword"/);
  assert.match(authForm, /name="confirmPassword"/);
  assert.match(authSchema, /confirmPassword: z/);
  assert.match(authSchema, /Confirm your password\./);
  assert.match(authSchema, /password === confirmPassword/);
  assert.match(authSchema, /Passwords do not match\./);
  assert.match(authSchema, /path: \["confirmPassword"\]/);
  assert.match(authActions, /confirmPassword: formData\.get\("confirmPassword"\)/);

  const signUpCall = authActions.slice(
    authActions.indexOf("const { data, error } = await supabase.auth.signUp"),
    authActions.indexOf("if (error)", authActions.indexOf("const { data, error } = await supabase.auth.signUp")),
  );
  assert.doesNotMatch(signUpCall, /confirmPassword/);
});

test("signup gives immediate mismatch and match feedback while confirmation is typed", () => {
  assert.match(authForm, /const \[password, setPassword\] = useState\(""\)/);
  assert.match(authForm, /const \[confirmPassword, setConfirmPassword\] = useState\(""\)/);
  assert.match(authForm, /const passwordsMatch = hasPasswordConfirmation && password === confirmPassword/);
  assert.match(authForm, /\? "Passwords do not match\."/);
  assert.match(authForm, /success=\{passwordsMatch \? "Passwords match\." : undefined\}/);
  assert.match(authForm, /isValid=\{passwordsMatch\}/);
  assert.match(authForm, /setPassword\(event\.target\.value\)/);
  assert.match(authForm, /setConfirmPassword\(event\.target\.value\)/);
  assert.match(authForm, /border-emerald-600/);
  assert.match(authForm, /text-emerald-600/);
});
