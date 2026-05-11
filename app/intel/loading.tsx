import { COLORS } from "@/lib/design/tokens";

export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: COLORS.ink3,
        fontSize: 14,
      }}
    >
      Chargement…
    </div>
  );
}
