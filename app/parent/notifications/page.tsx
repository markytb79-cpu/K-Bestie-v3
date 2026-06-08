"use client";

import { useEffect } from "react";
import Link from "next/link";
import ParentTabBar from "@/components/ParentTabBar";
import { BackArrow } from "@/components/ParentIcons";
import DemoSwitcher from "@/components/DemoSwitcher";
import { useStore } from "@/hooks/useStore";
import { markNotifRead, markAllNotifsRead } from "@/lib/store";

const LEVEL_BORDER: Record<string, string> = {
  safe: "#BBF7D0", warning: "#FDE68A", danger: "#FECACA",
};
const LEVEL_BG: Record<string, string> = {
  safe: "#F0FDF4", warning: "#FFFBEB", danger: "#FFF5F5",
};

export default function ParentNotificationsPage() {
  const store = useStore();
  const notifs = store.notifications;
  const unread = notifs.filter((n) => !n.read).length;

  // 페이지 떠날 때 자동 읽음 처리 대신, 명시적 버튼으로 처리

  return (
    <div
      className="min-h-dvh pb-[72px] md:max-w-[420px] md:mx-auto"
      style={{ background: "var(--hb-bg)" }}
    >
      {/* 헤더 */}
      <div className="bg-white px-5 pt-12 pb-4 flex items-center gap-3">
        <Link href="/parent/home" style={{ color: "var(--hb-primary)" }}>
          <BackArrow />
        </Link>
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>알림 센터</p>
          <h1 className="text-[17px] font-bold text-gray-900">알림 🔔</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {unread > 0 && (
            <>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                style={{ background: "var(--hb-danger)" }}
              >
                {unread}
              </span>
              <button
                onClick={markAllNotifsRead}
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
              >
                모두 읽음
              </button>
            </>
          )}
          {unread === 0 && (
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: "#F3F4F6", color: "#9CA3AF" }}
            >
              모두 읽음 ✓
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {notifs.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">🔔</p>
            <p className="text-sm font-semibold text-gray-600">새 알림이 없어요</p>
          </div>
        ) : (
          notifs.map((notif) => (
            <button
              key={notif.id}
              onClick={() => markNotifRead(notif.id)}
              className="w-full text-left rounded-2xl p-4 transition-opacity active:opacity-80"
              style={{
                background: notif.read ? "#FAFAFA" : (LEVEL_BG[notif.level] ?? "#FFFFFF"),
                border: `1.5px solid ${notif.read ? "#E5E7EB" : (LEVEL_BORDER[notif.level] ?? "#E5E7EB")}`,
                boxShadow: "var(--hb-shadow)",
                opacity: notif.read ? 0.65 : 1,
              }}
            >
              <div className="flex items-start gap-3">
                {!notif.read && (
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{ background: notif.level === "danger" ? "#EF4444" : notif.level === "warning" ? "#F59E0B" : "#22C55E" }}
                  />
                )}
                {notif.read && <div className="w-2 h-2 mt-1.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900 leading-snug">{notif.title}</p>
                    <span className="text-xs shrink-0" style={{ color: "var(--hb-muted)" }}>{notif.time}</span>
                  </div>
                  <p className="text-xs mt-1.5 leading-relaxed text-gray-600">{notif.body}</p>
                  {notif.hasExpertCTA && !notif.read && (
                    <Link
                      href="/parent/expert"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2.5 inline-block px-4 py-1.5 rounded-full text-xs font-bold text-white"
                      style={{ background: "var(--hb-danger)" }}
                    >
                      전문가와 연결하기 →
                    </Link>
                  )}
                </div>
              </div>
            </button>
          ))
        )}

        <p className="text-xs text-center py-2" style={{ color: "var(--hb-muted)" }}>
          🟢 안정 · 🟡 주의 · 🔴 즉각 관심 필요
        </p>
      </div>

      <DemoSwitcher mode="parent" />
      <ParentTabBar />
    </div>
  );
}
