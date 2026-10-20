import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const previewBuckets = ["previews", "photos"] as const;
const originalsBuckets = ["originals", "photo-originals"] as const;
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
  for (const bucket of previewBuckets) {
    const prefixes = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
    ];
    const prefix = prefixes.find((candidate) => parsed.pathname.startsWith(candidate));
    if (prefix) {
      return {
        bucket,
        path: parsed.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/"),
      };
    }
  }
  throw new Error("Could not identify the photo preview object in Storage.");
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

const deletePhotoFiles = async (
  client: ReturnType<typeof createClient>,
  photoId: string,
  supabaseUrl: string,
) => {
  const { data: photo, error: photoError } = await client
    .from("photos")
    .select("id, preview_url")
    .eq("id", photoId)
    .maybeSingle();
  if (photoError) throw photoError;
  if (!photo) return false;

  const preview = getPreviewPath(photo.preview_url, supabaseUrl);
  const { data: original, error: originalError } = await client.rpc(
    "get_photo_original_info",
    { photo_id_input: photo.id },
  );
  if (originalError) throw originalError;
  if (
    typeof original?.object_path !== "string" ||
    !originalsBuckets.includes(original.storage_bucket)
  ) {
    throw new Error("Original photo storage metadata is unavailable.");
  }
  const [originalRemoval, previewRemoval] = await Promise.all([
    client.storage.from(original.storage_bucket).remove([original.object_path]),
    client.storage.from(preview.bucket).remove([preview.path]),
  ]);
  if (originalRemoval.error || previewRemoval.error) {
    throw new Error(
      [
        originalRemoval.error?.message && `Original: ${originalRemoval.error.message}`,
        previewRemoval.error?.message && `Preview: ${previewRemoval.error.message}`,
      ].filter(Boolean).join("; "),
    );
  }
  const { error: metadataError } = await client.rpc("delete_photo_original_path", {
    photo_id_input: photo.id,
  });
  if (metadataError) throw metadataError;
  const { error: deleteError } = await client.from("photos").delete().eq("id", photo.id);
  if (deleteError) throw deleteError;
  const { error: closeRequestsError } = await client.rpc(
    "admin_close_photo_removal_requests",
    { photo_id_input: photo.id },
  );
  if (closeRequestsError) throw closeRequestsError;
  return true;
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
        hash_input: await sha256(token),
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
        .select("id, filename, is_free, is_hidden, expires_at")
        .eq("id", payload.photoId)
        .maybeSingle();
      if (photoError) throw photoError;
      if (!photo?.is_free) return respond({ error: "This photo is not marked free." }, 403);
      if (photo.is_hidden || !photo.expires_at || Date.parse(photo.expires_at) <= Date.now()) {
        return respond({ error: "This photo is no longer available for download." }, 410);
      }

      const { data: original, error: originalError } = await client.rpc(
        "get_photo_original_info",
        { photo_id_input: photo.id },
      );
      if (originalError) throw originalError;
      if (
        typeof original?.object_path !== "string" ||
        !originalsBuckets.includes(original.storage_bucket)
      ) {
        return respond({ error: "The original photo is unavailable." }, 404);
      }

      const { data: signed, error: signError } = await client.storage
        .from(original.storage_bucket)
        .createSignedUrl(original.object_path, 60, {
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
          .select("id, preview_url, filename, timestamp, created_at, is_free, is_hidden, expires_at")
          .order("timestamp", { ascending: false })
          .range(offset, offset + 999);
        if (error) throw error;
        photos.push(...(data || []));
        if (!data || data.length < 1000) break;
        offset += data.length;
      }
      return respond({ photos });
    }

    if (action === "list-removals") {
      const { data, error } = await client.rpc("admin_list_photo_removal_requests");
      if (error) throw error;
      return respond({ requests: data || [] });
    }

    if (action === "gallery-report") {
      const { data, error } = await client.rpc("admin_gallery_report");
      if (error) throw error;
      return respond({ nights: data || [] });
    }

    if (action === "sales-report") {
      const sales = [];
      let offset = 0;
      while (true) {
        const { data, error } = await client
          .rpc("admin_sales_report")
          .range(offset, offset + 999);
        if (error) throw error;
        sales.push(...(data || []));
        if (!data || data.length < 1000) break;
        offset += data.length;
      }
      return respond({ sales });
    }

    if (action === "make-free-bulk") {
      if (
        !Array.isArray(payload.photoIds) ||
        payload.photoIds.length < 1 ||
        payload.photoIds.length > 100 ||
        payload.photoIds.some((id: unknown) => typeof id !== "string" || !uuidPattern.test(id))
      ) {
        return respond({ error: "Select between 1 and 100 valid photos." }, 400);
      }
      const ids = [...new Set<string>(payload.photoIds)];
      const { data, error } = await client
        .from("photos")
        .update({ is_free: true })
        .in("id", ids)
        .select("id");
      if (error) throw error;
      return respond({ success: true, updatedIds: (data || []).map((photo) => photo.id) });
    }

    if (action === "delete-photos-bulk") {
      if (
        !Array.isArray(payload.photoIds) ||
        payload.photoIds.length < 1 ||
        payload.photoIds.length > 100 ||
        payload.photoIds.some((id: unknown) => typeof id !== "string" || !uuidPattern.test(id))
      ) {
        return respond({ error: "Select between 1 and 100 valid photos." }, 400);
      }
      const deletedIds: string[] = [];
      const failures: { photoId: string; error: string }[] = [];
      for (const photoId of [...new Set<string>(payload.photoIds)]) {
        try {
          if (await deletePhotoFiles(client, photoId, supabaseUrl)) deletedIds.push(photoId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Photo deletion failed.";
          failures.push({ photoId, error: message });
        }
      }
      return respond({ success: failures.length === 0, deletedIds, failures });
    }

    if (action === "restore-removal") {
      if (typeof payload.requestId !== "string" || !uuidPattern.test(payload.requestId)) {
        return respond({ error: "Invalid removal request ID." }, 400);
      }
      const { data: restored, error } = await client.rpc("admin_restore_photo_removal", {
        request_id_input: payload.requestId,
      });
      if (error) throw error;
      if (!restored) return respond({ error: "The hidden photo can no longer be restored." }, 409);
      const { data: requestRows, error: listError } = await client.rpc(
        "admin_list_photo_removal_requests",
      );
      if (listError) throw listError;
      const matched = (requestRows || []).find((item: { request_id: string }) =>
        item.request_id === payload.requestId
      );
      if (matched?.photo_id) {
        try {
          const { error: broadcastError } = await client.channel("public:gallery-removals").send({
            type: "broadcast",
            event: "photo-restored",
            payload: { photoId: matched.photo_id },
          });
          if (broadcastError) console.error("Photo restoration broadcast failed:", broadcastError);
        } catch (broadcastError) {
          console.error("Photo restoration broadcast failed:", broadcastError);
        }
      }
      return respond({ success: true });
    }

    let photoId = payload.photoId;
    if (action === "delete-removal") {
      if (typeof payload.requestId !== "string" || !uuidPattern.test(payload.requestId)) {
        return respond({ error: "Invalid removal request ID." }, 400);
      }
      const { data: requestRows, error: listError } = await client.rpc(
        "admin_list_photo_removal_requests",
      );
      if (listError) throw listError;
      const request = (requestRows || []).find((item: { request_id: string; status: string }) =>
        item.request_id === payload.requestId && item.status === "pending"
      );
      if (!request) return respond({ error: "The pending removal request was not found." }, 404);
      photoId = request.photo_id;
    }

    if (action === "make-free" || action === "delete-photo" || action === "delete-removal") {
      if (typeof photoId !== "string" || !uuidPattern.test(photoId)) {
        return respond({ error: "Invalid photo ID." }, 400);
      }
      const { data: photo, error: photoError } = await client
        .from("photos")
        .select("id, preview_url, is_free")
        .eq("id", photoId)
        .maybeSingle();
      if (photoError) throw photoError;
      if (!photo && action === "delete-removal") {
        const { data: marked, error: markError } = await client.rpc(
          "admin_mark_photo_removal_deleted",
          { request_id_input: payload.requestId },
        );
        if (markError) throw markError;
        if (marked) return respond({ success: true });
      }
      if (!photo) return respond({ error: "Photo no longer exists." }, 404);

      if (action === "make-free") {
        const { error } = await client
          .from("photos")
          .update({ is_free: true })
          .eq("id", photo.id);
        if (error) throw error;
        return respond({ success: true });
      }

      const deleted = await deletePhotoFiles(client, photo.id, supabaseUrl);
      if (!deleted) return respond({ error: "Photo no longer exists." }, 404);
      return respond({ success: true });
    }

    if (action === "reset-gallery") {
      for (const bucket of previewBuckets) {
        const objectPaths = await listAllObjects(client.storage, bucket);
        await removeObjects(client.storage, bucket, objectPaths);
      }
      const { data: deletedCount, error } = await client.rpc("reset_gallery_photos");
      if (error) throw error;
      return respond({ success: true, deletedCount });
    }

    return respond({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("Gallery admin operation failed:", error);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    const errorMessage =
      typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "";
    if (errorCode === "PGRST202" || errorCode === "42883") {
      return respond(
        { error: "Admin database setup is incomplete. Apply the admin migration, then retry." },
        503,
      );
    }
    return respond({ error: errorMessage || "Admin request failed." }, 500);
  }
});
