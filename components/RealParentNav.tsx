"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { icon: "🏠", label: "홈", href: "/parent/home" },
  { icon: "📄", label: "리포트", href: "/parent/report" },
  { icon: "💬", label: "케이와 대화", href: "/parent/guide" },
  { icon: "⚙️", label: "설정", href: "/parent/settings" },
];

export function RealParentNav({ active }: { active?: string }) {
  const pathname = usePathname();

  return (
    <div
      className="shrink-0 sticky bottom-0 z-20 flex items-stretch border-t"
      style={{ background: "#ffffff", borderColor: "#f3f4f6" }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.label === active ||
          pathname === item.href ||
          (item.href === "/parent/report" && pathname.startsWith("/parent/report")) ||
          (item.href === "/parent/guide" && pathname.startsWith("/parent/guide")) ||
          (item.href === "/parent/settings" && pathname.startsWith("/parent/settings"));

        return (
          <Link
            key={item.label}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 select-none cursor-pointer"
          >
            <span className="text-lg" style={{ opacity: isActive ? 1 : 0.55 }}>
              {item.icon}
            </span>
            <span
              className="text-[10px] font-bold"
              style={{ color: isActive ? "#1a6b5a" : "#6b7280" }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
