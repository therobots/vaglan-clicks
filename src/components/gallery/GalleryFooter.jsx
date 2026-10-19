import React from "react";

export default function GalleryFooter() {
  return (
    <footer className="mt-8 flex flex-col items-center justify-center border-t border-gray-100 bg-white px-4 py-10">
      <h2 className="mb-1 text-center text-sm font-extrabold">
        Want to see more shots &amp; event highlights?
      </h2>
      <p className="mb-4 max-w-xs text-center text-xs text-gray-500">
        Follow @vaglan_clicks on Instagram for full event drops &amp; updates.
      </p>
      <a
        href="https://instagram.com/vaglan_clicks"
        target="_blank"
        rel="noopener noreferrer"
        className="mb-8 flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-bold text-white transition-transform hover:scale-105"
        aria-label="Follow @vaglan_clicks on Instagram (opens in a new tab)"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          className="h-4 w-4"
        >
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="5"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <circle cx="18" cy="6" r="1" fill="currentColor" />
        </svg>
        Follow @vaglan_clicks
      </a>
      <div className="text-[10px] font-medium text-gray-400">
        © 2026 @vaglan_clicks. All rights reserved.
      </div>
    </footer>
  );
}
