import localFont from "next/font/local";

/**
 * 自托管 HarmonyOS Sans SC（400 / 500 / 600）。
 * next/font 会把文件指纹化后输出到 /_next/static/media，并附带一年期 immutable 缓存。
 * 700 未声明：源码中没有实际使用，避免首次加载多下载约 540KB。
 */
export const harmonySans = localFont({
  src: [
    {
      path: "../fonts/HarmonyOS_Sans_SC_Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/HarmonyOS_Sans_SC_Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/HarmonyOS_Sans_SC_Semibold.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-harmony-sans",
  display: "swap",
});
