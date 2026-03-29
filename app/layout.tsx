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
      <head>
        <meta name="theme-color" content="#ffffff" id="theme-color-meta" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style dangerouslySetInnerHTML={{ __html: `
          #loading-screen {
            position: fixed;
            inset: 0;
            background: #fff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            font-family: system-ui, sans-serif;
            transition: opacity 0.3s ease;
          }
          #loading-screen.fade-out {
            opacity: 0;
            pointer-events: none;
          }
        `}} />
      </head>
      <body className="h-full m-0 p-0 font-[var(--font-geist)] antialiased">
        <div id="loading-screen">
          <div style={{ fontSize: 48 }}>☕</div>
          <div style={{ fontSize: 20, fontWeight: 600, marginTop: 12, color: '#1a1a1a' }}>Nomad</div>
          <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>Finding work-friendly cafés...</div>
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          window.addEventListener('load', function() {
            setTimeout(function() {
              var el = document.getElementById('loading-screen');
              if (el) {
                el.classList.add('fade-out');
                setTimeout(function() { el.remove(); }, 300);
              }
            }, 500);
          });
        `}} />
      </body>
    </html>
  );
}
