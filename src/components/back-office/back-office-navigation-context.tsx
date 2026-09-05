"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { BackOfficeNavigationAccess } from "@/components/back-office/back-office-navigation";

const BackOfficeNavigationContext = createContext<BackOfficeNavigationAccess | null>(null);

export function BackOfficeNavigationProvider({
  access,
  children,
}: {
  access: BackOfficeNavigationAccess;
  children: ReactNode;
}) {
  return (
    <BackOfficeNavigationContext.Provider value={access}>
      {children}
    </BackOfficeNavigationContext.Provider>
  );
}

export function useBackOfficeNavigationAccess() {
  return useContext(BackOfficeNavigationContext);
}
