import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cerebro Studio",
  description: "AI audiovisual production and market intelligence",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
