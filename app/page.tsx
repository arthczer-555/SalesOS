"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp } from "lucide-react";


type Message = { role: "user" | "assistant"; text: string };

const mockReplies = [
  "D'après les données HubSpot, ton deal Kering est le plus avancé avec un score de 91. La prochaine étape recommandée est de finaliser le contrat avant fin mars.",
  "Je vois 3 relances en attente : Decathlon (2j), L'Oréal (5j) et BNP Paribas (8j). Je peux générer un draft d'email pour chacun si tu veux.",
  "Cornerstone a lancé une nouvelle offre de coaching IA cette semaine. Ils ciblent le segment mid-market avec un prix agressif à 15€/session. Je te recommande de surveiller leur positionnement sur LinkedIn.",
  "Le score moyen de ton pipe est de 72/100. Tes deals les plus solides sont Kering (91) et Decathlon (84). BNP Paribas (61) nécessite une action rapide.",
  "Je n'ai pas encore accès aux données en temps réel — les intégrations HubSpot, Slack et Gmail seront connectées dans la prochaine version. Pour l'instant, je travaille avec les données mockées.",
];

let replyIndex = 0;

export default function IntelligencePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    setTimeout(() => {
      const reply = mockReplies[replyIndex % mockReplies.length];
      replyIndex++;
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setLoading(false);
    }, 1000);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <img src="/logo.png" alt="Coachello" width={56} height={56} className="rounded-2xl" />
            <h1 className="text-2xl font-semibold" style={{ color: "#111" }}>Coachello Intelligence</h1>
            <p className="text-sm max-w-sm" style={{ color: "#aaa" }}>
              Pose une question sur tes deals, prospects, concurrents ou ton pipeline.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {["Quels deals sont à risque ?", "Relances en retard ?", "Actualités concurrents ?"].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                  style={{ borderColor: "#eee", color: "#888" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#f01563"; e.currentTarget.style.color = "#f01563"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#eee"; e.currentTarget.style.color = "#888"; }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <img src="/logo.png" alt="AI" width={28} height={28} className="rounded-lg mr-3 mt-0.5 shrink-0" />
                )}
                <div
                  className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
                  style={
                    m.role === "user"
                      ? { background: "#f01563", color: "#fff", borderBottomRightRadius: 4 }
                      : { background: "#f5f5f5", color: "#111", borderBottomLeftRadius: 4 }
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start items-center gap-3">
                <img src="/logo.png" alt="AI" width={28} height={28} className="rounded-lg shrink-0" />
                <div className="flex gap-1 px-4 py-3 rounded-2xl" style={{ background: "#f5f5f5" }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ background: "#f01563", animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-6 pb-6 pt-2">
        <div className="max-w-2xl mx-auto flex items-end gap-3 p-3 rounded-2xl border transition-all" style={{ background: "#fff", borderColor: "#e5e5e5" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Pose une question sur tes deals, prospects, concurrents..."
            rows={1}
            className="flex-1 resize-none text-sm outline-none bg-transparent leading-relaxed"
            style={{ color: "#111", maxHeight: 120 }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-opacity"
            style={{ background: "#f01563", opacity: !input.trim() || loading ? 0.4 : 1 }}
          >
            <ArrowUp size={15} style={{ color: "#fff" }} />
          </button>
        </div>
        <p className="text-center text-[10px] mt-2" style={{ color: "#ccc" }}>
          Connecté à HubSpot · Slack · Gmail · Drive — bientôt disponible
        </p>
      </div>
    </div>
  );
}
