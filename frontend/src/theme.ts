/**
 * theme.ts
 *
 * 다크/라이트/시스템 테마 관리.
 * <html data-theme="dark|light"> 속성으로 CSS 테마 전환을 제어한다.
 */

export type ThemeMode = "dark" | "light" | "system";

const THEME_KEY = "appTheme";
const DEFAULT: ThemeMode = "dark";

export function getTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return (v === "dark" || v === "light" || v === "system") ? v : DEFAULT;
}

export function setTheme(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

export function initTheme(): void {
  applyTheme(getTheme());
  // 시스템 테마 변경 감지
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
}

function applyTheme(mode: ThemeMode): void {
  const resolved = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : mode;
  document.documentElement.setAttribute("data-theme", resolved);
}
