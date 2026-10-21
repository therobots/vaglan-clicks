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

    const items = await Promise.all(order.items.map(async (item: {
      photo_id: string;
      filename: string;
      preview_url: string | null;
      original_path: string;
      original_bucket?: string;
    }) => {
      const safeFilename = String(item.filename || "vaglan-clicks-photo")
        .replace(/[^\w.-]/g, "_")
        .slice(0, 160);
      const originalBucket = item.original_bucket || "photo-originals";
      if (!["private-originals", "originals", "photo-originals"].includes(originalBucket)) {
        throw new Error("The order contains an invalid original storage bucket.");
      }
      const { data, error } = await supabase.storage
        .from(originalBucket)
        .createSignedUrl(item.original_path, 900, { download: safeFilename });
      if (error || !data?.signedUrl) {
        throw error || new Error("Could not create a secure photo download.");
      }
      return {
        photoId: item.photo_id,
        filename: safeFilename,
        previewUrl: item.preview_url,
        downloadUrl: data.signedUrl,
      };
    }));

    return respond({
      status: order.status,
      currency: order.currency,
      subtotalCents: order.subtotal_cents,
      tipCents: order.tip_cents,
      totalCents: order.total_cents,
      items,
    });
  } catch (error) {
    console.error("Secure order download request failed:", error);
    return respond({ error: "Could not prepare your downloads. Please try again." }, 500);
  }
});
