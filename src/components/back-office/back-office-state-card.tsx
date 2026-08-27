import type { ReactNode } from "react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function BackOfficeStateCard({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <Card>
      <CardHeader className="items-center py-10 text-center sm:py-12">
        {icon ? (
          <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
            {icon}
          </span>
        ) : null}
        <CardTitle>{title}</CardTitle>
        <CardDescription className="max-w-md text-balance">{description}</CardDescription>
        {action ? <div className="pt-2">{action}</div> : null}
      </CardHeader>
    </Card>
  );
}
