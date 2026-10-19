const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";

import GalleryHeader from "@/components/gallery/GalleryHeader";
import PhotoCard from "@/components/gallery/PhotoCard";
import PhotoLightbox from "@/components/gallery/PhotoLightbox";
import CartBar from "@/components/gallery/CartBar";
import CheckoutSheet from "@/components/gallery/CheckoutSheet";
import GalleryFooter from "@/components/gallery/GalleryFooter";
import TimeFilterBar from "@/components/gallery/TimeFilterBar";
import ExpiryBanner from "@/components/gallery/ExpiryBanner";
import { resolveEvent } from "@/lib/demoGallery";
import { buildSlots, hourSlot, slotRange } from "@/lib/timeBuckets";
import { firstPhotoPrice, nextPhotoPrice, selectionSubtotal } from "@/lib/pricing";

const newSessionToken = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function Home() {
  const [event, setEvent] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [timestamps, setTimestamps] = useState([]);
  const [activeSlot, setActiveSlot] = useState(null);
  const [tip, setTip] = useState(0);
  const [selected, setSelected] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const slug = new URLSearchParams(window.location.search).get("event");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const resolved = await resolveEvent(slug);
        if (!active) return;
        setEvent(resolved);
        if (resolved) {
          const page = await db.entities.Photo.filter(
            { event_id: resolved.id },
            { sort: "-created_date", limit: 200 }
          );
          const stamps = await db.entities.Photo.filter(
            { event_id: resolved.id },
            { sort: "created_date", limit: 500, fields: ["created_date"] }
          );
          if (active) {
            setPhotos(page.items);
            setTimestamps(stamps.items.map((photo) => photo.created_date).filter(Boolean));
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  const eventId = event?.id;

  useEffect(() => {
    if (!eventId) return;
    return db.entities.Photo.subscribe((change) => {
      const incoming = change.data;
      if (change.type !== "create" || !incoming?.preview_url || incoming.event_id !== eventId) return;
      if (incoming.created_date) setTimestamps((prev) => [...prev, incoming.created_date]);
      if (activeSlot !== null && hourSlot(incoming.created_date) !== activeSlot) return;
      setPhotos((prev) => (prev.some((p) => p.id === incoming.id) ? prev : [incoming, ...prev]));
    });
  }, [eventId, activeSlot]);

  const firstPrice = firstPhotoPrice(event);
  const currency = event?.currency || "EUR";
  const subtotal = selectionSubtotal(selected.length, firstPrice);
  const total = subtotal + tip;
  const slots = buildSlots(timestamps);
  const viewingPhoto = viewing === null ? null : photos[viewing];

  const selectSlot = async (slot) => {
    if (!eventId || slot === activeSlot) return;
    setActiveSlot(slot);
    setViewing(null);

    const query = { event_id: eventId };
    if (slot !== null) {
      const { start, end } = slotRange(slot);
      query.created_date = { $gte: start, $lt: end };
    }

    const page = await db.entities.Photo.filter(query, { sort: "-created_date", limit: 200 });
    setPhotos(page.items);
  };

  const step = (delta) => {
    setViewing((prev) => {
      const next = (prev ?? 0) + delta;
      return next >= 0 && next < photos.length ? next : prev;
    });
  };

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  const pay = async (email) => {
    setPaying(true);
    const sessionToken = newSessionToken();
    try {
      await db.entities.Order.create({
        session_token: sessionToken,
        email,
        event_id: eventId,
        photo_ids: selected,
        amount: total,
        tip,
        currency,
        status: "paid",
      });
      db.analytics.track({ eventName: "checkout_completed", properties: { photo_count: selected.length, amount: total } });
      navigate(`/success?session=${sessionToken}`);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-white font-body text-black">
      <GalleryHeader
        eventId={eventId}
        eventLive={event?.is_live !== false}
        latestPhotoAt={photos[0]?.created_date}
        photoCount={loading ? undefined : photos.length}
      />

      <main className="mx-auto max-w-md pt-14 pb-32">
        <TimeFilterBar slots={slots} activeSlot={activeSlot} onSelect={selectSlot} />
        <ExpiryBanner event={event} />

        {loading ? (
          <div className="grid grid-cols-3 gap-[2px]">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse bg-neutral-100" />
            ))}
          </div>
        ) : photos.length === 0 ? (
          <div className="px-6 py-24 text-center">
            <p className="text-[15px] font-bold tracking-tight">
              {activeSlot === null ? "No photos yet" : "Nothing in this hour"}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-black/45">
              {activeSlot === null
                ? "They land here the moment @vaglan_clicks uploads them from the shoot."
                : "Tap 🔥 All Shots to see the whole night."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-[2px]">
            {photos.map((photo, index) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                selected={selected.includes(photo.id)}
                onToggle={() => toggle(photo.id)}
                onOpen={() => setViewing(index)}
              />
            ))}
          </div>
        )}

        {!loading && photos.length > 0 && <GalleryFooter />}
      </main>

      <AnimatePresence>
        {viewingPhoto && (
          <PhotoLightbox
            photo={viewingPhoto}
            selected={selected.includes(viewingPhoto.id)}
            price={nextPhotoPrice(selected.length, firstPrice)}
            currency={currency}
            hasPrev={viewing > 0}
            hasNext={viewing < photos.length - 1}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToggle={() => toggle(viewingPhoto.id)}
            onClose={() => setViewing(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selected.length > 0 && viewing === null && !checkoutOpen && (
          <CartBar
            count={selected.length}
            amount={subtotal}
            currency={currency}
            onCheckout={() => setCheckoutOpen(true)}
          />
        )}
      </AnimatePresence>

      <CheckoutSheet
        open={checkoutOpen}
        count={selected.length}
        subtotal={subtotal}
        tip={tip}
        amount={total}
        currency={currency}
        busy={paying}
        onClose={() => setCheckoutOpen(false)}
        onTipChange={setTip}
        onPay={pay}
      />
    </div>
  );
}