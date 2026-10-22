import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cerebro Studio",
  description: "AI audiovisual production and market intelligence",
  // Added to the iPhone home screen it opens full screen, without Safari's bars.
  appleWebApp: { capable: true, title: "Cerebro", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#101328", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
