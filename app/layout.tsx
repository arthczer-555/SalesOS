import type { Metadata } from "next";
import { Geist, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { SWRProvider } from "@/components/swr-provider";
import { Prefetch } from "@/components/prefetch";
import Sidebar from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar/sidebar-context";
import { AskWidget } from "@/components/ask-widget";

const geist = Geist({ subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-chats" });

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
      <html lang="en" suppressHydrationWarning>
        <body className={`${geist.className} ${spaceGrotesk.variable} antialiased`} style={{ background: "#ffffff", color: "#111" }}>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:p-2 focus:bg-white focus:text-black">
            Skip to main content
          </a>
          <SWRProvider>
            <Prefetch />
            <TooltipProvider>
              <ToastProvider>
                <SidebarProvider>
                  <div className="flex h-screen overflow-hidden">
                    <Sidebar />
                    <main id="main-content" className="flex-1 overflow-y-auto" style={{ background: "#f9f9f9" }}>
                      {children}
                    </main>
                  </div>
                  <AskWidget />
                </SidebarProvider>
              </ToastProvider>
            </TooltipProvider>
          </SWRProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
