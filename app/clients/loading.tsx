import { COLORS } from "@/app/clients/_components/theme";

export default function Loading() {
  return (
    <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
      <div
        className="px-6 py-4 flex items-center gap-4"
        style={{ background: COLORS.bgCard, borderBottom: `1px solid ${COLORS.line}` }}
      >
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: COLORS.bgSoft }} />
        <div className="h-8 w-48 rounded-lg animate-pulse" style={{ background: COLORS.bgSoft }} />
      </div>
      <div className="flex-1 p-6 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-12 rounded-lg animate-pulse"
            style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.line}` }}
          />
        ))}
      </div>
    </div>
  );
}
