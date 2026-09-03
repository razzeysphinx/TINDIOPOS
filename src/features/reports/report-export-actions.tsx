"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Download, FileSpreadsheet, LoaderCircle, Printer } from "lucide-react";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CsvExport = {
  id: "sales" | "inventory" | "employees" | "payments" | "registers" | "customers" | "security";
  label: string;
};

const csvExports: CsvExport[] = [
  { id: "sales", label: "Sales" },
  { id: "inventory", label: "Inventory" },
  { id: "employees", label: "Employees" },
  { id: "payments", label: "Payments" },
  { id: "registers", label: "Registers" },
  { id: "customers", label: "Customers" },
  { id: "security", label: "Security / audit log" },
];

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

function MenuSurface({ children }: { children: React.ReactNode }) {
  return (
    <Menu.Portal>
      <Menu.Positioner align="end" side="bottom" sideOffset={8}>
        <Menu.Popup className="z-50 min-w-60 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

const menuItemClassName = "flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/**
 * Presentation only: the existing report export route remains responsible for
 * validating permissions, dates, and store scope before returning any data.
 */
export function ReportExportActions({ exportQuery }: { exportQuery: string }) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function exportCsv(item: CsvExport) {
    if (busyAction === item.id) return;

    setBusyAction(item.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/reports/export?${exportQuery}&kind=${item.id}`, {
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`Report export failed with ${response.status}.`);
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filenameFromDisposition(
        response.headers.get("Content-Disposition"),
        `tindio-${item.id}-report.csv`,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("TINDIO report CSV export failed.", error);
      setMessage("We couldn't export this CSV. Your report filters are unchanged.");
    } finally {
      setBusyAction(null);
    }
  }

  function printReport() {
    if (busyAction === "print") return;

    setBusyAction("print");
    setMessage(null);
    const previousTitle = document.title;
    const cleanup = () => {
      document.body.removeAttribute("data-print-mode");
      document.title = previousTitle;
      setBusyAction((current) => current === "print" ? null : current);
    };

    try {
      document.body.dataset.printMode = "report";
      document.title = "TINDIO business report";
      window.addEventListener("afterprint", cleanup, { once: true });
      window.print();
      window.setTimeout(cleanup, 1000);
    } catch (error) {
      console.error("TINDIO report print failed.", error);
      cleanup();
      setMessage("We couldn't open the print dialog. Nothing was changed. Try again.");
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-2" data-print-hide>
      <Menu.Root modal={false}>
        <Menu.Trigger className={cn(buttonVariants({ size: "sm", variant: "outline" }), "min-w-0")}> 
          <Printer aria-hidden="true" />
          <span>Print / PDF</span>
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </Menu.Trigger>
        <MenuSurface>
          <Menu.Group>
            <Menu.GroupLabel className="px-2.5 pb-1 pt-1.5 text-[0.68rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Business report
            </Menu.GroupLabel>
            <Menu.Item
              className={menuItemClassName}
              closeOnClick={false}
              disabled={busyAction === "print"}
              onClick={printReport}
            >
              {busyAction === "print" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Printer aria-hidden="true" className="size-4" />}
              <span>{busyAction === "print" ? "Opening print dialog…" : "Print current report"}</span>
            </Menu.Item>
          </Menu.Group>
          <p className="border-t px-2.5 py-2 text-xs leading-5 text-muted-foreground">
            A readable report using the current date and store filters. Choose “Save as PDF” in your system print dialog if needed.
          </p>
        </MenuSurface>
      </Menu.Root>

      <Menu.Root modal={false}>
        <Menu.Trigger className={cn(buttonVariants({ size: "sm", variant: "outline" }), "min-w-0")}> 
          <FileSpreadsheet aria-hidden="true" />
          <span>Export CSV</span>
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </Menu.Trigger>
        <MenuSurface>
          <Menu.Group>
            <Menu.GroupLabel className="px-2.5 pb-1 pt-1.5 text-[0.68rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Raw data for spreadsheets
            </Menu.GroupLabel>
            {csvExports.map((item) => {
              const isBusy = busyAction === item.id;
              return (
                <Menu.Item
                  className={menuItemClassName}
                  closeOnClick={false}
                  disabled={isBusy}
                  key={item.id}
                  onClick={() => void exportCsv(item)}
                >
                  {isBusy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Download aria-hidden="true" className="size-4" />}
                  <span>{isBusy ? `Preparing ${item.label} CSV…` : item.label}</span>
                </Menu.Item>
              );
            })}
          </Menu.Group>
        </MenuSurface>
      </Menu.Root>

      <p aria-live="polite" className="basis-full text-sm text-destructive" role="status">
        {message}
      </p>
    </div>
  );
}
