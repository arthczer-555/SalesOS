export function KeyStatus({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
        style={{ background: "#f0fdf4", color: "#16a34a" }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Active
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
      style={{ background: "#fef9c3", color: "#854d0e" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full inline-block"
        style={{ background: "#854d0e" }}
      />
      Non configurée
    </span>
  );
}
