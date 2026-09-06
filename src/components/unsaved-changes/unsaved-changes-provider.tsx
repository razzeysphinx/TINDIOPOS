"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type UnsavedChangesCopy = {
  description?: string;
  leaveLabel?: string;
  stayLabel?: string;
  title?: string;
};

type RegisteredChanges = {
  copy?: UnsavedChangesCopy;
  isDirty: boolean;
  isSaving: boolean;
  onSave?: () => Promise<boolean | void>;
};

type PendingIntent = {
  preserveHistoryGuard?: boolean;
  proceed: () => void;
};

type UnsavedChangesContextValue = {
  register: (id: string, entry: RegisteredChanges) => () => void;
  requestNavigation: (proceed: () => void, options?: { preserveHistoryGuard?: boolean }) => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

const defaultCopy: Required<UnsavedChangesCopy> = {
  title: "Discard unsaved changes?",
  description: "You have changes that have not been saved. Leaving now will discard them.",
  stayLabel: "Stay on this page",
  leaveLabel: "Leave without saving",
};

/**
 * One Back Office boundary for drafts that have not reached the server yet.
 *
 * Registered forms are protected from ordinary in-app links, browser refresh
 * and close, and browser Back while the current route remains mounted. The
 * hook below is also used for non-link context switches and dialog closes.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [registrations, setRegistrations] = useState<Map<string, RegisteredChanges>>(() => new Map());
  const registrationsRef = useRef(registrations);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const [isSavingAndLeaving, setIsSavingAndLeaving] = useState(false);
  const historyGuardArmed = useRef(false);
  const preserveHistoryGuardAfterLeave = useRef(false);
  const restoringHistoryGuard = useRef(false);
  const allowHistoryLeave = useRef(false);

  const activeChanges = useMemo(
    () => [...registrations.values()].find((entry) => entry.isDirty) ?? null,
    [registrations],
  );
  const hasUnsavedChanges = activeChanges !== null;
  const isSaving = activeChanges?.isSaving === true || isSavingAndLeaving;
  const copy = { ...defaultCopy, ...(activeChanges?.copy ?? {}) };

  useEffect(() => {
    registrationsRef.current = registrations;
  }, [registrations]);

  const register = useCallback((id: string, entry: RegisteredChanges) => {
    setRegistrations((current) => {
      const next = new Map(current);
      next.set(id, entry);
      return next;
    });

    return () => {
      setRegistrations((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };
  }, [setRegistrations]);

  const requestNavigation = useCallback((proceed: () => void, options?: { preserveHistoryGuard?: boolean }) => {
    const current = [...registrationsRef.current.values()].find((entry) => entry.isDirty);
    if (!current) {
      proceed();
      return true;
    }

    setPendingIntent({ preserveHistoryGuard: options?.preserveHistoryGuard, proceed });
    return false;
  }, [setPendingIntent]);

  const dismissConfirmation = useCallback(() => {
    if (isSavingAndLeaving) return;
    setPendingIntent(null);
  }, [isSavingAndLeaving, setPendingIntent]);

  const leaveWithoutSaving = useCallback(() => {
    if (isSaving) return;
    const intent = pendingIntent;
    setPendingIntent(null);
    preserveHistoryGuardAfterLeave.current = intent?.preserveHistoryGuard === true;
    intent?.proceed();
  }, [isSaving, pendingIntent, setPendingIntent]);

  const saveAndContinue = useCallback(async () => {
    const current = [...registrationsRef.current.values()].find((entry) => entry.isDirty);
    const intent = pendingIntent;
    if (!current?.onSave || !intent || isSaving) return;

    setIsSavingAndLeaving(true);
    try {
      const result = await current.onSave();
      if (result === false) return;
      setPendingIntent(null);
      preserveHistoryGuardAfterLeave.current = intent.preserveHistoryGuard === true;
      intent.proceed();
    } finally {
      setIsSavingAndLeaving(false);
    }
  }, [isSaving, pendingIntent, setIsSavingAndLeaving, setPendingIntent]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!hasUnsavedChanges || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.protocol !== window.location.protocol) return;
      if (destination.href === window.location.href) return;

      event.preventDefault();
      event.stopPropagation();
      requestNavigation(
        () => router.push(`${destination.pathname}${destination.search}${destination.hash}`),
        { preserveHistoryGuard: true },
      );
    };

    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [hasUnsavedChanges, requestNavigation, router]);

  useEffect(() => {
    if (!hasUnsavedChanges || historyGuardArmed.current) return;

    window.history.pushState(
      { ...(window.history.state ?? {}), __tindioUnsavedChangesGuard: true },
      "",
      window.location.href,
    );
    historyGuardArmed.current = true;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (hasUnsavedChanges || !historyGuardArmed.current) return;

    if (preserveHistoryGuardAfterLeave.current) {
      preserveHistoryGuardAfterLeave.current = false;
      historyGuardArmed.current = false;
      return;
    }

    restoringHistoryGuard.current = true;
    window.history.back();
    historyGuardArmed.current = false;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const onPopState = () => {
      if (!historyGuardArmed.current) return;
      if (allowHistoryLeave.current) {
        allowHistoryLeave.current = false;
        return;
      }
      if (restoringHistoryGuard.current) {
        restoringHistoryGuard.current = false;
        return;
      }
      if (!hasUnsavedChanges) return;

      restoringHistoryGuard.current = true;
      window.history.go(1);
      requestNavigation(() => {
        allowHistoryLeave.current = true;
        window.history.go(-2);
      }, { preserveHistoryGuard: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [hasUnsavedChanges, requestNavigation]);

  const contextValue = useMemo<UnsavedChangesContextValue>(() => ({ register, requestNavigation }), [register, requestNavigation]);
  const hasSaveAndContinue = Boolean(activeChanges?.onSave) && !isSaving;

  return (
    <UnsavedChangesContext.Provider value={contextValue}>
      {children}
      <Dialog.Root onOpenChange={(open) => { if (!open) dismissConfirmation(); }} open={pendingIntent !== null}>
        <DialogContent closeLabel="Stay on this page" showCloseButton={!isSaving}>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
                {isSaving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <AlertTriangle aria-hidden="true" className="size-4" />}
              </span>
              <div>
                <DialogTitle>{isSaving ? "Saving changes" : copy.title}</DialogTitle>
                <DialogDescription>{isSaving ? "Please wait until your changes finish saving before leaving this page." : copy.description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">Your entered values will remain here if you choose to stay.</p>
          </DialogBody>
          <DialogFooter className="justify-end border-t px-4 py-4 sm:px-6">
            <Button disabled={isSaving} onClick={dismissConfirmation} type="button" variant="outline">{copy.stayLabel}</Button>
            {hasSaveAndContinue ? <Button disabled={isSaving} onClick={() => { void saveAndContinue(); }} type="button">Save and continue</Button> : null}
            <Button disabled={isSaving} onClick={leaveWithoutSaving} type="button" variant="destructive">{copy.leaveLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog.Root>
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges({
  copy,
  isDirty,
  isSaving = false,
  onSave,
}: RegisteredChanges) {
  const context = useContext(UnsavedChangesContext);
  const id = useId();

  if (!context) {
    throw new Error("useUnsavedChanges must be used inside UnsavedChangesProvider.");
  }

  const copyTitle = copy?.title;
  const copyDescription = copy?.description;
  const copyStayLabel = copy?.stayLabel;
  const copyLeaveLabel = copy?.leaveLabel;
  const hasCopy = copy !== undefined;
  const stableCopy = useMemo(
    () => hasCopy ? { title: copyTitle, description: copyDescription, stayLabel: copyStayLabel, leaveLabel: copyLeaveLabel } : undefined,
    [copyDescription, copyLeaveLabel, copyStayLabel, copyTitle, hasCopy],
  );
  const registration = useMemo(
    () => ({ copy: stableCopy, isDirty, isSaving, onSave }),
    [isDirty, isSaving, onSave, stableCopy],
  );

  useEffect(() => {
    return context.register(id, registration);
  }, [context, id, registration]);

  return { requestNavigation: context.requestNavigation };
}
