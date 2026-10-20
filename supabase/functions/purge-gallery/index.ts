import { createClient } from "npm:@supabase/supabase-js@2";

const previewBuckets = ["previews", "photos"] as const;
const originalsBuckets = ["originals", "photo-originals"] as const;
const corsHeaders = {
  "Access-Control-Allow-Headers": "content-type, x-purge-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type PurgeCandidate = {
  photo_id: string;
  preview_url: string | null;
  preview_bucket: string;
  original_path: string | null;
  original_bucket: string | null;
  delete_original: boolean;
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const constantTimeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
};

const getPreviewLocation = (url: string, supabaseUrl: string) => {
  const parsed = new URL(url);
  if (parsed.origin !== new URL(supabaseUrl).origin) {
    throw new Error("Preview is not stored in the configured Supabase project.");
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
  throw new Error("Could not identify the preview object path.");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const expectedSecret = Deno.env.get("PURGE_JOB_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const suppliedSecret = request.headers.get("x-purge-secret") || "";
  if (!expectedSecret || expectedSecret.length < 32 || !supabaseUrl || !serviceRoleKey) {
    console.error("Gallery purge function is missing secure server configuration.");
    return respond({ error: "Purge function is not configured." }, 503);
  }
  if (!constantTimeEqual(suppliedSecret, expectedSecret)) {
    return respond({ error: "Unauthorized." }, 401);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: settings, error: settingsError } = await client
      .from("gallery_state")
      .select("purge_enabled")
      .eq("id", 1)
      .single();
    if (settingsError) throw settingsError;

    const { data: candidates, error: candidateError } = await client.rpc(
      "gallery_purge_candidates",
      { limit_input: 500 },
    );
    if (candidateError) throw candidateError;
    const rows = (candidates || []) as PurgeCandidate[];
    const previewCount = rows.filter((candidate) => candidate.preview_url).length;
    const originalsCount = rows.filter(
      (candidate) => candidate.delete_original && candidate.original_path,
    ).length;

    if (!settings.purge_enabled) {
      console.info("Gallery purge dry run:", {
        expiredPhotoCount: rows.length,
        previewsToDelete: previewCount,
        originalsToDelete: originalsCount,
      });
      return respond({
        dryRun: true,
        expiredPhotoCount: rows.length,
        previewsToDelete: previewCount,
        originalsToDelete: originalsCount,
      });
    }

    const completedPhotoIds: string[] = [];
    let deletedPreviews = 0;
    let deletedOriginals = 0;
    let failedPhotos = 0;
    for (const candidate of rows) {
      try {
        if (candidate.preview_url) {
          if (!previewBuckets.includes(candidate.preview_bucket as typeof previewBuckets[number])) {
            throw new Error("Gallery purge returned an invalid preview bucket.");
          }
          const preview = getPreviewLocation(candidate.preview_url, supabaseUrl);
          const { error } = await client.storage.from(preview.bucket).remove([preview.path]);
          if (error) throw error;
          deletedPreviews += 1;
        }
        if (candidate.delete_original && candidate.original_path) {
          const originalBucket = candidate.original_bucket || "photo-originals";
          if (!originalsBuckets.includes(originalBucket as typeof originalsBuckets[number])) {
            throw new Error("Gallery purge returned an invalid original bucket.");
          }
          const { error } = await client.storage
            .from(originalBucket)
            .remove([candidate.original_path]);
          if (error) throw error;
          deletedOriginals += 1;
        }
        completedPhotoIds.push(candidate.photo_id);
      } catch (error) {
        failedPhotos += 1;
        console.error("Could not purge an expired photo:", candidate.photo_id, error);
      }
    }

    let deletedPhotoRows = 0;
    if (completedPhotoIds.length > 0) {
      const { data, error } = await client.rpc("gallery_finalize_purge", {
        photo_ids_input: completedPhotoIds,
      });
      if (error) throw error;
      deletedPhotoRows = Number(data) || 0;
    }
    console.info("Gallery purge completed:", {
      expiredPhotoCount: rows.length,
      deletedPhotoRows,
      deletedPreviews,
      deletedOriginals,
      failedPhotos,
    });
    return respond({
      dryRun: false,
      expiredPhotoCount: rows.length,
      deletedPhotoRows,
      deletedPreviews,
      deletedOriginals,
      failedPhotos,
    });
  } catch (error) {
    console.error("Gallery purge failed:", error);
    return respond({ error: "Gallery purge failed." }, 500);
  }
});
