const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ArrowLeft, Plus } from "lucide-react";
import PhotoUploader from "@/components/studio/PhotoUploader";
import LiveStatusPill from "@/components/gallery/LiveStatusPill";
import { itemsOf } from "@/lib/entities";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default function Studio() {
  const [events, setEvents] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [photoCount, setPhotoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    event_date: "",
    location: "",
    price_per_photo: "2",
  });

  useEffect(() => {
    (async () => {
      try {
        const page = await db.entities.Event.list({ sort: "-created_date", limit: 50 });
        const listed = itemsOf(page);
        setEvents(listed);
        if (listed.length) {
          setActiveId(listed[0].id);
        } else {
          setCreating(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeId) {
      setPhotoCount(0);
      return;
    }
    const countPhotos = async () => {
      try {
        if (typeof db.entities.Photo.count === "function") {
          setPhotoCount(await db.entities.Photo.count({ event_id: activeId }));
          return;
        }
        const page = await db.entities.Photo.filter({ event_id: activeId }, { limit: 500 });
        setPhotoCount(itemsOf(page).length);
      } catch {
        setPhotoCount(0);
      }
    };
    countPhotos();
  }, [activeId]);

  const activeEvent = events.find((e) => e.id === activeId) || null;

  const createEvent = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const created = await db.entities.Event.create({
      title: draft.title.trim(),
      slug: slugify(draft.title) || `event-${Date.now()}`,
      location: draft.location.trim(),
      price_per_photo: Number(draft.price_per_photo) || 2,
      currency: "EUR",
      is_live: true,
      ...(draft.event_date ? { event_date: draft.event_date } : {}),
    });
    setEvents((prev) => [created, ...prev]);
    setActiveId(created.id);
    setCreating(false);
    setDraft({ title: "", event_date: "", location: "", price_per_photo: "2" });
  };

  return (
    <div className="min-h-screen bg-white pb-16 font-body text-black">
      <header className="sticky top-0 z-40 border-b border-[#E5E7EB] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-black/60 active:text-black">
            <ArrowLeft className="h-4 w-4" strokeWidth={2.6} />
            <span className="text-[13px] font-black uppercase tracking-[0.14em] text-black">
              @vaglan_clicks
            </span>
          </Link>
          <LiveStatusPill />
        </div>
      </header>

      <main className="mx-auto max-w-md px-4">
        <div className="pt-7">
          <h1 className="text-2xl font-black tracking-tight">Studio</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-black/50">
            Drop photos in as you shoot — they appear in the gallery for everyone the moment they land.
          </p>
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black" />
          </div>
        ) : (
          <>
            {events.length > 0 && !creating && (
              <section className="mt-6">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-black/60">
                  Shoot
                </label>
                <select
                  value={activeId}
                  onChange={(e) => setActiveId(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5 text-[15px] font-semibold text-black outline-none focus:border-black"
                >
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex items-center justify-between text-[11px] text-black/40">
                  <span>
                    {photoCount} {photoCount === 1 ? "photo" : "photos"} in this shoot
                  </span>
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex items-center gap-1 font-bold uppercase tracking-[0.06em] text-black"
                  >
                    <Plus className="h-3 w-3" strokeWidth={3} /> New shoot
                  </button>
                </div>
              </section>
            )}

            {creating && (
              <form onSubmit={createEvent} className="mt-6 rounded-2xl border border-[#E5E7EB] p-4">
                <h2 className="text-[13px] font-black uppercase tracking-[0.08em]">New shoot</h2>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Event name"
                  className="mt-3 w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-[15px] outline-none focus:border-black"
                />
                <input
                  type="date"
                  value={draft.event_date}
                  onChange={(e) => setDraft({ ...draft, event_date: e.target.value })}
                  className="mt-2 w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-[15px] outline-none focus:border-black"
                />
                <input
                  value={draft.location}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  placeholder="Location"
                  className="mt-2 w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-[15px] outline-none focus:border-black"
                />
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-black/50">€</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={draft.price_per_photo}
                    onChange={(e) => setDraft({ ...draft, price_per_photo: e.target.value })}
                    className="w-24 rounded-xl border border-[#E5E7EB] px-4 py-3 text-[15px] outline-none focus:border-black"
                  />
                  <span className="text-[13px] text-black/50">first photo · then €0.50 each</span>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-black py-3 text-[13px] font-bold text-white active:scale-[0.99]"
                  >
                    Create shoot
                  </button>
                  {events.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCreating(false)}
                      className="rounded-xl border border-[#E5E7EB] px-4 py-3 text-[13px] font-bold text-black/60"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            )}

            {activeEvent && !creating && (
              <section className="mt-6">
                <PhotoUploader
                  eventId={activeEvent.id}
                  onUploaded={() => setPhotoCount((prev) => prev + 1)}
                />
                <p className="mt-6 text-[11px] leading-relaxed text-black/40">
                  Share the gallery link with a QR code:{" "}
                  <span className="font-semibold text-black/60">
                    /?event={activeEvent.slug}
                  </span>
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}