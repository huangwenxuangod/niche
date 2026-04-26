"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { Button, Tooltip } from "antd";
import { Conversations } from "@ant-design/x";
import type { ConversationItemType } from "@ant-design/x";
import { type Journey, type Conversation } from "@/lib/data";
import { KOCListPanel } from "./KOCListPanel";
import { DashboardPanel } from "./DashboardPanel";
import { createClient } from "@/lib/supabase/client";
import { useThemeMode } from "@/components/providers/AntdProvider";

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
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const supabase = createClient();
  const { themeMode, toggleTheme } = useThemeMode();

  const inactiveJourneys = journeys.filter((j) => !j.is_active);
  const groups = groupByDate(conversations);
  const conversationItems: ConversationItemType[] = Object.entries(groups).flatMap(([label, convs]) =>
    convs.map((conversation) => ({
      key: conversation.id,
      label: conversation.title ?? "新对话",
      group: label,
    }))
  );

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
        <div style={headerTopStyle}>
          <span style={logoStyle}>
            N<em style={{ color: "var(--accent)", fontStyle: "italic" }}>i</em>che
          </span>
          <Tooltip title={themeMode === "dark" ? "切换到亮色" : "切换到深色"}>
            <Button
              type="text"
              shape="circle"
              aria-label={themeMode === "dark" ? "切换到亮色主题" : "切换到深色主题"}
              onClick={toggleTheme}
              style={themeToggleButtonStyle}
              icon={themeMode === "dark" ? <SunIcon /> : <MoonIcon />}
            />
          </Tooltip>
        </div>
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
                  ⏳ 正在初始化对标内容库...
                </div>
              )}
              {activeJourney.init_status === "error" && (
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#e57373", marginTop: 3 }}>
                  ⚠ 初始化失败
                </div>
              )}
            </div>

            {/* Data retrospective toggle */}
            <div style={{ display: "flex", alignItems: "center", padding: "0 8px 0 12px" }}>
              <button
                onClick={() => setDashboardOpen(!dashboardOpen)}
                style={{ ...navItemStyle, flex: 1, padding: "6px 4px" }}
              >
                <ChevronIcon open={dashboardOpen} />
                📊 数据复盘
              </button>
              {activeJourney && (
                <Link href={`/journey/${activeJourney.id}/dashboard`} style={{ padding: "4px", color: "var(--text-tertiary)", fontSize: 12, textDecoration: "none", borderRadius: 4 }}>
                  详情
                </Link>
              )}
            </div>
            {dashboardOpen && activeJourney && (
              <DashboardPanel journeyId={activeJourney.id} />
            )}

            {/* Benchmark accounts toggle */}
            <div style={{ display: "flex", alignItems: "center", padding: "0 8px 0 12px" }}>
              <button
                onClick={() => setKocOpen(!kocOpen)}
                style={{ ...navItemStyle, flex: 1, padding: "6px 4px" }}
              >
                <ChevronIcon open={kocOpen} />
                📋 对标账号
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

            <div style={{ padding: "4px 12px 0" }}>
              <Conversations
                groupable={{
                  label: (group) => <span style={dateHeaderStyle}>{group}</span>,
                }}
                items={conversationItems}
                activeKey={currentConvId}
                onActiveChange={(value) => {
                  if (value) {
                    router.push(`/chat/${String(value)}`);
                  }
                }}
                styles={{
                  item: {
                    background: "transparent",
                    color: "var(--text-secondary)",
                    borderRadius: 16,
                    marginBottom: 6,
                    minHeight: 54,
                    paddingInline: 14,
                  },
                  group: {
                    marginBottom: 14,
                  },
                }}
                classNames={{
                  root: "niche-conversations",
                }}
              />
            </div>
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

const headerTopStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 10,
};

const logoStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 20,
  fontWeight: 400,
  letterSpacing: "-0.02em",
  color: "var(--text-primary)",
  display: "block",
};

const themeToggleButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "color-mix(in srgb, var(--bg-surface) 92%, white 8%)",
  color: "var(--accent)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
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
  display: "inline-block",
  padding: "6px 4px 4px",
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

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="2.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.6v1.6M8 12.8v1.6M3.47 3.47l1.13 1.13M11.4 11.4l1.13 1.13M1.6 8h1.6M12.8 8h1.6M3.47 12.53l1.13-1.13M11.4 4.6l1.13-1.13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M10.96 1.97a5.84 5.84 0 103.07 10.62A6.39 6.39 0 0110.96 1.97z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
