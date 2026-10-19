const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { DEMO_EVENT_SLUG, demoPhotoUrls } from "@/data/demoPhotos";
import { itemsOf } from "@/lib/entities";
import { parseTimestamp } from "@/lib/timeBuckets";

const DEMO_EVENT = {
  id: "demo-street-session-07",
  title: "Street Session 07",
  slug: DEMO_EVENT_SLUG,
  location: "Athens",
  price_per_photo: 2,
  currency: "EUR",
  is_live: true,
};

const today = () => new Date().toISOString().slice(0, 10);

export const buildDemoPhotos = (eventId) => {
  const start = Date.now() - 90 * 60 * 1000;
  return demoPhotoUrls.map((url, index) => ({
    id: `demo-photo-${index + 1}`,
    event_id: eventId,
    preview_url: url,
    original_url: url,
    filename: `shot-${String(index + 1).padStart(2, "0")}.jpg`,
    is_demo: true,
    created_date: new Date(start + index * 8 * 60 * 1000).toISOString(),
  }));
};

const firstEvent = async (query) => {
  try {
    return itemsOf(await db.entities.Event.filter(query, { limit: 1 }))[0] || null;
  } catch {
    return null;
  }
};

/**
 * Resolve the public gallery event. Unknown slugs stay empty.
 * With no slug (or the demo slug) and an empty database, seed / fall back to
 * sample shots so a first deploy is never a blank page.
 */
export async function resolveEvent(slug) {
  const wanted = (slug || DEMO_EVENT_SLUG).trim();
  const match = await firstEvent({ slug: wanted });
  if (match) return { event: match, demoFallback: false };

  if (wanted !== DEMO_EVENT_SLUG) {
    return { event: null, demoFallback: false };
  }

  try {
    const listed = itemsOf(
      await db.entities.Event.list({ sort: "-created_date", limit: 1 })
    );
    if (listed[0]) return { event: listed[0], demoFallback: false };
  } catch {
    // list() is missing on the local stub — keep going to the demo event.
  }

  try {
    const created = await db.entities.Event.create({
      title: DEMO_EVENT.title,
      slug: DEMO_EVENT.slug,
      location: DEMO_EVENT.location,
      price_per_photo: DEMO_EVENT.price_per_photo,
      currency: DEMO_EVENT.currency,
      is_live: true,
      event_date: today(),
    });
    if (created?.id && created.id !== DEMO_EVENT.id) {
      try {
        await Promise.all(
          buildDemoPhotos(created.id).map((photo) =>
            db.entities.Photo.create({
              event_id: created.id,
              preview_url: photo.preview_url,
              original_url: photo.original_url,
              filename: photo.filename,
              is_demo: true,
            })
          )
        );
      } catch {
        return { event: created, demoFallback: true };
      }
      return { event: created, demoFallback: false };
    }
  } catch {
    // Entity writes fail without a live backend — use the in-memory demo.
  }

  return { event: { ...DEMO_EVENT, event_date: today() }, demoFallback: true };
}

const inCreatedRange = (photo, range) => {
  if (!range) return true;
  const time = parseTimestamp(photo.created_date);
  const start = range.$gte ? parseTimestamp(range.$gte) : Number.NEGATIVE_INFINITY;
  const end = range.$lt ? parseTimestamp(range.$lt) : Number.POSITIVE_INFINITY;
  return time >= start && time < end;
};

export async function loadPhotos(eventId, extraQuery = {}, { demoFallback = false } = {}) {
  try {
    const items = itemsOf(
      await db.entities.Photo.filter(
        { event_id: eventId, ...extraQuery },
        { sort: "-created_date", limit: 200 }
      )
    );
    if (items.length) return items;
  } catch {
    // Fall through to demo shots when this is the sample gallery.
  }

  if (!demoFallback) return [];
  return buildDemoPhotos(eventId).filter((photo) => inCreatedRange(photo, extraQuery.created_date));
}

export async function loadTimestamps(eventId, { demoFallback = false } = {}) {
  try {
    const times = itemsOf(
      await db.entities.Photo.filter(
        { event_id: eventId },
        { sort: "created_date", limit: 500, fields: ["created_date"] }
      )
    )
      .map((photo) => photo.created_date)
      .filter(Boolean);
    if (times.length) return times;
  } catch {
    // Same fallback as loadPhotos.
  }

  if (demoFallback) {
    return buildDemoPhotos(eventId).map((photo) => photo.created_date);
  }
  return [];
}
