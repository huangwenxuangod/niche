"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import type { KOCSource } from "@/lib/data";

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function KOCListPanel({ journeyId }: { journeyId: string }) {
  const [kocs, setKocs] = useState<KOCSource[]>([]);
  const [primaryKocId, setPrimaryKocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const supabase = createClient();

  useEffect(() => {
    let active = true;

    supabase
      .from("journeys")
      .select("primary_koc_source_id")
      .eq("id", journeyId)
      .single()
      .then(async ({ data }) => {
        const primaryId =
          data && typeof data === "object" && "primary_koc_source_id" in data
            ? ((data as { primary_koc_source_id?: string | null }).primary_koc_source_id ?? null)
            : null;

        const { data: kocRows } = await supabase
          .from("koc_sources")
          .select("*")
          .eq("journey_id", journeyId)
          .order("max_read_count", { ascending: false });

        if (!active) return;
        setPrimaryKocId(primaryId);
        setKocs((kocRows as KOCSource[] | null) ?? []);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [journeyId, supabase]);

  const primaryBenchmark = useMemo(() => {
    if (!kocs.length) return null;
    if (!primaryKocId) return kocs[0] ?? null;
    return kocs.find((item) => item.id === primaryKocId) ?? kocs[0] ?? null;
  }, [kocs, primaryKocId]);

  async function importBenchmark() {
    if (!input.trim()) return;
    setAdding(true);

    try {
      const res = await fetch("/api/koc/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: journeyId, input: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "导入失败");
      }

      const refreshed = await supabase
        .from("journeys")
        .select("primary_koc_source_id")
        .eq("id", journeyId)
        .single();

      const refreshedPrimaryId =
        refreshed.data &&
        typeof refreshed.data === "object" &&
        "primary_koc_source_id" in refreshed.data
          ? ((refreshed.data as { primary_koc_source_id?: string | null }).primary_koc_source_id ?? null)
          : null;

      const refreshedKocs = await supabase
        .from("koc_sources")
        .select("*")
        .eq("journey_id", journeyId)
        .order("max_read_count", { ascending: false });

      setPrimaryKocId(refreshedPrimaryId);
      setKocs((refreshedKocs.data as KOCSource[] | null) ?? []);
      setInput("");
      toast.success("核心对标已导入");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div style={panelStyle}>
        <div style={loadingTextStyle}>加载中...</div>
      </div>
    );
  }

  if (!primaryBenchmark) {
    return (
      <div style={panelStyle}>
        <div style={cardStyle}>
          <div style={titleStyle}>当前还没有核心对标</div>
          <div style={hintStyle}>
            选择一个你最想长期研究的公众号。系统会围绕它建立专属知识库，并持续挖掘它的主题、观点、案例和表达资产。
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && importBenchmark()}
              placeholder="输入公众号名称或文章链接"
              style={inputStyle}
            />
            <button
              onClick={importBenchmark}
              disabled={adding || !input.trim()}
              style={buttonStyle(adding || !input.trim())}
            >
              {adding ? "导入中..." : "导入"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={titleStyle}>{primaryBenchmark.account_name}</div>
          <span style={manualTagStyle}>核心对标</span>
        </div>

        <div style={hintStyle}>
          当前默认只围绕这一个对象持续深挖，重点不是看很多号，而是把这个对象真正研究透。
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <Stat label="最高阅读" val={fmtCount(primaryBenchmark.max_read_count)} />
          <Stat label="平均阅读" val={fmtCount(primaryBenchmark.avg_read_count)} />
          <Stat label="已同步文章" val={String(primaryBenchmark.article_count)} />
        </div>

        <div style={metaTextStyle}>
          {primaryBenchmark.last_fetched_at
            ? `最近同步：${new Date(primaryBenchmark.last_fetched_at).toLocaleDateString("zh-CN")}`
            : "最近同步：尚未同步"}
        </div>

        <div style={assetBlockStyle}>
          <div style={assetTitleStyle}>你应该重点挖的不是表层规律，而是：</div>
          <div style={assetItemStyle}>主题：它长期反复在讲什么</div>
          <div style={assetItemStyle}>观点：它稳定在输出什么判断</div>
          <div style={assetItemStyle}>案例：它靠哪些经历和素材建立信任</div>
          <div style={assetItemStyle}>表达：它像它自己的地方到底在哪里</div>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && importBenchmark()}
            placeholder="输入新公众号名称，替换当前核心对标"
            style={inputStyle}
          />
          <button
            onClick={importBenchmark}
            disabled={adding || !input.trim()}
            style={buttonStyle(adding || !input.trim())}
          >
            {adding ? "更换中..." : "更换"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, val }: { label: string; val: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: "var(--text-primary)" }}>
        {val}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
        {label}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  borderTop: "1px solid var(--border)",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-void)",
  padding: "10px 12px",
};

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "10px",
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text-primary)",
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-tertiary)",
  lineHeight: 1.6,
  marginBottom: 10,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 11,
  color: "var(--text-primary)",
  outline: "none",
  fontFamily: "var(--font-body)",
};

const metaTextStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-tertiary)",
  marginBottom: 10,
};

const assetBlockStyle: React.CSSProperties = {
  padding: "8px 9px",
  borderRadius: 5,
  background: "var(--bg-void)",
  border: "1px solid var(--border)",
};

const assetTitleStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-primary)",
  marginBottom: 6,
};

const assetItemStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-tertiary)",
  lineHeight: 1.6,
};

const loadingTextStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono)",
  padding: "4px 0",
};

const manualTagStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "2px 5px",
  borderRadius: 3,
  background: "var(--accent-dim)",
  color: "var(--accent)",
  border: "1px solid rgba(200,150,90,0.3)",
};

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "0 10px",
    background: "var(--accent-dim)",
    border: "1px solid rgba(200,150,90,0.25)",
    borderRadius: 4,
    color: "var(--accent)",
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--font-body)",
    opacity: disabled ? 0.7 : 1,
  };
}
