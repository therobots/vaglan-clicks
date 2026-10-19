const STATES = {
  live: { label: "Syncing Live", dot: "bg-emerald-500", pulse: true },
  offline: { label: "Offline", dot: "bg-red-500", pulse: false },
};

export default function LiveStatusPill({ state = "offline" }) {
  const { label, dot, pulse } = STATES[state] || STATES.offline;

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full transition-colors duration-300 ${dot}`}
        />
      </span>
      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.08em] text-black">
        {label}
      </span>
    </div>
  );
}