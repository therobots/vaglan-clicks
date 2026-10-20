# Photo ingestion contract

The current repository does not contain the camera-ingestion agent. Any uploader integrated with this gallery must follow this contract before it is used in production.

## Capture timestamps

- Store `photos.timestamp` as a UTC Unix timestamp in milliseconds. Do not store the uploader machine's local wall-clock time or a timezone-free camera string.
- Prefer EXIF `DateTimeOriginal` only when the camera clock has been checked and its offset is known. Configure `CAMERA_CLOCK_OFFSET_SECONDS` as **camera clock minus true time**; calculate the corrected capture time by subtracting that offset from the camera timestamp, then convert the result to UTC.
- If EXIF time is missing or invalid, use the NTP-synchronized laptop's UTC time from when the file is detected.
- At the start of each night, compare a fresh camera timestamp with the NTP-synchronized laptop clock. Warn the operator and record the measured drift when the absolute difference exceeds 60 seconds. Do not silently treat an unchecked camera timestamp as UTC.
- Preserve the original capture timestamp through upload and database insert; upload time is not a substitute for capture time when valid EXIF data is available.

## Night grouping and storage

- Compute `night_key` using the server's `gallery_night_key(timestamp)` function. Its rule is the Athens-local date of the capture time shifted back by 12 hours, so after-midnight captures remain grouped with the previous evening.
- Store preview and original objects under a night-prefixed path: `<night_key>/<photo-uuid>-<filename>`. Use the same night key for both versions.
- Keep uploads in the single permanent gallery collection; use the night key for organization.
- The database insert trigger computes `photos.expires_at`; upload clients must not set or override it.
- Use the secured server-side ingestion endpoint rather than writing directly to the `photos` table or Storage with the public anon key.

Before enabling ingestion, verify the laptop is NTP-synchronized, run the camera drift check, and confirm the corrected timestamp resolves to the expected Athens night.
