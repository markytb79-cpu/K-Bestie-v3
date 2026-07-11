import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoViewProvider } from "@/app/demo/components/DemoViewContext";

export const metadata: Metadata = {
  title: "내친구 케이",
  description: "아이의 마음을 듣는 AI 친구, 케이",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "케이",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1A6B5A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <DemoViewProvider>{children}</DemoViewProvider>
      </body>
    </html>
  );
}
