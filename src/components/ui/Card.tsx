import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`ui-card rounded-3xl border border-gray-100 bg-white p-6 shadow-sm ${className}`}
      {...props}
    />
  );
}
