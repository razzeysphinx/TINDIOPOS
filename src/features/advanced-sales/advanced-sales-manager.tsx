"use client";

import { Check, LoaderCircle, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { GuardedDeleteDialog } from "@/components/back-office/guarded-delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createDiningOptionAction,
  createDiscountAction,
  createModifierGroupAction,
  createTaxRateAction,
  createTicketTemplateAction,
  updateDiningOptionAction,
  updateDiscountAction,
  updateModifierGroupAction,
  updateTaxRateAction,
  updateTicketTemplateAction,
} from "@/features/advanced-sales/actions";
import type { OrganizationFeatureSettings } from "@/features/business-profile/business-features";

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type ActionResult = { ok: boolean; message: string };
type Discount = { id: string; name: string; type: "percentage" | "fixed_amount"; percentageBps: number | null; amountMinor: number | null; isActive: boolean };
type TaxRate = { id: string; name: string; rateBps: number; isInclusive: boolean; isDefault: boolean; isActive: boolean };
type DiningOption = { id: string; name: string; isDefault: boolean; isActive: boolean };
type TicketTemplate = { id: string; label: string; note: string | null; diningOptionId: string | null; isActive: boolean };
type ModifierGroup = { id: string; name: string; minSelections: number; maxSelections: number; isActive: boolean };

export function AdvancedSalesManager({
  products,
  canManage,
  discounts,
  taxRates,
  diningOptions,
  ticketTemplates,
  modifierGroups,
  features,
}: {
  products: Array<{ id: string; name: string }>;
  canManage: boolean;
  discounts: Discount[];
  taxRates: TaxRate[];
  diningOptions: DiningOption[];
  ticketTemplates: TicketTemplate[];
  modifierGroups: ModifierGroup[];
  features: Pick<OrganizationFeatureSettings, "dining" | "modifiers" | "open_tickets">;
}) {
  if (!canManage) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          You can view advanced sales settings, but product-management access is required to change them.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <DiscountSettings discounts={discounts} />
      <TaxSettings taxRates={taxRates} />
      {features.dining ? <DiningSettings diningOptions={diningOptions} /> : null}
      {features.open_tickets ? <TicketTemplateSettings diningOptions={diningOptions.filter((option) => option.isActive)} ticketTemplates={ticketTemplates} /> : null}
      {features.modifiers ? <ModifierSettings modifierGroups={modifierGroups} products={products} /> : null}
    </div>
  );
}

function DiscountSettings({ discounts }: { discounts: Discount[] }) {
  return (
    <SettingsCard description="Apply controlled percentage or fixed-amount reductions at checkout." title="Discounts" triggerLabel="Add discount">
      <DiscountCreateDialog />
      <ConfigList emptyMessage="No discounts yet." items={discounts} renderItem={(discount) => (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{discount.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {discount.type === "percentage" ? `${((discount.percentageBps ?? 0) / 100).toFixed(2)}%` : `₱${((discount.amountMinor ?? 0) / 100).toFixed(2)}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <StatusBadge active={discount.isActive} />
            <DiscountEditDialog discount={discount} />
            {!discount.isActive ? <GuardedDeleteDialog recordId={discount.id} recordName={discount.name} recordType="discount" /> : null}
          </div>
        </div>
      )} />
    </SettingsCard>
  );
}

function DiscountCreateDialog() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<Discount["type"]>("percentage");
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const next = await createDiscountAction({ name, type, value });
      setResult(next);
      if (next.ok) { setName(""); setValue(""); router.refresh(); }
    });
  };
  return <ConfigDialog description="Create a custom checkout discount." title="Add discount" triggerLabel="Add discount"><form className="grid gap-4" onSubmit={submit}><DiscountFields name={name} onNameChange={setName} onTypeChange={setType} onValueChange={setValue} type={type} value={value} /><SubmitRow label="Create discount" pending={pending} result={result} /></form></ConfigDialog>;
}

function DiscountEditDialog({ discount }: { discount: Discount }) {
  const router = useRouter();
  const [name, setName] = useState(discount.name);
  const [type, setType] = useState<Discount["type"]>(discount.type);
  const [value, setValue] = useState(discount.type === "percentage" ? String((discount.percentageBps ?? 0) / 100) : ((discount.amountMinor ?? 0) / 100).toFixed(2));
  const [isActive, setIsActive] = useState(discount.isActive);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await updateDiscountAction({ id: discount.id, name, type, value, isActive }); setResult(next); if (next.ok) router.refresh(); }); };
  return <ConfigDialog description="Edit the discount or archive it without changing historical sales." title={`Edit ${discount.name}`} triggerLabel="Edit" triggerVariant="ghost"><form className="grid gap-4" onSubmit={submit}><DiscountFields name={name} onNameChange={setName} onTypeChange={setType} onValueChange={setValue} type={type} value={value} /><ActiveField active={isActive} onChange={setIsActive} /><SubmitRow label="Save discount" pending={pending} result={result} /></form></ConfigDialog>;
}

function DiscountFields({ name, type, value, onNameChange, onTypeChange, onValueChange }: { name: string; type: Discount["type"]; value: string; onNameChange: (value: string) => void; onTypeChange: (value: Discount["type"]) => void; onValueChange: (value: string) => void }) {
  return <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><Input autoFocus maxLength={100} onChange={(event) => onNameChange(event.target.value)} value={name} /></Field><Field label="Type"><select className={selectClassName} onChange={(event) => onTypeChange(event.target.value as Discount["type"])} value={type}><option value="percentage">Percentage</option><option value="fixed_amount">Fixed amount</option></select></Field><Field label={type === "percentage" ? "Percent" : "Amount"}><Input inputMode="decimal" onChange={(event) => onValueChange(event.target.value)} placeholder={type === "percentage" ? "10" : "100.00"} value={value} /></Field></div>;
}

function TaxSettings({ taxRates }: { taxRates: TaxRate[] }) {
  return <SettingsCard description="Set the rate that applies to new checkout calculations." title="Taxes" triggerLabel="Add tax rate"><TaxCreateDialog /><ConfigList emptyMessage="No tax rates yet." items={taxRates} renderItem={(taxRate) => <div className="flex min-w-0 items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{taxRate.name}</p><p className="mt-1 text-xs text-muted-foreground">{(taxRate.rateBps / 100).toFixed(2)}% · {taxRate.isInclusive ? "Inclusive" : "Added at checkout"}</p></div><div className="flex shrink-0 items-center gap-1">{taxRate.isDefault ? <Badge variant="secondary">Default</Badge> : null}<StatusBadge active={taxRate.isActive} /><TaxEditDialog taxRate={taxRate} />{!taxRate.isActive ? <GuardedDeleteDialog recordId={taxRate.id} recordName={taxRate.name} recordType="tax_rate" /> : null}</div></div>} /></SettingsCard>;
}

function TaxCreateDialog() {
  const router = useRouter(); const [name, setName] = useState(""); const [rate, setRate] = useState(""); const [inclusive, setInclusive] = useState(true); const [isDefault, setIsDefault] = useState(true); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await createTaxRateAction({ name, rate, inclusive, isDefault }); setResult(next); if (next.ok) { setName(""); setRate(""); router.refresh(); } }); };
  return <ConfigDialog description="Create a tax rate for new checkout calculations." title="Add tax rate" triggerLabel="Add tax rate"><form className="grid gap-4" onSubmit={submit}><TaxFields inclusive={inclusive} isDefault={isDefault} name={name} onInclusiveChange={setInclusive} onDefaultChange={setIsDefault} onNameChange={setName} onRateChange={setRate} rate={rate} /><SubmitRow label="Create tax rate" pending={pending} result={result} /></form></ConfigDialog>;
}

function TaxEditDialog({ taxRate }: { taxRate: TaxRate }) {
  const router = useRouter(); const [name, setName] = useState(taxRate.name); const [rate, setRate] = useState(String(taxRate.rateBps / 100)); const [inclusive, setInclusive] = useState(taxRate.isInclusive); const [isDefault, setIsDefault] = useState(taxRate.isDefault); const [isActive, setIsActive] = useState(taxRate.isActive); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await updateTaxRateAction({ id: taxRate.id, name, rate, inclusive, isDefault, isActive }); setResult(next); if (next.ok) router.refresh(); }); };
  return <ConfigDialog description="Edit or archive this rate. Existing sales retain their saved tax values." title={`Edit ${taxRate.name}`} triggerLabel="Edit" triggerVariant="ghost"><form className="grid gap-4" onSubmit={submit}><TaxFields inclusive={inclusive} isDefault={isDefault} name={name} onInclusiveChange={setInclusive} onDefaultChange={setIsDefault} onNameChange={setName} onRateChange={setRate} rate={rate} /><ActiveField active={isActive} onChange={setIsActive} /><SubmitRow label="Save tax rate" pending={pending} result={result} /></form></ConfigDialog>;
}

function TaxFields({ name, rate, inclusive, isDefault, onNameChange, onRateChange, onInclusiveChange, onDefaultChange }: { name: string; rate: string; inclusive: boolean; isDefault: boolean; onNameChange: (value: string) => void; onRateChange: (value: string) => void; onInclusiveChange: (value: boolean) => void; onDefaultChange: (value: boolean) => void }) {
  return <><div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><Input autoFocus maxLength={100} onChange={(event) => onNameChange(event.target.value)} value={name} /></Field><Field label="Rate percent"><Input inputMode="decimal" onChange={(event) => onRateChange(event.target.value)} value={rate} /></Field></div><div className="flex flex-wrap gap-4"><CheckField checked={inclusive} label="Included in product prices" onChange={onInclusiveChange} /><CheckField checked={isDefault} label="Use as default" onChange={onDefaultChange} /></div></>;
}

const diningPresetNames = ["Dine In", "Takeout", "Delivery"] as const;

function DiningSettings({ diningOptions }: { diningOptions: DiningOption[] }) {
  const presetOptionNames = new Set(diningPresetNames.map((name) => name.toLocaleLowerCase()));
  const presetOptions = diningOptions.filter((option) => presetOptionNames.has(option.name.toLocaleLowerCase()));
  const customOptions = diningOptions.filter((option) => !presetOptionNames.has(option.name.toLocaleLowerCase()));
  const hasActiveDefault = diningOptions.some((option) => option.isActive && option.isDefault);

  return <SettingsCard description="Choose the service context that appears on open tickets." title="Dining options" triggerLabel="Add dining option"><DiningCreateDialog /><div className="space-y-5"><ConfigSection description="Start with the most common service options. A preset is added only when that exact option is not already configured." title="TINDIO PRESETS"><div className="grid gap-2 sm:grid-cols-3">{diningPresetNames.map((name) => {
    const option = presetOptions.find((candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    return option ? <div className="rounded-lg border p-3" key={name}><DiningOptionRow option={option} /></div> : <DiningPresetButton defaultWhenAdded={!hasActiveDefault && name === "Dine In"} key={name} name={name} />;
  })}</div></ConfigSection><ConfigSection description="Use the + button above to add a service option unique to your business." title="CUSTOM OPTIONS"><ConfigList emptyMessage="No custom dining options yet." items={customOptions} renderItem={(option) => <DiningOptionRow option={option} />} /></ConfigSection></div></SettingsCard>;
}

function DiningOptionRow({ option }: { option: DiningOption }) {
  return <div className="flex min-w-0 items-center justify-between gap-3"><p className="truncate font-medium">{option.name}</p><div className="flex shrink-0 items-center gap-1">{option.isDefault ? <Badge variant="secondary">Default</Badge> : null}<StatusBadge active={option.isActive} /><DiningEditDialog option={option} />{!option.isActive ? <GuardedDeleteDialog recordId={option.id} recordName={option.name} recordType="dining_option" /> : null}</div></div>;
}

function DiningPresetButton({ name, defaultWhenAdded }: { name: string; defaultWhenAdded: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const addPreset = () => {
    startTransition(async () => {
      const next = await createDiningOptionAction({ name, isDefault: defaultWhenAdded });
      setResult(next);
      if (next.ok) router.refresh();
    });
  };

  return <div className="flex min-h-24 flex-col justify-between rounded-lg border border-dashed p-3"><div><p className="font-medium">{name}</p><p className="mt-1 text-xs text-muted-foreground">{defaultWhenAdded ? "Recommended default" : "TINDIO preset"}</p></div><div className="mt-3"><Button disabled={pending} onClick={addPreset} size="sm" type="button" variant="outline">{pending ? <LoaderCircle className="animate-spin" /> : <Plus />}Add</Button>{result && !result.ok ? <p aria-live="polite" className="mt-2 text-xs text-destructive">{result.message}</p> : null}</div></div>;
}

function DiningCreateDialog() {
  const router = useRouter(); const [name, setName] = useState(""); const [isDefault, setIsDefault] = useState(false); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await createDiningOptionAction({ name, isDefault }); setResult(next); if (next.ok) { setName(""); router.refresh(); } }); };
  return <ConfigDialog description="Create a dining option for tickets and service reporting." title="Add dining option" triggerLabel="Add dining option"><form className="grid gap-4" onSubmit={submit}><Field label="Name"><Input autoFocus maxLength={60} onChange={(event) => setName(event.target.value)} value={name} /></Field><CheckField checked={isDefault} label="Use as default" onChange={setIsDefault} /><SubmitRow label="Create dining option" pending={pending} result={result} /></form></ConfigDialog>;
}

function DiningEditDialog({ option }: { option: DiningOption }) {
  const router = useRouter(); const [name, setName] = useState(option.name); const [isDefault, setIsDefault] = useState(option.isDefault); const [isActive, setIsActive] = useState(option.isActive); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await updateDiningOptionAction({ id: option.id, name, isDefault, isActive }); setResult(next); if (next.ok) router.refresh(); }); };
  return <ConfigDialog description="Edit or archive this dining option. Existing tickets retain their saved value." title={`Edit ${option.name}`} triggerLabel="Edit" triggerVariant="ghost"><form className="grid gap-4" onSubmit={submit}><Field label="Name"><Input autoFocus maxLength={60} onChange={(event) => setName(event.target.value)} value={name} /></Field><CheckField checked={isDefault} label="Use as default" onChange={setIsDefault} /><ActiveField active={isActive} onChange={setIsActive} /><SubmitRow label="Save dining option" pending={pending} result={result} /></form></ConfigDialog>;
}

function TicketTemplateSettings({ diningOptions, ticketTemplates }: { diningOptions: DiningOption[]; ticketTemplates: TicketTemplate[] }) {
  const diningName = new Map(diningOptions.map((option) => [option.id, option.name]));
  return <SettingsCard description="Create reusable labels and notes for open tickets." title="Ticket templates" triggerLabel="Add ticket template"><TicketTemplateCreateDialog diningOptions={diningOptions} /><ConfigList emptyMessage="No ticket templates yet." items={ticketTemplates} renderItem={(template) => <div className="flex min-w-0 items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{template.label}</p><p className="mt-1 truncate text-xs text-muted-foreground">{template.note || diningName.get(template.diningOptionId ?? "") || "No note or dining option"}</p></div><div className="flex shrink-0 items-center gap-1"><StatusBadge active={template.isActive} /><TicketTemplateEditDialog diningOptions={diningOptions} template={template} />{!template.isActive ? <GuardedDeleteDialog recordId={template.id} recordName={template.label} recordType="ticket_template" /> : null}</div></div>} /></SettingsCard>;
}

function TicketTemplateCreateDialog({ diningOptions }: { diningOptions: DiningOption[] }) {
  const router = useRouter(); const [label, setLabel] = useState(""); const [note, setNote] = useState(""); const [diningOptionId, setDiningOptionId] = useState(""); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await createTicketTemplateAction({ label, note, diningOptionId: diningOptionId || null }); setResult(next); if (next.ok) { setLabel(""); setNote(""); setDiningOptionId(""); router.refresh(); } }); };
  return <ConfigDialog description="Create a reusable starting point for an open ticket." title="Add ticket template" triggerLabel="Add ticket template"><form className="grid gap-4" onSubmit={submit}><TicketTemplateFields diningOptionId={diningOptionId} diningOptions={diningOptions} label={label} note={note} onDiningOptionChange={setDiningOptionId} onLabelChange={setLabel} onNoteChange={setNote} /><SubmitRow label="Create template" pending={pending} result={result} /></form></ConfigDialog>;
}

function TicketTemplateEditDialog({ template, diningOptions }: { template: TicketTemplate; diningOptions: DiningOption[] }) {
  const router = useRouter(); const [label, setLabel] = useState(template.label); const [note, setNote] = useState(template.note ?? ""); const [diningOptionId, setDiningOptionId] = useState(template.diningOptionId ?? ""); const [isActive, setIsActive] = useState(template.isActive); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await updateTicketTemplateAction({ id: template.id, label, note, diningOptionId: diningOptionId || null, isActive }); setResult(next); if (next.ok) router.refresh(); }); };
  return <ConfigDialog description="Edit or archive this template. Existing tickets remain unchanged." title={`Edit ${template.label}`} triggerLabel="Edit" triggerVariant="ghost"><form className="grid gap-4" onSubmit={submit}><TicketTemplateFields diningOptionId={diningOptionId} diningOptions={diningOptions} label={label} note={note} onDiningOptionChange={setDiningOptionId} onLabelChange={setLabel} onNoteChange={setNote} /><ActiveField active={isActive} onChange={setIsActive} /><SubmitRow label="Save template" pending={pending} result={result} /></form></ConfigDialog>;
}

function TicketTemplateFields({ label, note, diningOptionId, diningOptions, onLabelChange, onNoteChange, onDiningOptionChange }: { label: string; note: string; diningOptionId: string; diningOptions: DiningOption[]; onLabelChange: (value: string) => void; onNoteChange: (value: string) => void; onDiningOptionChange: (value: string) => void }) {
  return <><Field label="Template label"><Input autoFocus maxLength={100} onChange={(event) => onLabelChange(event.target.value)} value={label} /></Field><Field label="Default note"><textarea className="min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" maxLength={500} onChange={(event) => onNoteChange(event.target.value)} value={note} /></Field><Field label="Dining option"><select className={selectClassName} onChange={(event) => onDiningOptionChange(event.target.value)} value={diningOptionId}><option value="">No dining option</option>{diningOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field></>;
}

function ModifierSettings({ modifierGroups, products }: { modifierGroups: ModifierGroup[]; products: Array<{ id: string; name: string }> }) {
  return <SettingsCard description="Attach choice groups to products without changing completed sales." title="Modifiers" triggerLabel="Add modifier group"><ModifierCreateDialog products={products} /><ConfigList emptyMessage="No modifier groups yet." items={modifierGroups} renderItem={(group) => <div className="flex min-w-0 items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{group.name}</p><p className="mt-1 text-xs text-muted-foreground">{group.minSelections}–{group.maxSelections} selections</p></div><div className="flex shrink-0 items-center gap-1"><StatusBadge active={group.isActive} /><ModifierEditDialog group={group} />{!group.isActive ? <GuardedDeleteDialog recordId={group.id} recordName={group.name} recordType="modifier_group" /> : null}</div></div>} /></SettingsCard>;
}

function ModifierCreateDialog({ products }: { products: Array<{ id: string; name: string }> }) {
  const router = useRouter(); const [name, setName] = useState(""); const [min, setMin] = useState("0"); const [max, setMax] = useState("1"); const [options, setOptions] = useState([{ name: "", price: "0.00" }]); const [productIds, setProductIds] = useState<string[]>([]); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await createModifierGroupAction({ name, min: Number(min), max: Number(max), options, productIds }); setResult(next); if (next.ok) { setName(""); setOptions([{ name: "", price: "0.00" }]); setProductIds([]); router.refresh(); } }); };
  const toggleProduct = (id: string) => setProductIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <ConfigDialog description="Create a modifier group with its initial options and product assignments." size="large" title="Add modifier group" triggerLabel="Add modifier group"><form className="grid gap-4" onSubmit={submit}><ModifierFields max={max} min={min} name={name} onMaxChange={setMax} onMinChange={setMin} onNameChange={setName} /><div><p className="text-sm font-medium">Options</p><div className="mt-2 grid gap-2">{options.map((option, index) => <div className="grid grid-cols-[1fr_8rem] gap-2" key={index}><Input onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Option name" value={option.name} /><Input inputMode="decimal" onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} value={option.price} /></div>)}</div><Button className="mt-2" onClick={() => setOptions((current) => [...current, { name: "", price: "0.00" }])} type="button" variant="outline"><Plus /> Add option</Button></div><fieldset><legend className="text-sm font-medium">Products using this group</legend><div className="mt-2 max-h-36 overflow-auto rounded-lg border p-3">{products.map((product) => <CheckField checked={productIds.includes(product.id)} key={product.id} label={product.name} onChange={() => toggleProduct(product.id)} />)}</div></fieldset><SubmitRow label="Create modifier group" pending={pending} result={result} /></form></ConfigDialog>;
}

function ModifierEditDialog({ group }: { group: ModifierGroup }) {
  const router = useRouter(); const [name, setName] = useState(group.name); const [min, setMin] = useState(String(group.minSelections)); const [max, setMax] = useState(String(group.maxSelections)); const [isActive, setIsActive] = useState(group.isActive); const [result, setResult] = useState<ActionResult | null>(null); const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent) => { event.preventDefault(); startTransition(async () => { const next = await updateModifierGroupAction({ id: group.id, name, min: Number(min), max: Number(max), isActive }); setResult(next); if (next.ok) router.refresh(); }); };
  return <ConfigDialog description="Update group rules or archive it. Existing options and product assignments remain intact." title={`Edit ${group.name}`} triggerLabel="Edit" triggerVariant="ghost"><form className="grid gap-4" onSubmit={submit}><ModifierFields max={max} min={min} name={name} onMaxChange={setMax} onMinChange={setMin} onNameChange={setName} /><ActiveField active={isActive} onChange={setIsActive} /><SubmitRow label="Save modifier group" pending={pending} result={result} /></form></ConfigDialog>;
}

function ModifierFields({ name, min, max, onNameChange, onMinChange, onMaxChange }: { name: string; min: string; max: string; onNameChange: (value: string) => void; onMinChange: (value: string) => void; onMaxChange: (value: string) => void }) {
  return <><Field label="Group name"><Input autoFocus maxLength={100} onChange={(event) => onNameChange(event.target.value)} value={name} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Minimum selections"><Input min="0" onChange={(event) => onMinChange(event.target.value)} type="number" value={min} /></Field><Field label="Maximum selections"><Input min="1" onChange={(event) => onMaxChange(event.target.value)} type="number" value={max} /></Field></div></>;
}

function SettingsCard({ title, description, triggerLabel, children }: { title: string; description: string; triggerLabel: string; children: React.ReactNode }) {
  const childrenArray = Array.isArray(children) ? children : [children];
  return <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div><span className="shrink-0" data-create-action={triggerLabel}>{childrenArray[0]}</span></CardHeader><CardContent>{childrenArray.slice(1)}</CardContent></Card>;
}

function ConfigSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const titleId = `${title.toLowerCase().replaceAll(" ", "-")}-title`;
  return <section aria-labelledby={titleId}><h3 className="text-xs font-bold tracking-[0.14em] text-primary uppercase" id={titleId}>{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p><div className="mt-3">{children}</div></section>;
}

function ConfigList<T>({ items, emptyMessage, renderItem }: { items: T[]; emptyMessage: string; renderItem: (item: T) => React.ReactNode }) {
  return items.length ? <ul className="divide-y rounded-lg border">{items.map((item, index) => <li className="p-3" key={index}>{renderItem(item)}</li>)}</ul> : <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
}

function ConfigDialog({ title, description, triggerLabel, triggerVariant = "outline", size = "default", children }: { title: string; description: string; triggerLabel: string; triggerVariant?: "ghost" | "outline"; size?: "default" | "wide" | "large"; children: React.ReactNode }) {
  const isEditTrigger = triggerVariant === "ghost";
  return <Dialog.Root><DialogTrigger aria-label={triggerLabel} className={buttonVariants({ variant: triggerVariant, size: isEditTrigger ? "sm" : "icon" })} title={triggerLabel}>{isEditTrigger ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}<span className={isEditTrigger ? undefined : "sr-only"}>{triggerLabel}</span></DialogTrigger><DialogContent size={size}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><DialogBody>{children}</DialogBody></DialogContent></Dialog.Root>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label>; }
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center gap-2 text-sm"><input checked={checked} className="size-4 accent-primary" onChange={(event) => onChange(event.target.checked)} type="checkbox" />{label}</label>; }
function ActiveField({ active, onChange }: { active: boolean; onChange: (value: boolean) => void }) { return <CheckField checked={active} label="Active and available for new sales" onChange={onChange} />; }
function StatusBadge({ active }: { active: boolean }) { return <Badge variant={active ? "secondary" : "outline"}>{active ? "Active" : "Archived"}</Badge>; }
function SubmitRow({ label, pending, result }: { label: string; pending: boolean; result: ActionResult | null }) { return <DialogFooter><Button disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : <Check />}{label}</Button>{result ? <p aria-live="polite" className={result.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{result.message}</p> : null}</DialogFooter>; }
