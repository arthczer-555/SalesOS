"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, ShieldCheck, Menu, X } from "lucide-react";
import { useUser, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useUserMe } from "@/lib/hooks/use-user-me";

const nav = [
  { href: "/", label: "CoachelloGPT" },
  { href: "/briefing", label: "Briefing" },
  { href: "/deals", label: "Deals" },
  { href: "/prospecting", label: "Prospection" },
  { href: "/mass-prospection", label: "Mass Prospection" },
  { href: "/signals", label: "Market Intel (coming)" },
  //{ href: "/marketing", label: "Marketing" },
  //{ href: "/competitive", label: "Competition ()" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const { isAdmin } = useUserMe();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  const sidebarContent = useMemo(() => (
    <>
      {/* Logo */}
      <div
        className="flex items-center justify-between gap-2.5 px-4 py-5 border-b"
        style={{ borderColor: "#eeeeee" }}
      >
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Coachello"
            width={32}
            height={32}
            className="rounded-lg"
            quality={80}
          />
          <span
            className="font-semibold text-sm tracking-tight"
            style={{ color: "#111" }}
          >
            SalesOS
          </span>
        </div>
        <button
          className="md:hidden p-1 rounded-lg sidebar-bottom-link"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto" aria-label="Navigation principale">
        {nav.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active ? "sidebar-link-active" : "sidebar-link"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div
        className="px-2 py-3 border-t space-y-0.5"
        style={{ borderColor: "#eeeeee" }}
      >
        {isAdmin && (
          <Link
            href="/admin"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === "/admin" ? "sidebar-link-active" : "sidebar-bottom-link"
            }`}
          >
            <ShieldCheck size={14} />
            Admin
          </Link>
        )}
        <Link
          href="/settings"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
            pathname === "/settings" ? "sidebar-link-active" : "sidebar-bottom-link"
          }`}
        >
          <Settings size={14} />
          Settings
        </Link>

        {/* User profile */}
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-6 h-6",
              },
            }}
          />
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-medium truncate"
              style={{ color: "#111" }}
            >
              {user?.firstName ?? user?.username ?? "…"}
            </p>
            <p className="text-[10px] truncate" style={{ color: "#666" }}>
              Coachello
            </p>
          </div>
        </div>
      </div>
    </>
  ), [pathname, isAdmin, user, closeMobile]);

  if (pathname?.startsWith("/pokedex")) return null;

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-white shadow-md"
        onClick={openMobile}
        aria-label="Ouvrir le menu"
        style={{ display: mobileOpen ? "none" : undefined }}
      >
        <Menu size={20} style={{ color: "#111" }} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="sidebar-overlay"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`flex flex-col w-52 shrink-0 h-screen border-r bg-white
          fixed md:relative z-50 md:z-auto
          transition-transform duration-200 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        style={{ borderColor: "#eeeeee" }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
