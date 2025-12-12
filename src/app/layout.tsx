import type { Metadata, Viewport } from "next";
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import "./globals.css";

export const metadata: Metadata = {
  title: "Ski Shade Map - Find Sunny Slopes",
  description: "Interactive map showing sun exposure on ski runs throughout the day",
  keywords: ["ski", "skiing", "sun", "shade", "map", "slopes", "winter sports"],
  authors: [{ name: "Marcus Hyett" }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#3b82f6',
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
              token: {
                colorPrimary: '#3b82f6',
                borderRadius: 8,
                fontFamily: 'system-ui, -apple-system, sans-serif',
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
