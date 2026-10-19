import React from "react";

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[11px] font-bold tracking-tight transition-colors ${
        active
          ? "border-neutral-900 bg-neutral-100 text-neutral-900"
          : "border-gray-200 bg-white text-neutral-600 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export default function TimeFilterBar({ slots = [], activeSlot, onSelect }) {
  return (
    <div
      aria-label="Filter photos by time"
      className="flex gap-1.5 overflow-x-auto px-4 pb-1 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Pill active={activeSlot === null} onClick={() => onSelect(null)}>
        🔥 All Shots
      </Pill>
      {slots.map((slot) => (
        <Pill key={slot.slot} active={activeSlot === slot.slot} onClick={() => onSelect(slot.slot)}>
          {slot.label}
        </Pill>
      ))}
    </div>
  );
}