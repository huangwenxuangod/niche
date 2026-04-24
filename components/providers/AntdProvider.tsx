"use client";

import { App, ConfigProvider, theme } from "antd";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";

type ThemeMode = "dark" | "light";

type ThemeContextValue = {
  themeMode: ThemeMode;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeModeContext = createContext<ThemeContextValue | null>(null);

function getInitialThemeMode(): ThemeMode {
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function AntdProvider({ children }: PropsWithChildren) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem("niche-theme", themeMode);
  }, [themeMode]);

  const providerValue = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      setThemeMode,
      toggleTheme: () => setThemeMode((current) => (current === "dark" ? "light" : "dark")),
    }),
    [themeMode]
  );

  const isLight = themeMode === "light";

  return (
    <ThemeModeContext.Provider value={providerValue}>
      <ConfigProvider
        theme={{
          algorithm: isLight ? theme.defaultAlgorithm : theme.darkAlgorithm,
          token: {
            colorPrimary: "#C8965A",
            colorBgBase: isLight ? "#F5F1E8" : "#0C0C0B",
            colorBgContainer: isLight ? "#FFFCF7" : "#171715",
            colorBgElevated: isLight ? "#FFFDF9" : "#1E1E1C",
            colorBorder: isLight ? "rgba(31, 26, 21, 0.09)" : "rgba(240, 237, 230, 0.07)",
            colorText: isLight ? "#1F1A15" : "#F0EDE6",
            colorTextSecondary: isLight ? "rgba(31, 26, 21, 0.62)" : "rgba(240, 237, 230, 0.55)",
            colorTextTertiary: isLight ? "rgba(31, 26, 21, 0.36)" : "rgba(240, 237, 230, 0.28)",
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
              colorBgContainer: isLight ? "#FFFCF7" : "#171715",
            },
          },
        }}
      >
        <App>
          {children}
          <Toaster
            position="top-center"
            expand={false}
            closeButton
            toastOptions={{
              unstyled: true,
              className: "niche-toast",
              duration: 3200,
            }}
          />
        </App>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within AntdProvider");
  }
  return context;
}
