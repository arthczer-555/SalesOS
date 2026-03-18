"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";


const nav = [
  { href: "/", label: "Coachello Intelligence" },
  { href: "/prospecting", label: "Prospection" },
  { href: "/deals", label: "Deals" },
  { href: "/competitive", label: "Competition" },
  { href: "/scoring", label: "Deal Scoring" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="flex flex-col w-52 shrink-0 h-screen border-r"
      style={{ background: "#ffffff", borderColor: "#eeeeee" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b" style={{ borderColor: "#eeeeee" }}>
        <img src="/logo.png" alt="Coachello" width={28} height={28} className="rounded-lg" style={{ imageRendering: "crisp-edges" }} />
        <span className="font-semibold text-sm tracking-tight" style={{ color: "#111" }}>SalesOS</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center px-3 py-2.5 rounded-lg text-sm transition-colors"
              style={
                active
                  ? { background: "#fde8ef", color: "#f01563", borderLeft: "2px solid #f01563", paddingLeft: "10px" }
                  : { color: "#888" }
              }
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "#f5f5f5"; e.currentTarget.style.color = "#111"; } }}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#888"; } }}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t space-y-0.5" style={{ borderColor: "#eeeeee" }}>
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ color: "#aaa" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#111"; e.currentTarget.style.background = "#f5f5f5"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#aaa"; e.currentTarget.style.background = "transparent"; }}
        >
          <Settings size={14} />
          Settings
        </Link>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Avatar className="w-6 h-6">
            <AvatarFallback className="text-[10px]" style={{ background: "#fde8ef", color: "#f01563" }}>
              AC
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: "#111" }}>Arthur</p>
            <p className="text-[10px] truncate" style={{ color: "#aaa" }}>Coachello</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
