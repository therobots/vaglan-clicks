const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Check, Download } from "lucide-react";
import { Image } from "@/components/ui/image";

export default function Success() {
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const sessionToken = new URLSearchParams(window.location.search).get("session");
    (async () => {
      try {
        if (!sessionToken) {
          setMissing(true);
          return;
        }
        const found = await db.entities.Order.filter(
          { session_token: sessionToken },
          { limit: 1 }
        );
        const record = found.items[0];
        if (!record) {
          setMissing(true);
          return;
        }
        setOrder(record);

        const photos = await db.entities.Photo.filter(
          { id: { $in: record.photo_ids } },
          { limit: 200 }
        );
        const ordered = record.photo_ids
          .map((id) => photos.items.find((photo) => photo.id === id))
          .filter(Boolean);

        const unlocked = await Promise.all(
          ordered.map(async (photo) => ({
            ...photo,
            download_url: photo.original_url?.startsWith("http")
              ? photo.original_url
              : (
                  await db.integrations.Core.CreateFileSignedUrl({
                    file_uri: photo.original_url,
                    expires_in: 3600,
                  })
                ).signed_url,
          }))
        );
        setItems(unlocked);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black" />
      </div>
    );
  }

  if (missing) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center font-body">
        <p className="text-[15px] font-bold tracking-tight">This download link has expired</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-black/45">
          Open the gallery again and pick your photos.
        </p>
        <Link
          to="/"
          className="mt-6 rounded-2xl bg-black px-6 py-3.5 text-[13px] font-bold text-white"
        >
          Back to the gallery
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-body text-black">
      <main className="mx-auto max-w-md px-4 pb-20 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
        <div className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#0055FF]">
            <Check className="h-7 w-7 text-white" strokeWidth={3.4} />
          </div>
          <h1 className="mt-5 text-[26px] font-black leading-tight tracking-tight">
            Your Photos are Ready! 🎉
          </h1>
          <p className="mx-auto mt-2 max-w-[19rem] text-[13px] leading-relaxed text-black/50">
            Thank you — {items.length} {items.length === 1 ? "photo" : "photos"} unlocked. The
            watermarks are gone and the full-resolution files are yours to download.
          </p>
        </div>

        <div className="mt-8 space-y-8">
          {items.map((photo) => (
            <div key={photo.id}>
              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-neutral-100">
                <Image
                  src={photo.preview_url}
                  alt={photo.filename || "Purchased photo"}
                  className="absolute inset-0 h-full w-full"
                />
              </div>
              <a
                href={photo.download_url}
                download={photo.filename || true}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-black py-4 text-[13px] font-bold text-black transition-colors active:bg-black active:text-white"
              >
                <Download className="h-4 w-4" strokeWidth={2.6} />
                Download High-Res
              </a>
            </div>
          ))}
        </div>

        {order?.email && (
          <p className="mt-10 text-center text-[12px] leading-relaxed text-black/45">
            Backup download links are on their way to{" "}
            <span className="font-semibold text-black">{order.email}</span>.
          </p>
        )}

        <p className="mt-3 text-center text-[11px] leading-relaxed text-black/30">
          Test mode — no payment was taken and no email was sent.
        </p>

        <Link
          to="/"
          className="mt-8 block text-center text-[13px] font-bold text-black/40 underline underline-offset-4"
        >
          Back to the gallery
        </Link>
      </main>
    </div>
  );
}