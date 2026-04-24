import type { Metadata } from "next";
import { Fraunces, DM_Mono, DM_Sans } from "next/font/google";
import Script from "next/script";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AntdProvider } from "@/components/providers/AntdProvider";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "Niche — 垂类内容起号教练",
  description: "懂你赛道、追踪同行、帮你找到差异化声音",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      data-theme="dark"
      suppressHydrationWarning
      className={`${fraunces.variable} ${dmMono.variable} ${dmSans.variable}`}
    >
      <body>
        <Script id="niche-theme-init" strategy="beforeInteractive">{`
          try {
            var stored = localStorage.getItem("niche-theme");
            var theme = stored === "light" || stored === "dark" ? stored : "dark";
            document.documentElement.dataset.theme = theme;
          } catch (e) {
            document.documentElement.dataset.theme = "dark";
          }
        `}</Script>
        <AntdRegistry>
          <AntdProvider>{children}</AntdProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
