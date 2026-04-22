"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { type Journey, type Conversation } from "@/lib/data";
import { KOCListPanel } from "./KOCListPanel";
import { createClient } from "@/lib/supabase/client";

interface SidebarProps {
  journeys: Journey[];
  activeJourney: Journey | null;
  conversations: Conversation[];
}

function groupByDate(conversations: Conversation[]) {
  const groups: Record<string, Conversation[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86400000);

  for (const c of conversations) {
    const d = new Date(c.created_at);
    d.setHours(0, 0, 0, 0);
    const label =
      d.getTime() === today.getTime()
        ? "今天"
        : d.getTime() === yesterday.getTime()
        ? "昨天"
        : `${d.getMonth() + 1}月${d.getDate()}日`;
    (groups[label] ??= []).push(c);
  }
  return groups;
}

export function Sidebar({ journeys, activeJourney, conversations }: SidebarProps) {
  const router = useRouter();
  const params = useParams();
  const currentConvId = params?.conversationId as string | undefined;
  const [kocOpen, setKocOpen] = useState(false);
  const supabase = createClient();

  const inactiveJourneys = journeys.filter((j) => !j.is_active);
  const groups = groupByDate(conversations);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function newConversation() {
    if (!activeJourney) return;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journey_id: activeJourney.id }),
    });
    const data = await res.json();
    router.push(`/chat/${data.id}`);
    router.refresh();
  }

  return (
    <aside style={sidebarStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={logoStyle}>
          N<em style={{ color: "var(--accent)", fontStyle: "italic" }}>i</em>che
        </span>
        <Link href="/journey/new" style={{ textDecoration: "none" }}>
          <button style={newJourneyBtnStyle} onMouseEnter={hoverAccentDim} onMouseLeave={hoverAccentDimReset}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span>
            新建旅程
          </button>
        </Link>
      </div>

      {/* Scrollable body */}
      <div style={bodyStyle}>
        {activeJourney ? (
          <>
            {/* Journey name */}
            <div style={{ padding: "8px 16px 4px" }}>
              <div style={sectionTitleStyle}>当前旅程</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", marginTop: 4, lineHeight: 1.4 }}>
                {activeJourney.name}
              </div>
              {activeJourney.init_status === "running" && (
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)", marginTop: 3 }}>
                  ⏳ 正在初始化知识库...
                </div>
              )}
              {activeJourney.init_status === "error" && (
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#e57373", marginTop: 3 }}>
                  ⚠ 初始化失败
                </div>
              )}
            </div>

            {/* KOC toggle */}
            <div style={{ display: "flex", alignItems: "center", padding: "0 8px 0 12px" }}>
              <button
                onClick={() => setKocOpen(!kocOpen)}
                style={{ ...navItemStyle, flex: 1, padding: "6px 4px" }}
              >
                <ChevronIcon open={kocOpen} />
                📋 KOC 列表
              </button>
              {activeJourney && (
                <Link href={`/journey/${activeJourney.id}/koc`} style={{ padding: "4px", color: "var(--text-tertiary)", fontSize: 12, textDecoration: "none", borderRadius: 4 }}>
                  管理
                </Link>
              )}
            </div>
            {kocOpen && activeJourney && (
              <KOCListPanel journeyId={activeJourney.id} />
            )}

            <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />

            {/* New conversation */}
            <button onClick={newConversation} style={navItemStyle}>
              <PlusSmIcon />
              新建对话
            </button>

            {/* Conversation groups */}
            {Object.entries(groups).map(([label, convs]) => (
              <div key={label} suppressHydrationWarning>
                <div style={dateHeaderStyle}>{label}</div>
                {convs.map((c) => (
                  <Link key={c.id} href={`/chat/${c.id}`} style={{ textDecoration: "none" }}>
                    <div
                      style={{
                        ...convItemStyle,
                        background: c.id === currentConvId ? "var(--bg-surface)" : "transparent",
                        color: c.id === currentConvId ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      <span
                        style={{
                          width: 4, height: 4, borderRadius: "50%", flexShrink: 0,
                          background: c.id === currentConvId ? "var(--accent)" : "var(--text-tertiary)",
                        }}
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.title ?? "新对话"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ))}
          </>
        ) : (
          <div style={{ padding: "20px 16px", color: "var(--text-tertiary)", fontSize: 12 }}>
            还没有旅程，点击上方「新建旅程」开始
          </div>
        )}

        {/* Archived journeys */}
        {inactiveJourneys.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={sectionTitleStyle}>归档旅程</div>
            {inactiveJourneys.map((j) => (
              <div key={j.id} style={{ ...navItemStyle, color: "var(--text-tertiary)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {j.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px 12px" }}>
        <Link href="/profile" style={{ textDecoration: "none" }}>
          <div style={footerBtnStyle}>
            <GearIcon /> 我是谁
          </div>
        </Link>
        <button onClick={signOut} style={{ ...footerBtnStyle, width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
          <SignOutIcon /> 退出登录
        </button>
      </div>
    </aside>
  );
}

// ---- Styles ----

const sidebarStyle: React.CSSProperties = {
  width: "var(--sidebar-w)",
  flexShrink: 0,
  background: "var(--bg-base)",
  borderRight: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  height: "100%",
};

const headerStyle: React.CSSProperties = {
  padding: "18px 16px 14px",
  borderBottom: "1px solid var(--border)",
};

const logoStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 20,
  fontWeight: 400,
  letterSpacing: "-0.02em",
  color: "var(--text-primary)",
  display: "block",
  marginBottom: 10,
};

const newJourneyBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  padding: "7px 10px",
  background: "var(--accent-dim)",
  border: "1px solid rgba(200,150,90,0.25)",
  borderRadius: 6,
  color: "var(--accent)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  letterSpacing: "0.01em",
  transition: "background 0.15s ease",
};

function hoverAccentDim(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "rgba(200,150,90,0.22)";
}
function hoverAccentDimReset(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "var(--accent-dim)";
}

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 0",
};

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  padding: "6px 16px 2px",
};

const navItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "6px 16px",
  fontSize: 12,
  color: "var(--text-secondary)",
  cursor: "pointer",
  background: "none",
  border: "none",
  textAlign: "left",
  transition: "background 0.1s ease",
  fontFamily: "var(--font-body)",
};

const dateHeaderStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  padding: "7px 16px 3px",
};

const convItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "5px 16px",
  fontSize: 12,
  cursor: "pointer",
  transition: "background 0.1s ease",
  borderRadius: 0,
};

const footerBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "6px 8px",
  borderRadius: 5,
  fontSize: 12,
  color: "var(--text-secondary)",
  cursor: "pointer",
  transition: "background 0.1s ease",
  fontFamily: "var(--font-body)",
  textDecoration: "none",
};

// ---- Icons ----
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>
      <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusSmIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
      <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M9 2H12a1 1 0 011 1v8a1 1 0 01-1 1H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 10l3-3-3-3M9 7H1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
