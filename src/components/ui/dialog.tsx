"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const Dialog = {
  Root: DialogPrimitive.Root,
};

function DialogTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger className={className} {...props} />;
}

function DialogContent({
  children,
  className,
  size = "default",
  showCloseButton = true,
  side = "center",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  size?: "default" | "wide" | "large";
  showCloseButton?: boolean;
  side?: "center" | "left" | "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[1px] transition-opacity data-ending-style:opacity-0" />
      <DialogPrimitive.Viewport
        className={cn(
          "fixed inset-0 z-50 flex overflow-y-auto",
          side === "left"
            ? "items-stretch justify-start"
            : side === "right"
              ? "items-stretch justify-end"
              : "items-end justify-center p-3 sm:items-center sm:p-6",
        )}
      >
        <DialogPrimitive.Popup
          className={cn(
            "relative my-auto w-full rounded-xl border bg-background shadow-2xl outline-none transition-all data-ending-style:scale-95 data-ending-style:opacity-0",
            size === "default" && "max-w-lg",
            size === "wide" && "max-w-3xl",
            size === "large" && "max-w-6xl",
            side === "right" && "my-0 h-svh max-w-md rounded-none border-y-0 border-r-0 data-ending-style:translate-x-full",
            side === "left" && "my-0 h-svh max-w-md rounded-none border-y-0 border-l-0 data-ending-style:-translate-x-full",
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton ? (
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "absolute top-3 right-3 text-muted-foreground hover:text-foreground",
              )}
            >
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("border-b px-6 py-5 pr-14", className)} {...props} />;
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-1.5 text-sm leading-6 text-muted-foreground", className)}
      {...props}
    />
  );
}

function DialogBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("max-h-[calc(100dvh-11rem)] overflow-y-auto px-6 py-5", className)} {...props} />;
}

function DialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)} {...props} />;
}

export {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
