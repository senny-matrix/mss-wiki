import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavBar } from "@/components/nav-bar";

// Hexclave
import { HexclaveProvider, HexclaveTheme } from "@hexclave/next";
import { hexclaveServerApp } from "@/hexclave/server";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MicroSkills Wiki",
  description: "MicroSkills Wiki App",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <HexclaveProvider app={hexclaveServerApp}>
          <HexclaveTheme>
            <NavBar />
            {children}
          </HexclaveTheme>
        </HexclaveProvider>
      </body>
    </html>
  );
}
