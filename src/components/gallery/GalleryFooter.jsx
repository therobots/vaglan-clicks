import React from "react";
import { Instagram } from "lucide-react";

export default function GalleryFooter() {
  return (
    <footer className="mx-3 mt-8 border-t border-gray-200 px-5 py-6 text-neutral-600">
      <div className="grid grid-cols-1 items-center gap-3 text-center sm:grid-cols-[1fr_auto_1fr]">
        <p className="text-xs sm:col-start-2">
          &copy; {new Date().getFullYear()} @vaglan_clicks. All rights reserved.
        </p>
        <a
          href="https://instagram.com/vaglan_clicks"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-neutral-900 transition-colors hover:text-neutral-600 sm:col-start-3 sm:justify-self-end"
          aria-label="Visit @vaglan_clicks on Instagram (opens in a new tab)"
        >
          <Instagram className="h-4 w-4" aria-hidden="true" />
          <span>@vaglan_clicks</span>
        </a>
      </div>
    </footer>
  );
}
