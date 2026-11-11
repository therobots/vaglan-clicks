import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hashIp = async (ip: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Photo-removal service configuration is incomplete.");
    return respond({ error: "Server configuration is incomplete." }, 500);
  }

  try {
    const payload = await request.json();
    if (typeof payload?.photoId !== "string" || !uuidPattern.test(payload.photoId)) {
      return respond({ error: "Invalid photo ID." }, 400);
    }
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    const contact = typeof payload.contact === "string" ? payload.contact.trim() : "";
    if (reason.length > 1000 || contact.length > 320) {
      return respond({ error: "The request details are too long." }, 400);
    }

    const ipAddress =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.rpc("request_photo_removal", {
      photo_id_input: payload.photoId,
      reason_input: reason || null,
      contact_input: contact || null,
      ip_hash_input: await hashIp(ipAddress, serviceRoleKey),
    });
    if (error) {
      if (error.code === "P0002") return respond({ error: "This photo is no longer available." }, 404);
      if (error.code === "22023") return respond({ error: "The removal request is invalid." }, 400);
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error("The removal request was not recorded.");
    if (result.rate_limited) {
      return respond({ error: "Request limit reached. Please try again later." }, 429);
    }

    return respond({ success: true, requestId: result.request_id });
  } catch (error) {
    console.error("Photo-removal request failed:", error);
    return respond({ error: "Could not process the removal request." }, 500);
  }
});
