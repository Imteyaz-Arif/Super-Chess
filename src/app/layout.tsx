import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Chess",
  description: "Play chess online for free with anyone by sharing game link. No login/signup required.",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}