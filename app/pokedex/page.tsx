"use client";

import Image from "next/image";

const tools = [
  {
    name: "Mail Agent",
    description: "AI agent for managing and sending sales emails",
    url: "https://coachello-mail-agent.netlify.app/",
    domain: "coachello-mail-agent.netlify.app",
    icon: "✉️",
  },
  {
    name: "CoachelloHQ",
    description: "Internal platform for revenue, growth and ops, with the CoachelloAI assistant",
    url: "https://coachello-sales.netlify.app/",
    domain: "coachello-sales.netlify.app",
    icon: "🎯",
  },
  {
    name: "Onboarding Checklist",
    description: "Admin for employee onboarding checklists",
    url: "https://checklist-onboarding.netlify.app/admin/",
    domain: "checklist-onboarding.netlify.app",
    icon: "✅",
  },
  {
    name: "Super Admin",
    description: "Central Coachello administration console",
    url: "https://admin-coachello.netlify.app/auth/login",
    domain: "admin-coachello.netlify.app",
    icon: "🛡️",
  },
  {
    name: "Ticket Mafia",
    description: "Ticket Mafia platform",
    url: "https://ticketmafia.netlify.app/",
    domain: "ticketmafia.netlify.app",
    icon: "🎟️",
  },
];

export default function PokedexPage() {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-16"
      style={{
        background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a0a 70%)",
      }}
    >
      {/* Header */}
      <div className="flex flex-col items-center mb-12">
        <div
          className="w-24 h-24 rounded-full overflow-hidden mb-6 ring-2 ring-white/10"
          style={{
            boxShadow: "0 0 40px rgba(255,255,255,0.05)",
          }}
        >
          <Image
            src="/pokedex-avatar.png"
            alt="Coachello"
            width={96}
            height={96}
            className="object-cover w-full h-full"
          />
        </div>
        <h1
          className="text-3xl font-bold tracking-tight mb-2"
          style={{ color: "#f5f5f5" }}
        >
          Pokedex
        </h1>
        <p className="text-sm" style={{ color: "#666" }}>
          Coachello Internal Tools
        </p>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl w-full">
        {tools.map((tool) => (
          <a
            key={tool.name}
            href={tool.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-2xl p-6 transition-all duration-200"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.07)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.03)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div className="flex items-start gap-4">
              <span className="text-2xl mt-0.5">{tool.icon}</span>
              <div className="flex-1 min-w-0">
                <h2
                  className="font-semibold text-base mb-1"
                  style={{ color: "#e5e5e5" }}
                >
                  {tool.name}
                </h2>
                <p
                  className="text-sm leading-relaxed mb-3"
                  style={{ color: "#888" }}
                >
                  {tool.description}
                </p>
                <span
                  className="inline-flex items-center text-xs px-2.5 py-1 rounded-full"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: "#666",
                  }}
                >
                  {tool.domain}
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* Footer */}
      <p className="mt-16 text-xs" style={{ color: "#333" }}>
        coachello &mdash; internal use only
      </p>
    </div>
  );
}
