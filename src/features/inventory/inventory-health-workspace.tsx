"use client";

import { AlertTriangle, ArrowRight, CircleAlert, CircleCheck, Info, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type InventoryHealthSeverity = "critical" | "warning" | "information";
export type InventoryHealthIssue = {
  detail: string;
  href: string;
  id: string;
  itemName: string;
  issueType: string;
  severity: InventoryHealthSeverity;
  storeId: string | null;
  storeName: string;
};

export type InventoryHealthStoreSummary = {
  href: string;
  inStockCount: number;
  inTransitCount: number;
  lowStockCount: number;
  name: string;
  negativeStockCount: number;
  outOfStockCount: number;
  storeId: string;
};

export type InventoryOverviewMetric = {
  description: string;
  href: string;
  label: string;
  value: number | string;
};

export type InventoryHealthTransfer = {
  href: string;
  id: string;
  label: string;
  remainingQuantity: number;
  route: string;
  status: string;
};

const selectClassName = "h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function InventoryControlTower({ healthHref, issues, overviewMetrics, recentActivity, stores, transfers, transfersHref }: {
  healthHref: string;
  issues: InventoryHealthIssue[];
  overviewMetrics: InventoryOverviewMetric[];
  recentActivity: Array<{ href: string | null; id: string; label: string; quantityDelta: number; storeName: string }>;
  stores: InventoryHealthStoreSummary[];
  transfers: InventoryHealthTransfer[];
  transfersHref: string;
}) {
  const critical = issues.filter((issue) => issue.severity === "critical").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const stale = issues.filter((issue) => issue.issueType === "Stale physical count" || issue.issueType === "Never physically counted").length;

  return <section aria-labelledby="inventory-control-tower-title" className="space-y-4">
    <div><h2 className="text-lg font-semibold" id="inventory-control-tower-title">Inventory overview</h2><p className="mt-1 text-sm text-muted-foreground">Start with current stock positions, inbound documents, and attention signals before opening detailed records.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{overviewMetrics.map((metric) => <TowerMetric description={metric.description} href={metric.href} key={metric.label} label={metric.label} value={metric.value} />)}</div>
    <div><h3 className="text-lg font-semibold">Needs attention</h3><p className="mt-1 text-sm text-muted-foreground">Signals are derived from current stock, completed counts, and open inventory documents.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <TowerMetric href={`${healthHref}&severity=critical`} label="Critical issues" value={critical} />
      <TowerMetric href={`${healthHref}&severity=warning`} label="Warnings" value={warnings} />
      <TowerMetric href={healthHref} label="Count recommended" value={stale} />
      <TowerMetric href={transfersHref} label="Transfers in progress" value={transfers.length} />
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Multi-store stock</CardTitle><CardDescription>Compare the same authorized Stock Levels positions by store. In transit means stock currently headed to that destination.</CardDescription></CardHeader><CardContent>{stores.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[43rem] text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Store</th><th className="px-3 py-2 text-right">In stock</th><th className="px-3 py-2 text-right">Low</th><th className="px-3 py-2 text-right">Out</th><th className="px-3 py-2 text-right">Negative</th><th className="px-3 py-2 text-right">In transit</th></tr></thead><tbody className="divide-y">{stores.map((store) => <tr key={store.storeId}><td className="px-3 py-2 font-medium"><Link className="hover:underline" href={store.href}>{store.name}</Link></td><td className="px-3 py-2 text-right">{store.inStockCount}</td><td className="px-3 py-2 text-right">{store.lowStockCount}</td><td className="px-3 py-2 text-right">{store.outOfStockCount}</td><td className="px-3 py-2 text-right text-destructive">{store.negativeStockCount}</td><td className="px-3 py-2 text-right">{store.inTransitCount}</td></tr>)}</tbody></table></div> : <EmptyState text="No authorized stores are available." />}</CardContent></Card>
      <Card><CardHeader><CardTitle>Transfers in progress</CardTitle><CardDescription>Sent quantities remain separate from destination on-hand stock until received.</CardDescription></CardHeader><CardContent>{transfers.length ? <div className="space-y-2">{transfers.slice(0, 5).map((transfer) => <Link className="flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40" href={transfer.href} key={transfer.id}><span><span className="font-medium">{transfer.label}</span><span className="mt-1 block text-xs text-muted-foreground">{transfer.route} · {formatStatus(transfer.status)} · {formatQuantity(transfer.remainingQuantity)} remaining</span></span><ArrowRight className="size-4 shrink-0" /></Link>)}</div> : <EmptyState text="No stock transfers are currently in progress." />}</CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Recent inventory activity</CardTitle><CardDescription>Read-only movement history explains why current stock changed.</CardDescription></CardHeader><CardContent>{recentActivity.length ? <div className="divide-y rounded-xl border">{recentActivity.slice(0, 6).map((activity) => {
      const content = <><span><span className="font-medium">{activity.label}</span><span className="mt-1 block text-xs text-muted-foreground">{activity.storeName}</span></span><span className={cn("font-semibold", activity.quantityDelta < 0 ? "text-destructive" : "text-primary")}>{activity.quantityDelta > 0 ? "+" : ""}{formatQuantity(activity.quantityDelta)}</span></>;
      return activity.href ? <Link className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40" href={activity.href} key={activity.id}>{content}</Link> : <div className="flex items-center justify-between gap-3 px-3 py-2.5" key={activity.id}>{content}</div>;
    })}</div> : <EmptyState text="No recent inventory activity is available." />}</CardContent></Card>
  </section>;
}

export function InventoryHealthWorkspace({ initialSeverity = "all", issues, stores }: {
  initialSeverity?: InventoryHealthSeverity | "all";
  issues: InventoryHealthIssue[];
  stores: Array<{ id: string; name: string }>;
}) {
  const [search, setSearch] = useState("");
  const [storeId, setStoreId] = useState("all");
  const [severity, setSeverity] = useState<InventoryHealthSeverity | "all">(initialSeverity);
  const [issueType, setIssueType] = useState("all");
  const types = useMemo(() => [...new Set(issues.map((issue) => issue.issueType))].sort(), [issues]);
  const filtered = useMemo(() => issues.filter((issue) => {
    const query = search.trim().toLowerCase();
    return (severity === "all" || issue.severity === severity)
      && (storeId === "all" || issue.storeId === storeId)
      && (issueType === "all" || issue.issueType === issueType)
      && (!query || `${issue.itemName} ${issue.storeName} ${issue.detail} ${issue.issueType}`.toLowerCase().includes(query));
  }), [issueType, issues, search, severity, storeId]);

  return <section aria-labelledby="stock-health-section-title" className="space-y-4">
    <div><h2 className="text-lg font-semibold" id="stock-health-section-title">Stock health details</h2><p className="mt-1 text-sm text-muted-foreground">Review situations that may be wrong or need investigation. This view never changes stock automatically.</p></div>
    <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.4fr)_repeat(3,minmax(0,1fr))_auto]">
      <label className="grid gap-1.5 sm:col-span-2 xl:col-span-1"><span className="text-sm font-medium">Search</span><span className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" onChange={(event) => setSearch(event.target.value)} placeholder="Product, store, or issue" value={search} /></span></label>
      <Filter label="Store" value={storeId} onChange={setStoreId}><option value="all">All stores</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Filter>
      <Filter label="Severity" value={severity} onChange={(value) => setSeverity(value as InventoryHealthSeverity | "all")}><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="information">Information</option></Filter>
      <Filter label="Issue type" value={issueType} onChange={setIssueType}><option value="all">All issue types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</Filter>
      <div className="flex items-end"><Button disabled={!search && storeId === "all" && severity === "all" && issueType === "all"} onClick={() => { setSearch(""); setStoreId("all"); setSeverity("all"); setIssueType("all"); }} type="button" variant="outline">Clear</Button></div>
    </div>
    <div className="space-y-4">{(["critical", "warning", "information"] as const).map((level) => {
      const sectionIssues = filtered.filter((issue) => issue.severity === level);
      if (!sectionIssues.length) return null;
      const Icon = level === "critical" ? CircleAlert : level === "warning" ? AlertTriangle : Info;
      return <section key={level}><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide"><Icon className="size-4" />{level}</h3><div className="grid gap-3 lg:grid-cols-2">{sectionIssues.map((issue) => <Link className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring" href={issue.href} key={issue.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{issue.itemName}</p><p className="mt-1 text-xs text-muted-foreground">{issue.storeName} · {issue.issueType}</p></div><Badge variant={level === "critical" ? "destructive" : "outline"}>{level}</Badge></div><p className="mt-3 text-sm text-muted-foreground">{issue.detail}</p><span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">Investigate <ArrowRight className="size-4" /></span></Link>)}</div></section>;
    })}{filtered.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><CircleCheck className="mx-auto size-8 text-primary" /><p className="mt-3 font-medium">No matching stock issues</p><p className="mt-1 text-sm text-muted-foreground">The current filters do not contain an issue that needs investigation.</p></div> : null}</div>
  </section>;
}

function Filter({ children, label, onChange, value }: { children: React.ReactNode; label: string; onChange: (value: string) => void; value: string }) { return <label className="grid gap-1.5"><span className="text-sm font-medium">{label}</span><select className={selectClassName} onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>; }
function TowerMetric({ description, href, label, value }: { description?: string; href: string; label: string; value: number | string }) { return <Link href={href}><Card className="h-full transition-colors hover:border-primary/40"><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p>{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}</CardContent></Card></Link>; }
function EmptyState({ text }: { text: string }) { return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{text}</p>; }
function formatQuantity(value: number) { return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value); }
function formatStatus(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
