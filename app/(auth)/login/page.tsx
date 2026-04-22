"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (error) {
      setMessage(error.message);
    } else if (mode === "signup") {
      setMessage("注册成功！请查收验证邮件后登录。");
    } else {
      router.push("/");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-void)",
        padding: "0 16px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 360 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 48,
              fontWeight: 300,
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              lineHeight: 1,
              marginBottom: 10,
            }}
          >
            N<em style={{ color: "var(--accent)", fontStyle: "italic" }}>i</em>che
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            垂类内容起号教练
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 28,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--accent)",
              marginBottom: 20,
            }}
          >
            {mode === "login" ? "登录账号" : "创建账号"}
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={inputStyle}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "var(--border-strong)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--border)")
                }
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={inputStyle}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "var(--border-strong)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--border)")
                }
              />
            </div>

            {message && (
              <div
                style={{
                  fontSize: 12,
                  color: message.includes("成功") ? "var(--accent)" : "#e57373",
                  marginBottom: 14,
                  textAlign: "center",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "10px 0",
                background: loading ? "var(--bg-elevated)" : "var(--accent)",
                border: "none",
                borderRadius: 6,
                color: loading ? "var(--text-tertiary)" : "var(--bg-void)",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "opacity 0.15s ease",
              }}
            >
              {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
            </button>
          </form>

          <div
            style={{
              marginTop: 20,
              paddingTop: 20,
              borderTop: "1px solid var(--border)",
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-tertiary)",
            }}
          >
            {mode === "login" ? "还没有账号？" : "已有账号？"}
            <button
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              style={{
                marginLeft: 4,
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "var(--font-body)",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {mode === "login" ? "立即注册" : "去登录"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "9px 12px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  outline: "none",
  transition: "border-color 0.15s ease",
};
