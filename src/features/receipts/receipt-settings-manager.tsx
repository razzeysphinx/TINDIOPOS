"use client";

import { LoaderCircle, Save } from "lucide-react";
import { type ReactNode, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateReceiptSettingsAction } from "@/features/receipts/improvement-6-actions";
import type { ReceiptSettingsValues } from "@/features/receipts/improvement-6-schema";

type ReceiptLayoutValues = Pick<
  ReceiptSettingsValues,
  | "paperWidthMm"
  | "showStoreAddress"
  | "showStorePhone"
  | "showCashier"
  | "showRegister"
  | "showPaymentDetails"
>;

const receiptLayoutPresets = [
  {
    id: "essential",
    title: "Essential",
    description: "Compact 58 mm receipt with the key sale details.",
    values: {
      paperWidthMm: 58,
      showStoreAddress: false,
      showStorePhone: false,
      showCashier: false,
      showRegister: true,
      showPaymentDetails: true,
    },
  },
  {
    id: "standard",
    title: "Standard",
    description: "Balanced 80 mm receipt for most counter sales.",
    values: {
      paperWidthMm: 80,
      showStoreAddress: true,
      showStorePhone: false,
      showCashier: true,
      showRegister: true,
      showPaymentDetails: true,
    },
  },
  {
    id: "detailed",
    title: "Detailed",
    description: "80 mm receipt with complete store and sale context.",
    values: {
      paperWidthMm: 80,
      showStoreAddress: true,
      showStorePhone: true,
      showCashier: true,
      showRegister: true,
      showPaymentDetails: true,
    },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  values: ReceiptLayoutValues;
}>;

export function ReceiptSettingsManager({
  canManage,
  initialSettings,
}: {
  canManage: boolean;
  initialSettings: ReceiptSettingsValues;
}) {
  const [values, setValues] = useState(initialSettings);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const updateText = (field: Exclude<keyof ReceiptSettingsValues, "paperWidthMm" | "showStoreAddress" | "showStorePhone" | "showCashier" | "showRegister" | "showPaymentDetails">, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const updateToggle = (field: "showStoreAddress" | "showStorePhone" | "showCashier" | "showRegister" | "showPaymentDetails", value: boolean) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receipt business information and layout</CardTitle>
        <CardDescription>
          These values are captured on every new receipt. Saving changes never rewrites a completed sale or a previously issued receipt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            startTransition(async () => {
              const result = await updateReceiptSettingsAction(values);
              setMessage(result.message);
            });
          }}
        >
          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Business name" required>
              <Input disabled={!canManage || isPending} maxLength={160} onChange={(event) => updateText("businessName", event.target.value)} value={values.businessName} />
            </Field>
            <Field label="Tax ID / TIN">
              <Input disabled={!canManage || isPending} maxLength={80} onChange={(event) => updateText("businessTaxId", event.target.value)} value={values.businessTaxId} />
            </Field>
            <Field label="Business address">
              <Input disabled={!canManage || isPending} maxLength={500} onChange={(event) => updateText("businessAddress", event.target.value)} value={values.businessAddress} />
            </Field>
            <Field label="Business phone">
              <Input disabled={!canManage || isPending} maxLength={40} onChange={(event) => updateText("businessPhone", event.target.value)} value={values.businessPhone} />
            </Field>
            <Field label="Business email">
              <Input disabled={!canManage || isPending} maxLength={320} onChange={(event) => updateText("businessEmail", event.target.value)} type="email" value={values.businessEmail} />
            </Field>
            <Field label="Business website">
              <Input disabled={!canManage || isPending} maxLength={2048} onChange={(event) => updateText("businessWebsite", event.target.value)} value={values.businessWebsite} />
            </Field>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Header message">
              <Input disabled={!canManage || isPending} maxLength={160} onChange={(event) => updateText("headerMessage", event.target.value)} placeholder="Optional welcome or legal line" value={values.headerMessage} />
            </Field>
            <Field label="Footer message" required>
              <Input disabled={!canManage || isPending} maxLength={240} onChange={(event) => updateText("footerMessage", event.target.value)} value={values.footerMessage} />
            </Field>
          </section>

          <section className="rounded-lg border p-4" aria-labelledby="receipt-layout-presets-title">
            <p className="text-sm font-semibold" id="receipt-layout-presets-title">Layout presets</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Choose a starting layout, then refine it below. A preset changes only this form;
              save to apply it to future receipts.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {receiptLayoutPresets.map((preset) => (
                <Button
                  className="h-auto items-start justify-start whitespace-normal px-4 py-3 text-left"
                  disabled={!canManage || isPending}
                  key={preset.id}
                  onClick={() => {
                    setValues((current) => ({ ...current, ...preset.values }));
                    setMessage(`${preset.title} layout selected. Save receipt settings to apply it.`);
                  }}
                  type="button"
                  variant="outline"
                >
                  <span>
                    <span className="block font-semibold">{preset.title}</span>
                    <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                      {preset.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-semibold">Print layout</p>
            <label className="grid gap-1.5 text-sm font-medium sm:max-w-52">
              Paper width
              <select
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                disabled={!canManage || isPending}
                onChange={(event) => setValues((current) => ({ ...current, paperWidthMm: Number(event.target.value) as 58 | 80 }))}
                value={values.paperWidthMm}
              >
                <option value={80}>80 mm</option>
                <option value={58}>58 mm</option>
              </select>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle checked={values.showStoreAddress} disabled={!canManage || isPending} label="Show store address" onChange={(checked) => updateToggle("showStoreAddress", checked)} />
              <Toggle checked={values.showStorePhone} disabled={!canManage || isPending} label="Show store phone" onChange={(checked) => updateToggle("showStorePhone", checked)} />
              <Toggle checked={values.showRegister} disabled={!canManage || isPending} label="Show register" onChange={(checked) => updateToggle("showRegister", checked)} />
              <Toggle checked={values.showCashier} disabled={!canManage || isPending} label="Show cashier" onChange={(checked) => updateToggle("showCashier", checked)} />
              <Toggle checked={values.showPaymentDetails} disabled={!canManage || isPending} label="Show payment breakdown" onChange={(checked) => updateToggle("showPaymentDetails", checked)} />
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canManage || isPending} type="submit">
              {isPending ? <LoaderCircle className="animate-spin" /> : <Save />}
              Save receipt settings
            </Button>
            {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  children,
  label,
  required = false,
}: {
  children: ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <Label className="grid gap-1.5">
      <span>{label}{required ? " *" : ""}</span>
      {children}
    </Label>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Label className="cursor-pointer rounded-md border px-3 py-2.5 text-sm">
      <input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {label}
    </Label>
  );
}
