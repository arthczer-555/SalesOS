"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  CalendarDays,
  Briefcase,
  GraduationCap,
  Handshake,
  Crosshair,
  Megaphone,
  Video,
  Eye,
  Network,
  Settings,
  ShieldCheck,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useUser, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useUserMe } from "@/lib/hooks/use-user-me";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/sidebar/sidebar-context";

type NavEntry = { href: string; label: string; icon: LucideIcon; match?: string[] };

const nav: NavEntry[] = [
  { href: "/", label: "CoachelloGPT", icon: Sparkles },
  { href: "/briefing", label: "Briefing", icon: CalendarDays },
  { href: "/deals", label: "Deals", icon: Briefcase },
  { href: "/sales-coach", label: "Sales Coach", icon: GraduationCap },
  { href: "/clients", label: "Clients", icon: Handshake },
  { href: "/prospecting", label: "Prospecting", icon: Crosshair, match: ["/mass-prospection"] },
  { href: "/watchlist", label: "Watch List", icon: Eye },
  { href: "/orgchart", label: "Org Chart", icon: Network },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/video-studio", label: "Video Studio", icon: Video }
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const { isAdmin } = useUserMe();
  const { collapsed, toggle } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  // On mobile, the sidebar is always shown expanded inside the drawer.
  // `collapsed` from the context only governs desktop (md+) layout.
  const sidebarContent = useMemo(
    () => (
      <SidebarBody
        pathname={pathname}
        isAdmin={isAdmin}
        collapsed={collapsed}
        onToggle={toggle}
        user={user}
        onCloseMobile={closeMobile}
      />
    ),
    [pathname, isAdmin, collapsed, toggle, user, closeMobile]
  );

  if (pathname?.startsWith("/pokedex")) return null;

  const desktopWidth = collapsed ? 56 : 208;

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-white shadow-md"
        onClick={openMobile}
        aria-label="Open menu"
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
        className={`flex flex-col shrink-0 h-screen border-r bg-white
          fixed md:relative z-50 md:z-auto
          transition-[width,transform] duration-200 ease-in-out
          w-52 md:w-[var(--sidebar-w)]
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        style={{
          borderColor: "#eeeeee",
          ["--sidebar-w" as string]: `${desktopWidth}px`,
        } as React.CSSProperties}
      >
        {/* Mobile uses fixed w-52; desktop overrides via inline style below */}
        <div
          className="hidden md:flex md:flex-col md:h-full"
          style={{
            width: desktopWidth,
            transition: "width 0.18s ease",
          }}
        >
          {sidebarContent}
        </div>
        <div className="md:hidden flex flex-col h-full w-52">{sidebarContent}</div>
      </aside>
    </>
  );
}

function SidebarBody({
  pathname,
  isAdmin,
  collapsed,
  onToggle,
  user,
  onCloseMobile,
}: {
  pathname: string | null;
  isAdmin: boolean;
  collapsed: boolean;
  onToggle: () => void;
  user: ReturnType<typeof useUser>["user"];
  onCloseMobile: () => void;
}) {
  return (
    <>
      {/* Logo */}
      <div
        className="flex items-center justify-between gap-2.5 border-b"
        style={{
          borderColor: "#eeeeee",
          padding: collapsed ? "16px 8px" : "20px 16px",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Image
            src="/logo.png"
            alt="Coachello"
            width={32}
            height={32}
            className="rounded-lg shrink-0"
            quality={80}
          />
          {!collapsed && (
            <span
              className="font-bold text-xl tracking-tight truncate"
              style={{ color: "#111" }}
            >
              Sales<span style={{ color: "#f01563" }}>OS</span>
            </span>
          )}
        </div>
        {/* Desktop collapse toggle (hidden on mobile) */}
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="hidden md:inline-flex sidebar-bottom-link p-1 rounded-lg"
            title="Collapse (Ctrl/⌘ B)"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        {/* Mobile close */}
        <button
          className="md:hidden p-1 rounded-lg sidebar-bottom-link"
          onClick={onCloseMobile}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 py-4 space-y-0.5 overflow-y-auto"
        style={{ padding: collapsed ? "16px 6px" : "16px 8px" }}
        aria-label="Main navigation"
      >
        {nav.map(({ href, label, icon: Icon, match }) => {
          const active = pathname === href || (match?.includes(pathname ?? "") ?? false);
          return (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={Icon}
              active={active}
              collapsed={collapsed}
            />
          );
        })}
      </nav>

      {/* Bottom */}
      <div
        className="border-t space-y-0.5"
        style={{
          borderColor: "#eeeeee",
          padding: collapsed ? "12px 6px" : "12px 8px",
        }}
      >
        {/* Collapsed state: show expand button at top of bottom block */}
        {collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            className="hidden md:flex w-full items-center justify-center sidebar-bottom-link rounded-lg"
            style={{ padding: "8px 0", marginBottom: 4 }}
            title="Expand (Ctrl/⌘ B)"
          >
            <ChevronRight size={16} />
          </button>
        )}

        {isAdmin && (
          <NavLink
            href="/admin"
            label="Admin"
            icon={ShieldCheck}
            active={pathname === "/admin"}
            collapsed={collapsed}
            tone="bottom"
          />
        )}
        <NavLink
          href="/settings"
          label="Settings"
          icon={Settings}
          active={pathname === "/settings"}
          collapsed={collapsed}
          tone="bottom"
        />

        {/* User profile */}
        <div
          className="flex items-center gap-2.5 rounded-lg"
          style={{ padding: collapsed ? "8px 0" : "8px 12px", justifyContent: collapsed ? "center" : "flex-start" }}
        >
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-6 h-6",
              },
            }}
          />
          {!collapsed && (
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
          )}
        </div>
      </div>
    </>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  tone = "primary",
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  tone?: "primary" | "bottom";
}) {
  const baseClass = active
    ? "sidebar-link-active"
    : tone === "bottom"
      ? "sidebar-bottom-link"
      : "sidebar-link";

  const link = (
    <Link
      href={href}
      className={`flex items-center rounded-lg text-sm transition-colors ${baseClass}`}
      style={
        collapsed
          ? {
              padding: "10px 0",
              justifyContent: "center",
              gap: 0,
            }
          : {
              padding: "10px 12px",
              gap: 10,
            }
      }
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      <Icon size={collapsed ? 18 : 16} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
