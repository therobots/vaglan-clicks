# Camera bridge and photo ingestion

The repository includes [`bridge/camera_bridge.py`](../bridge/camera_bridge.py), a local folder watcher and uploader. It stores untouched full-quality originals in the private `private-originals` bucket and creates a low-resolution WebP preview plus a WebP thumbnail with the watermark baked into the image pixels in the public `public-previews` bucket. The public bucket must contain only these marked previews and thumbnails; never upload or serve a raw original publicly. Public image objects receive a one-year cache lifetime. The physical watermark uses `src/assets/watermark.png`; override its location with `WATERMARK_IMAGE` if needed.

Install and run the bridge from the repository root in PowerShell:

```powershell
python -m pip install -r bridge\requirements.txt
$env:CAMERA_WATCH_DIR = "C:\path\to\camera\folder"
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVER_SIDE_SERVICE_ROLE_KEY"
$env:CAMERA_TIMEZONE = "Europe/Athens"
python bridge\camera_bridge.py
```

The bridge requires the active Supabase migrations, including `20261021170000_watermarked_photo_delivery.sql` and `20261107000000_watermark_baked_flag.sql`, before it can register photos. The latter migration adds `photos.watermark_baked`; public `gallery_photos`, `gallery_nights`, and `gallery_slots` expose only rows marked true. New bridge uploads are registered as baked. The service-role key is privileged: keep it only in the trusted local process environment, never in frontend variables, source control, or browser code.

## Shared preview settings

The bridge and Admin uploader use the same defaults: preview maximum dimension **1080 px** at **60%** WebP quality, and thumbnail maximum dimension **300 px** at **60%** quality. The bridge can override these settings with environment variables:

```powershell
$env:VAGLAN_PREVIEW_MAX_DIMENSION = "1080"
$env:VAGLAN_PREVIEW_QUALITY = "60"
$env:VAGLAN_THUMB_MAX_DIMENSION = "300"
$env:VAGLAN_THUMB_QUALITY = "60"
```

The browser/Admin uploader uses the corresponding `VITE_PREVIEW_MAX_DIMENSION`, `VITE_PREVIEW_QUALITY`, `VITE_THUMB_MAX_DIMENSION`, and `VITE_THUMB_QUALITY` settings. Keep the bridge and Vite values aligned when overriding defaults. These values are not secrets; Supabase service-role credentials must never use a `VITE_` variable.

After deploying bridge changes, update the code on the camera laptop and restart the bridge process so it uses the current sizing, quality, and watermark implementation.

The bridge asks Pillow to decode JPEGs at a reduced draft size, then resizes previews with Lanczos and uses WebP method 4 to reduce processing time. QR detection scans at up to 1600 px first. It retries at full resolution only for filenames containing `qr-card` or `album-card`, or when `CAMERA_QR_CARD_MODE=1` is set for a scan session. Transient file, network, or upload failures are written to `%USERPROFILE%\.vaglan-clicks-camera-retries.json` and retried after increasing delays (5 seconds, 15 seconds, 60 seconds, then every 5 minutes). Keep the journal with the camera laptop's local data; the bridge logs its pending retry count and most recent successful upload.

## Album QR sessions

- The camera bridge supports QR-driven album sessions. Scan a valid gallery card that points to `https://your-gallery.example/?album=042`; the bridge accepts only URLs from the configured `GALLERY_BASE_URL` host and path and rejects missing, duplicate, malformed, or malicious `album` parameters.
- The bridge keeps a current session album in memory and uploads subsequent photos to that album until another trusted QR card is scanned. The active album is stored in the `photos.album_id` column; legacy rows default to `general`.
- Building a QR card is simple: generate a URL like `https://your-gallery.example/?album=042`, then print it with the helper in [`tools/qr_cards/generate_album_cards.py`](../tools/qr_cards/generate_album_cards.py). The script renders A4 sheets with QR labels that can be printed and handed to the camera operator.
- The bridge ignores ambiguous QR cards (`__conflict__` when multiple albums are detected) and waits for a trusted single-album scan before changing the active album. A fallback `CAMERA_DEFAULT_ALBUM` remains optional but should be treated as a safe default only for a single known collection.

## Capture timestamps

- Store `photos.timestamp` as a UTC Unix timestamp in milliseconds. Do not store the uploader machine's local wall-clock time or a timezone-free camera string.
- Prefer EXIF `DateTimeOriginal` only when the camera clock has been checked and its offset is known. Configure `CAMERA_CLOCK_OFFSET_SECONDS` as **camera clock minus true time**; calculate the corrected capture time by subtracting that offset from the camera timestamp, then convert the result to UTC.
- If EXIF time is missing or invalid, use the NTP-synchronized laptop's UTC time from when the file is detected.
- At the start of each night, compare a fresh camera timestamp with the NTP-synchronized laptop clock. Warn the operator and record the measured drift when the absolute difference exceeds 60 seconds. Do not silently treat an unchecked camera timestamp as UTC.
- Preserve the original capture timestamp through upload and database insert; upload time is not a substitute for capture time when valid EXIF data is available.

## Night grouping and storage

- Compute `night_key` using the server's `gallery_night_key(timestamp)` function. Its rule is the Athens-local date of the capture time shifted back by 12 hours, so after-midnight captures remain grouped with the previous evening.
- Store original and preview objects under night-prefixed paths: `<night_key>/<photo-uuid>-<filename>`. Store thumbnails under `<night_key>/thumbs/<photo-uuid>-<filename>.webp`.
- Keep uploads in the single permanent gallery collection; use the night key for organization.
- The database insert trigger computes `photos.expires_at`; upload clients must not set or override it.
- The bridge uses the service role only in its trusted local process to upload the three assets and register their paths. Never upload originals from browser code or with the public anon key.

Before enabling ingestion, verify the laptop is NTP-synchronized, run the camera drift check, and confirm the corrected timestamp resolves to the expected Athens night.

## Rebuilding legacy previews

Legacy rows remain hidden from public gallery RPCs until `watermark_baked` is true. Run the rebuild utility from the repository root, using a trusted operator environment with the service-role key set. It reuses the bridge's `prepare_previews` implementation, looks up originals with `get_photo_original_info`, moves recoverable legacy sources into `private-originals`, uploads new marked WebP files to `public-previews`, updates the photo row, and only then removes old objects from the legacy public buckets. It never removes objects from `private-originals`.

The default is a **dry run**: it downloads/processes candidates and reports rebuildable photos without changing storage or database rows.

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVER_SIDE_SERVICE_ROLE_KEY"
python tools\rebuild_previews.py
```

Review the dry-run failures, missing-original list, and remaining object counts for `photos` and `previews`. Back up the database and legacy Storage objects, then explicitly pass `--apply` to upload, update, and remove legacy public objects. Use `--limit N` to process a small batch first; rerunning is safe and resumes rows that remain unmarked.

```powershell
python tools\rebuild_previews.py --limit 10 --apply
python tools\rebuild_previews.py --apply
```

The script refuses to delete a legacy public object unless the original is verified in `private-originals` and the replacement preview and thumbnail have been uploaded and recorded. Failed legacy-object cleanup is saved to `%USERPROFILE%\.vaglan-clicks-rebuild-pending.json` and retried on the next `--apply` run. Photos without a recoverable original stay unmarked and hidden; restore a trusted original before retrying them. Never run with `--apply` until the dry-run report and backups have been reviewed.
