"use client";

import { Download, LoaderCircle, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importCustomersCsvAction } from "@/features/customers/actions";
import { customerCsvTemplate, parseCustomerCsv, type CustomerCsvPreviewRow } from "@/features/customers/customer-csv";

function downloadTemplate() {
  const blob = new Blob([customerCsvTemplate()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tindio-customers-import-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CustomerCsvTools() {
  const router = useRouter();
  const [rows, setRows] = useState<CustomerCsvPreviewRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [filename, setFilename] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function chooseFile(file: File | undefined) {
    setRows([]); setErrors([]); setResult(null); setFilename(file?.name ?? "");
    if (!file) return;
    if (file.size > 1024 * 1024) { setErrors(["Choose a CSV file smaller than 1 MB."]); return; }
    const parsed = parseCustomerCsv(await file.text());
    if (!parsed.ok) { setErrors(parsed.errors); return; }
    setRows(parsed.rows);
  }

  function confirmImport() {
    setResult(null);
    startTransition(async () => {
      const next = await importCustomersCsvAction({ rows });
      setResult(next.message);
      if (next.ok) { setRows([]); setFilename(""); router.refresh(); }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer CSV</CardTitle>
        <CardDescription>Download the exact template, validate the preview, then confirm one all-or-nothing CRM import. Matching email, phone, or loyalty card records are never overwritten.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-64 flex-1 gap-2"><Label htmlFor="customer-csv-file">Import customers</Label><Input accept=".csv,text/csv" id="customer-csv-file" onChange={(event) => void chooseFile(event.target.files?.[0])} type="file" /></div>
          <Button onClick={downloadTemplate} type="button" variant="outline"><Download /> Template</Button>
          <Button nativeButton={false} render={<a href="/api/customers/export" />} type="button" variant="outline"><Download /> Export customers</Button>
        </div>
        {errors.length ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-medium">Fix the CSV before importing.</p><ul className="mt-1 list-disc space-y-1 pl-5">{errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}</ul>{errors.length > 5 ? <p className="mt-2">Plus {errors.length - 5} more error(s).</p> : null}</div> : null}
        {rows.length ? <div className="overflow-hidden rounded-lg border"><div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-sm"><span>{filename || "CSV preview"}: {rows.length} valid customer{rows.length === 1 ? "" : "s"}</span><Button disabled={isPending} onClick={confirmImport} size="sm" type="button">{isPending ? <LoaderCircle className="animate-spin" /> : <Upload />} Confirm import</Button></div><div className="max-h-64 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-background text-muted-foreground"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Phone</th></tr></thead><tbody>{rows.slice(0, 20).map((row) => <tr className="border-t" key={row.rowNumber}><td className="px-3 py-2">{row.rowNumber}</td><td className="px-3 py-2 font-medium">{row.fullName}</td><td className="px-3 py-2">{row.email || "—"}</td><td className="px-3 py-2">{row.phone || "—"}</td></tr>)}</tbody></table></div>{rows.length > 20 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 20 rows of the validated preview.</p> : null}</div> : null}
        {result ? <p aria-live="polite" className="text-sm text-muted-foreground">{result}</p> : null}
      </CardContent>
    </Card>
  );
}
