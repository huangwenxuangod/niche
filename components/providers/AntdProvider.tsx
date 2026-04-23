"use client";

import { App, ConfigProvider, theme } from "antd";
import type { PropsWithChildren } from "react";

export function AntdProvider({ children }: PropsWithChildren) {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#C8965A",
          colorBgBase: "#0C0C0B",
          colorBgContainer: "#171715",
          colorBgElevated: "#1E1E1C",
          colorBorder: "rgba(240, 237, 230, 0.07)",
          colorText: "#F0EDE6",
          colorTextSecondary: "rgba(240, 237, 230, 0.55)",
          colorTextTertiary: "rgba(240, 237, 230, 0.28)",
          borderRadius: 16,
          borderRadiusLG: 20,
          fontFamily: "var(--font-body)",
          fontFamilyCode: "var(--font-mono)",
        },
        components: {
          Button: {
            borderRadius: 12,
          },
          Input: {
            borderRadius: 14,
            activeBorderColor: "#C8965A",
            hoverBorderColor: "#C8965A",
          },
          Card: {
            colorBgContainer: "#171715",
          },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
