"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BandBadge } from "@/components/ui/BandBadge";

export interface CriterionItem {
  key: "taskResponse" | "coherenceCohesion" | "lexicalResource" | "grammar";
  band: number;
  note: string;
}

export function CriteriaGrid({ items }: { items: CriterionItem[] }) {
  const t = useTranslations("result");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">{t("clickForDetails")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const isOpen = open === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setOpen(isOpen ? null : item.key)}
              className={`rounded-xl border bg-white p-4 text-left shadow-sm transition-colors ${
                isOpen ? "border-brand-400 ring-1 ring-brand-300" : "border-gray-200 hover:border-gray-300"
              }`}
              aria-expanded={isOpen}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-800">{t(item.key)}</span>
                <BandBadge band={item.band} />
              </div>
              {isOpen && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-600">{item.note}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
