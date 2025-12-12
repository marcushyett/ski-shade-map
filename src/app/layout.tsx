import type { Metadata, Viewport } from "next";
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, theme } from 'antd';
import "./globals.css";

export const metadata: Metadata = {
  title: "Ski Shade Map",
  description: "Interactive map showing sun exposure on ski runs throughout the day",
  keywords: ["ski", "skiing", "sun", "shade", "map", "slopes", "winter sports"],
  authors: [{ name: "Marcus Hyett" }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0a',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <ConfigProvider
            theme={{
              algorithm: theme.darkAlgorithm,
              token: {
                colorPrimary: '#ffffff',
                colorBgBase: '#0a0a0a',
                colorBgContainer: '#141414',
                colorBorder: '#262626',
                colorText: '#e5e5e5',
                colorTextSecondary: '#a3a3a3',
                borderRadius: 4,
                fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              },
            }}
          >
            {children}
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
