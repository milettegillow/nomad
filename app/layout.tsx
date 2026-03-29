import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nomad - Find laptop-friendly cafés",
  description:
    "Discover cafés where you can work, with WiFi and seating ratings from the community.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="h-full m-0 p-0 bg-black text-white font-[var(--font-geist)] antialiased">
        {children}
      </body>
    </html>
  );
}
