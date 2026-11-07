# Camera bridge and photo ingestion

The repository includes [`bridge/camera_bridge.py`](../bridge/camera_bridge.py), a local folder watcher and uploader. It stores untouched originals in the private `private-originals` bucket and creates a watermarked WebP preview plus a 300px WebP thumbnail in the public `public-previews` bucket. Public image objects receive a one-year cache lifetime. The physical watermark uses `src/assets/watermark.png`; override its location with `WATERMARK_IMAGE` if needed.

Install and run the bridge from the repository root in PowerShell:

```powershell
python -m pip install -r bridge\requirements.txt
$env:CAMERA_WATCH_DIR = "C:\path\to\camera\folder"
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVER_SIDE_SERVICE_ROLE_KEY"
$env:CAMERA_TIMEZONE = "Europe/Athens"
python bridge\camera_bridge.py
```

The bridge requires the active Supabase migrations, including `20261021170000_watermarked_photo_delivery.sql`, before it can register photos. The service-role key is privileged: keep it only in the trusted local process environment, never in frontend variables, source control, or browser code.

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
