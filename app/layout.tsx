import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SWRProvider } from "@/components/swr-provider";
import { Prefetch } from "@/components/prefetch";
import Sidebar from "@/components/sidebar";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SalesOS",
  description: "AI-powered sales intelligence platform",
  icons: { icon: "/icon.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="fr" suppressHydrationWarning>
        <body className={`${geist.className} antialiased`} style={{ background: "#ffffff", color: "#111" }}>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:p-2 focus:bg-white focus:text-black">
            Aller au contenu principal
          </a>
          <SWRProvider>
            <Prefetch />
            <TooltipProvider>
              <div className="flex h-screen overflow-hidden">
                <Sidebar />
                <main id="main-content" className="flex-1 overflow-y-auto" style={{ background: "#f9f9f9" }}>
                  {children}
                </main>
              </div>
            </TooltipProvider>
          </SWRProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
