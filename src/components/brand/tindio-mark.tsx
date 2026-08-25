import { cn } from "@/lib/utils";

type TindioMarkProps = {
  className?: string;
};

export function TindioMark({ className }: TindioMarkProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-black tracking-[-0.12em] text-primary-foreground"
      >
        T
      </span>
      <span className="text-lg font-bold tracking-[-0.06em] text-foreground">
        TINDIO
      </span>
    </div>
  );
}
