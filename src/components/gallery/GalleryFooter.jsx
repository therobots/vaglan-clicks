import React from "react";
import { Instagram } from "lucide-react";

export default function GalleryFooter() {
  return (
    <footer className="mx-3 mt-8 rounded-2xl border border-neutral-800 bg-neutral-950 px-5 py-6 text-neutral-400">
      <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <p className="text-xs">
          &copy; {new Date().getFullYear()} @vaglan_clicks. All rights reserved.
        </p>
        <a
          href="https://instagram.com/vaglan_clicks"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-neutral-300"
          aria-label="Visit @vaglan_clicks on Instagram (opens in a new tab)"
        >
          <Instagram className="h-4 w-4" aria-hidden="true" />
          <span>@vaglan_clicks</span>
        </a>
      </div>
    </footer>
  );
}
