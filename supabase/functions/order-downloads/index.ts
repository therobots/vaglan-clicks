import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const privatePreviewPath = (value: string | null, projectUrl: string) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== new URL(projectUrl).origin) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/(public-previews|previews|photos)\/(.+)$/);
    return match ? { bucket: match[1], path: match[2].split('/').map(decodeURIComponent).join('/') } : null;
  } catch { return null; }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Order download function is missing Supabase configuration.");
    return respond({ error: "Secure downloads are not configured." }, 503);
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp = forwardedFor || request.headers.get("cf-connecting-ip") || "unknown";
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const payload = await request.json();
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
    const token = typeof payload?.token === "string" ? payload.token.trim() : "";
    if (Boolean(sessionId) === Boolean(token)) {
      return respond({ error: "Provide one valid order reference." }, 400);
    }
    if (sessionId && !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return respond({ error: "The order reference is invalid." }, 400);
    }
    if (token && !/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
      return respond({ error: "The order reference is invalid." }, 400);
    }

    const { data: allowed, error: rateLimitError } = await supabase.rpc(
      "consume_order_download_attempt",
      {
        ip_input: clientIp,
        window_seconds_input: 900,
        max_attempts_input: 40,
      },
    );
    if (rateLimitError) throw rateLimitError;
    if (!allowed) return respond({ error: "Too many attempts. Please try again later." }, 429);

    const { data: order, error: orderError } = await supabase.rpc(
      "get_photo_order_for_download",
      {
        session_id_input: sessionId || null,
        token_hash_input: token ? await hashToken(token) : null,
      },
    );
    if (orderError) throw orderError;
    if (!order || order.status === "not_found") {
      return respond({ error: "This order could not be found." }, 404);
    }
    if (order.status !== "paid") {
      return respond({ status: order.status, items: [] }, 200);
    }
    if (!Array.isArray(order.items)) {
      throw new Error("The paid order returned an invalid item list.");
    }

    const items: Array<{
      photoId: string;
      filename: string;
      previewUrl: string | null;
      thumbnailUrl: string | null;
      originalBucket: string;
      original_path: string;
      unavailable: boolean;
    }> = order.items.map((item: {
      photo_id: string;
      filename: string;
      preview_url: string | null;
      thumbnail_url: string | null;
      original_path: string;
      original_bucket?: string;
      erased_at?: string | null;
    }) => {
      const safeFilename = String(item.filename || "vaglan-clicks-photo")
        .replace(/[^\w.-]/g, "_")
        .slice(0, 160);
      const originalBucket = item.original_bucket || "photo-originals";
      if (!["private-originals", "originals", "photo-originals"].includes(originalBucket)) {
        throw new Error("The order contains an invalid original storage bucket.");
      }
      return {
        ...item,
        photoId: item.photo_id,
        filename: safeFilename,
        previewUrl: item.preview_url,
        thumbnailUrl: item.thumbnail_url || item.preview_url,
        originalBucket,
        unavailable: Boolean(item.erased_at),
      };
    });

    const entriesByBucket = new Map<string, typeof items>();
    for (const item of items) {
      if (item.unavailable) continue;
      const entries = entriesByBucket.get(item.originalBucket) || [];
      entries.push(item);
      entriesByBucket.set(item.originalBucket, entries);
    }

    const signedUrls = new Map<string, string>();
    await Promise.all([...entriesByBucket].map(async ([bucket, entries]) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(entries.map((item) => item.original_path), 900);
      if (error) throw error;
      if (!data || data.length !== entries.length) {
        throw new Error("The secure photo download links could not be created.");
      }
      data.forEach((signed, index) => {
        const item = entries[index];
        if (signed.error || signed.path !== item.original_path || !signed.signedUrl) {
          throw new Error(signed.error || "Could not create a secure photo download.");
        }
        const downloadUrl = new URL(signed.signedUrl);
        downloadUrl.searchParams.set("download", item.filename);
        signedUrls.set(`${bucket}:${item.original_path}`, downloadUrl.toString());
      });
    }));

    const previewUrls = new Map<string, string>();
    await Promise.all(items.map(async (item) => {
      if (item.unavailable) return;
      const preview = privatePreviewPath(item.thumbnailUrl, supabaseUrl);
      if (!preview) return;
      const { data, error } = await supabase.storage.from(preview.bucket)
        .createSignedUrl(preview.path, 900);
      if (!error && data?.signedUrl) previewUrls.set(item.photoId, data.signedUrl);
    }));

    return respond({
      status: order.status,
      currency: order.currency,
      subtotalCents: order.subtotal_cents,
      tipCents: order.tip_cents,
      totalCents: order.total_cents,
      items: items.map((item) => ({
        photoId: item.photoId,
        filename: item.filename,
        previewUrl: previewUrls.get(item.photoId) || null,
        thumbnailUrl: previewUrls.get(item.photoId) || null,
        downloadUrl: signedUrls.get(`${item.originalBucket}:${item.original_path}`),
        unavailable: item.unavailable,
      })),
    });
  } catch (error) {
    console.error("Secure order download request failed:", error);
    return respond({ error: "Could not prepare your downloads. Please try again." }, 500);
  }
});
