"use client";

import { Info, MonitorSmartphone, Printer, ScanLine, SunMedium } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  readPosWorkspacePreferences,
  writePosWorkspacePreferences,
  type PosWorkspacePreferences,
} from "@/features/pos/pos-preferences";

const selectClassName = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function PosSettingsWorkspace({ scope }: { scope: string }) {
  const [preferences, setPreferences] = useState<PosWorkspacePreferences>(() => readPosWorkspacePreferences(scope));
  const deviceInfo = typeof navigator === "undefined"
    ? "Browser information is available after the POS loads."
    : `${navigator.platform || "Unknown platform"} · ${navigator.userAgent}`;

  const update = (next: Partial<PosWorkspacePreferences>) => {
    setPreferences((current) => {
      const value = { ...current, ...next };
      writePosWorkspacePreferences(scope, value);
      return value;
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Printer className="size-5" /></span>
          <div><CardTitle>Printer settings</CardTitle><p className="mt-1 text-sm text-muted-foreground">TINDIO uses your connected system printer and the existing immutable receipt layout.</p></div>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.print()} type="button" variant="outline">Open system print dialog</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><ScanLine className="size-5" /></span>
          <div><CardTitle>Barcode scanner / camera</CardTitle><p className="mt-1 text-sm text-muted-foreground">Keyboard-mode scanners work with the existing POS search field. Camera scanning is not configured on this device.</p></div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={() => update({ scannerEnabled: !preferences.scannerEnabled })} type="button" variant={preferences.scannerEnabled ? "secondary" : "outline"}>
            {preferences.scannerEnabled ? "Keyboard scanner enabled" : "Keyboard scanner disabled"}
          </Button>
          <Badge variant="outline">Camera: no configured scanner</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><SunMedium className="size-5" /></span>
          <div><CardTitle>Appearance and item layout</CardTitle><p className="mt-1 text-sm text-muted-foreground">These device preferences affect only how the POS workspace is presented.</p></div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">Appearance
            <select className={selectClassName} onChange={(event) => update({ appearance: event.target.value as PosWorkspacePreferences["appearance"] })} value={preferences.appearance}>
              <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">Item layout
            <select className={selectClassName} onChange={(event) => update({ itemLayout: event.target.value as PosWorkspacePreferences["itemLayout"] })} value={preferences.itemLayout}>
              <option value="grid">Grid</option><option value="list">List</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Language
            <select className={selectClassName} onChange={(event) => update({ language: event.target.value })} value={preferences.language}>
              <option value="en-PH">English (Philippines)</option>
            </select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><MonitorSmartphone className="size-5" /></span>
          <div><CardTitle>Device information</CardTitle><p className="mt-1 text-sm text-muted-foreground">This identifies the browser environment only; register/device administration remains in Back Office.</p></div>
        </CardHeader>
        <CardContent><p className="break-all text-xs leading-5 text-muted-foreground" suppressHydrationWarning>{deviceInfo}</p><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Info className="size-3.5" /> No tax, payment, receipt-layout, inventory, people, or business configuration is available here.</p></CardContent>
      </Card>
    </div>
  );
}
