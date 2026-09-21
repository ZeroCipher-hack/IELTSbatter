"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const paths = [
  "M3 10 12 3l9 7v10H3Z M9 20v-7h6v7",
  "M5 4h14v17H5Z M8 2v4m8-4v4M8 10h8m-8 4h5",
  "m5 16-1 4 4-1L20 7l-3-3Z M14 7l3 3",
  "M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3Z M12 6v16",
  "M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v7h4v-7Zm16 0h2v7h-4v-7Z",
  "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8",
];

export function WorkspaceNav({ items, homeLabel }: {
  items: { href: string; label: string }[];
  homeLabel: string;
}) {
  const pathname = usePathname();
  return (
    <aside className="workspace-rail">
      <Link href="/" className="rail-logo" aria-label={homeLabel}>✦</Link>
      <nav aria-label={homeLabel}>
        {items.map((item, index) => (
          <Link key={item.href} href={item.href} title={item.label}
            aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[index]} /></svg>
            <span className="rail-tooltip">{item.label}</span>
          </Link>
        ))}
      </nav>
      <span className="rail-footer" aria-hidden="true">IELTS</span>
    </aside>
  );
}
