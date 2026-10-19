import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const previewBucket = "photos";
const originalsBucket = "photo-originals";
const sessionDurationMs = 4 * 60 * 60 * 1000;
const maxLoginFailures = 5;
const loginWindowMs = 15 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const newSessionToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const getPreviewPath = (url: string, supabaseUrl: string) => {
  const parsed = new URL(url);
  if (parsed.origin !== new URL(supabaseUrl).origin) {
    throw new Error("Photo preview is not stored in the configured Supabase project.");
  }
  const prefixes = [
    `/storage/v1/object/public/${previewBucket}/`,
    `/storage/v1/object/sign/${previewBucket}/`,
  ];
  const prefix = prefixes.find((candidate) => parsed.pathname.startsWith(candidate));
  if (!prefix) throw new Error("Could not identify the photo preview object in Storage.");
  return parsed.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
};

const listAllObjects = async (storage: ReturnType<typeof createClient>["storage"], bucket: string) => {
  const files: string[] = [];
  const pendingFolders = [""];

  while (pendingFolders.length) {
    const folder = pendingFolders.pop()!;
    let offset = 0;
    while (true) {
      const { data, error } = await storage.from(bucket).list(folder, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      for (const entry of data || []) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.id === null && entry.metadata === null) pendingFolders.push(path);
        else files.push(path);
      }
      if (!data || data.length < 1000) break;
      offset += data.length;
    }
  }

  return files;
};

const removeObjects = async (
  storage: ReturnType<typeof createClient>["storage"],
  bucket: string,
  paths: string[],
) => {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await storage.from(bucket).remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase Edge Function service configuration.");
    return respond({ error: "Server configuration is incomplete." }, 500);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const payload = await request.json();
    const action = payload?.action;

    if (action === "login") {
      const pin = typeof payload.pin === "string" ? payload.pin : "";
      if (pin.length < 4 || pin.length > 128) return respond({ error: "Enter a valid admin PIN." }, 400);

      const ipAddress =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown";
      const cutoff = new Date(Date.now() - loginWindowMs).toISOString();
      const { error: cleanupError } = await client.rpc("clear_gallery_admin_attempts", {
        ip_input: null,
        cutoff,
      });
      if (cleanupError) throw cleanupError;
      const { data: count, error: attemptsError } = await client.rpc(
        "count_gallery_admin_attempts",
        { ip_input: ipAddress, cutoff },
      );
      if (attemptsError) throw attemptsError;
      if ((count || 0) >= maxLoginFailures) {
        return respond({ error: "Too many incorrect PIN attempts. Try again in 15 minutes." }, 429);
      }

      const { data: isValid, error: verifyError } = await client.rpc(
        "verify_gallery_admin_pin",
        { pin_input: pin },
      );
      if (verifyError) throw verifyError;
      if (!isValid) {
        const { error } = await client.rpc("record_gallery_admin_attempt", {
          ip_input: ipAddress,
        });
        if (error) throw error;
        return respond({ error: "Incorrect admin PIN." }, 401);
      }

      const { error: clearError } = await client.rpc("clear_gallery_admin_attempts", {
        ip_input: ipAddress,
        cutoff: null,
      });
      if (clearError) throw clearError;
      const token = newSessionToken();
      const { error: sessionError } = await client.rpc("create_gallery_admin_session", {
          token_hash: await sha256(token),
          expiry_input: new Date(Date.now() + sessionDurationMs).toISOString(),
        });
      if (sessionError) throw sessionError;
      return respond({ sessionToken: token });
    }

    if (action === "download-free") {
      if (typeof payload.photoId !== "string" || !uuidPattern.test(payload.photoId)) {
        return respond({ error: "Invalid photo ID." }, 400);
      }
      const { data: photo, error: photoError } = await client
        .from("photos")
        .select("id, filename, is_free")
        .eq("id", payload.photoId)
        .maybeSingle();
      if (photoError) throw photoError;
      if (!photo?.is_free) return respond({ error: "This photo is not marked free." }, 403);

      const { data: originalPath, error: originalError } = await client.rpc(
        "get_photo_original_path",
        { photo_id_input: photo.id },
      );
      if (originalError) throw originalError;
      if (!originalPath) return respond({ error: "The original photo is unavailable." }, 404);

      const { data: signed, error: signError } = await client.storage
        .from(originalsBucket)
        .createSignedUrl(originalPath, 60, {
          download: photo.filename || true,
        });
      if (signError) throw signError;
      return respond({ url: signed.signedUrl });
    }

    const sessionToken = typeof payload.sessionToken === "string" ? payload.sessionToken : "";
    if (!sessionToken || sessionToken.length > 256) {
      return respond({ error: "Admin session expired. Sign in again." }, 401);
    }
    const { data: sessionValid, error: sessionError } = await client.rpc(
      "validate_gallery_admin_session",
      { hash_input: await sha256(sessionToken) },
    );
    if (sessionError) throw sessionError;
    if (!sessionValid) return respond({ error: "Admin session expired. Sign in again." }, 401);

    if (action === "list-photos") {
      const photos = [];
      let offset = 0;
      while (true) {
        const { data, error } = await client
          .from("photos")
          .select("id, preview_url, filename, timestamp, is_free")
          .order("timestamp", { ascending: false })
          .range(offset, offset + 999);
        if (error) throw error;
        photos.push(...(data || []));
        if (!data || data.length < 1000) break;
        offset += data.length;
      }
      return respond({ photos });
    }

    if (action === "make-free" || action === "delete-photo") {
      if (typeof payload.photoId !== "string" || !uuidPattern.test(payload.photoId)) {
        return respond({ error: "Invalid photo ID." }, 400);
      }
      const { data: photo, error: photoError } = await client
        .from("photos")
        .select("id, preview_url, is_free")
        .eq("id", payload.photoId)
        .maybeSingle();
      if (photoError) throw photoError;
      if (!photo) return respond({ error: "Photo no longer exists." }, 404);

      if (action === "make-free") {
        const { error } = await client
          .from("photos")
          .update({ is_free: true })
          .eq("id", photo.id);
        if (error) throw error;
        return respond({ success: true });
      }

      const previewPath = getPreviewPath(photo.preview_url, supabaseUrl);
      const { data: originalPath, error: originalError } = await client.rpc(
        "get_photo_original_path",
        { photo_id_input: photo.id },
      );
      if (originalError) throw originalError;
      if (originalPath) {
        const { error } = await client.storage.from(originalsBucket).remove([originalPath]);
        if (error) throw error;
      }
      const { error: previewError } = await client.storage.from(previewBucket).remove([previewPath]);
      if (previewError) throw previewError;
      const { error: metadataError } = await client.rpc("delete_photo_original_path", {
        photo_id_input: photo.id,
      });
      if (metadataError) throw metadataError;
      const { error: deleteError } = await client.from("photos").delete().eq("id", photo.id);
      if (deleteError) throw deleteError;
      return respond({ success: true });
    }

    if (action === "reset-gallery") {
      const objectPaths = await listAllObjects(client.storage, previewBucket);
      await removeObjects(client.storage, previewBucket, objectPaths);
      const { data: deletedCount, error } = await client.rpc("reset_gallery_photos");
      if (error) throw error;
      return respond({ success: true, deletedCount });
    }

    if (action === "start-timer") {
      const { data: timerEndsAt, error } = await client.rpc("start_gallery_timer");
      if (error) throw error;
      return respond({ timerEndsAt });
    }

    return respond({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("Gallery admin operation failed:", error);
    return respond({ error: error instanceof Error ? error.message : "Admin request failed." }, 500);
  }
});
