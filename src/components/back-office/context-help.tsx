"use client";

import { Popover } from "@base-ui/react/popover";
import { CircleHelp, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const contextHelpOpenEvent = "tindio:context-help-open";

function hasMeaningfulContent(content: ReactNode) {
  return typeof content === "string" ? content.trim().length > 0 : Boolean(content);
}

function helpTitle(label: string) {
  return label.replace(/^what is\s+/i, "").replace(/\?$/, "").trim();
}

/**
 * Short, optional explanations for business concepts. The text deliberately
 * stays beside the feature that needs it instead of sending a new user to a
 * separate documentation area.
 */
export function ContextHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const contentIsMeaningful = hasMeaningfulContent(children);
  const title = helpTitle(label) || "Help";
  const accessibleLabel = /^what is\s+/i.test(label) ? label : `What is ${title}?`;

  useEffect(() => {
    const closeWhenAnotherHelpOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };

    window.addEventListener(contextHelpOpenEvent, closeWhenAnotherHelpOpens);
    return () => window.removeEventListener(contextHelpOpenEvent, closeWhenAnotherHelpOpens);
  }, [id]);

  if (!contentIsMeaningful) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Contextual help for "${label}" was not rendered because it has no explanation.`);
    }
    return null;
  }

  const openHelp = () => {
    window.dispatchEvent(new CustomEvent(contextHelpOpenEvent, { detail: id }));
    setOpen(true);
  };

  return (
    <Popover.Root
      modal={false}
      onOpenChange={(nextOpen) => {
        if (nextOpen) openHelp();
        else setOpen(false);
      }}
      open={open}
    >
      <Popover.Trigger
        aria-label={accessibleLabel}
        className="-m-1 inline-grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        delay={150}
        onFocus={openHelp}
        openOnHover
        type="button"
      >
        <CircleHelp aria-hidden="true" className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start" side="top" sideOffset={8}>
          <Popover.Popup
            className={cn(
              "z-[100] w-[min(18rem,calc(100vw-2rem))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none",
              "origin-[var(--transform-origin)] transition data-ending-style:scale-95 data-ending-style:opacity-0",
            )}
            initialFocus={false}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Popover.Title className="text-sm font-semibold">{title}</Popover.Title>
                <Popover.Description className="mt-1 text-sm leading-5 text-muted-foreground">
                  {children}
                </Popover.Description>
              </div>
              <Popover.Close
                aria-label={`Close help for ${title}`}
                className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
              </Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
