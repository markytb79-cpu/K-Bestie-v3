"use client";

import Link from "next/link";
import ParentTabBar from "@/components/ParentTabBar";
import { BackArrow } from "@/components/ParentIcons";
import { DEMO_EXPERTS } from "@/lib/demo-data";
import DemoSwitcher from "@/components/DemoSwitcher";

export default function ParentExpertPage() {
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
          <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
            전문가 연결
          </p>
          <h1 className="text-[17px] font-bold text-gray-900">전문가와 연결하기 🔗</h1>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {/* 안내 배너 */}
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--hb-primary-light)", boxShadow: "var(--hb-shadow)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--hb-primary)" }}>
            💜 아이의 마음이 걱정될 때
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "#7C7CCC" }}>
            아래 기관에 연락하면 전문가의 도움을 받을 수 있어요.
            긴급한 상황이라면 바로 전화하세요.
          </p>
        </div>

        {/* 기관 카드 목록 */}
        {DEMO_EXPERTS.map((expert) => (
          <div
            key={expert.id}
            className="bg-white rounded-2xl p-4"
            style={{ boxShadow: "var(--hb-shadow)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-2xl shrink-0">{expert.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-gray-900">{expert.name}</p>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0"
                      style={{ background: expert.badgeBg, color: expert.badgeColor }}
                    >
                      {expert.badge}
                    </span>
                  </div>
                  {expert.hours && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>
                      🕐 {expert.hours}
                    </p>
                  )}
                  {expert.url && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>
                      🌐 {expert.url}
                    </p>
                  )}
                </div>
              </div>

              {expert.number && (
                <a
                  href={`tel:${expert.number}`}
                  className="shrink-0 px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
                  style={{ background: expert.badgeColor }}
                >
                  <span>📞</span>
                  <span>{expert.number}</span>
                </a>
              )}
            </div>
          </div>
        ))}

        {/* 하단 안내 */}
        <p className="text-xs text-center pb-2" style={{ color: "var(--hb-muted)" }}>
          위 기관은 공공 상담 서비스로 무료 이용 가능합니다.
        </p>
      </div>

      <DemoSwitcher mode="parent" />
      <ParentTabBar />
    </div>
  );
}
