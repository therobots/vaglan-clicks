#!/usr/bin/env python3
"""Watch a camera folder and securely upload originals plus watermarked previews."""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import ExifTags, Image, ImageOps
from supabase import Client, create_client

PREVIEW_BUCKET = "public-previews"
ORIGINALS_BUCKET = "private-originals"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
PHOTO_NAMESPACE = uuid.UUID("08650d10-527c-4c78-bec7-572573cd1d83")
LOG = logging.getLogger("camera_bridge")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not configured.")
    return value


def safe_filename(filename: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip(".-_")
    return (stem or "photo")[:100]


def corrected_capture_time(image: Image.Image, camera_timezone: ZoneInfo, offset_seconds: float) -> int:
    exif = image.getexif()
    exif_ifd = exif.get_ifd(ExifTags.IFD.Exif) if exif else {}
    capture_value = exif_ifd.get(ExifTags.Base.DateTimeOriginal) or exif.get(ExifTags.Base.DateTime)

    if isinstance(capture_value, str):
        try:
            camera_time = datetime.strptime(capture_value, "%Y:%m:%d %H:%M:%S")
            corrected = camera_time.replace(tzinfo=camera_timezone) - timedelta(seconds=offset_seconds)
            if abs((datetime.now(timezone.utc) - corrected.astimezone(timezone.utc)).total_seconds()) > 60:
                LOG.warning("Camera capture timestamp differs from current UTC by more than 60 seconds.")
            return int(corrected.timestamp() * 1000)
        except ValueError:
            LOG.warning("Ignoring invalid EXIF capture timestamp %r.", capture_value)

    return int(datetime.now(timezone.utc).timestamp() * 1000)


def athens_night_key(timestamp_ms: int) -> str:
    capture = datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc)
    return (capture.astimezone(ZoneInfo("Europe/Athens")) - timedelta(hours=12)).date().isoformat()


def prepare_previews(
    source: Path,
    watermark_path: Path,
    preview_destination: Path,
    thumbnail_destination: Path,
) -> None:
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    if image.width > 1280:
        preview_height = max(1, round(image.height * 1280 / image.width))
        image = image.resize((1280, preview_height), Image.Resampling.LANCZOS)

    with Image.open(watermark_path) as opened_watermark:
        watermark = opened_watermark.convert("RGBA")
    max_watermark_size = (max(1, int(image.width * 0.7)), max(1, int(image.height * 0.7)))
    watermark.thumbnail(max_watermark_size, Image.Resampling.LANCZOS)
    position = ((image.width - watermark.width) // 2, (image.height - watermark.height) // 2)
    image.alpha_composite(watermark, position)

    image.convert("RGB").save(preview_destination, format="WEBP", quality=75, method=6)
    thumbnail = image
    if thumbnail.width > 300:
        thumbnail_height = max(1, round(thumbnail.height * 300 / thumbnail.width))
        thumbnail = thumbnail.resize((300, thumbnail_height), Image.Resampling.LANCZOS)
    thumbnail.convert("RGB").save(thumbnail_destination, format="WEBP", quality=75, method=6)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as image:
        for chunk in iter(lambda: image.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def upload_photo(client: Client, source: Path, watermark_path: Path, camera_timezone: ZoneInfo,
                 offset_seconds: float) -> bool:
    digest = file_sha256(source)
    photo_id = str(uuid.uuid5(PHOTO_NAMESPACE, digest))
    timestamp_ms: int
    with Image.open(source) as image:
        timestamp_ms = corrected_capture_time(image, camera_timezone, offset_seconds)

    night_key = athens_night_key(timestamp_ms)
    suffix = source.suffix.lower()
    base_name = f"{photo_id}-{safe_filename(source.name)}"
    original_path = f"{night_key}/{base_name}{suffix}"
    preview_path = f"{night_key}/{photo_id}-{safe_filename(source.name)}.webp"
    thumbnail_path = f"{night_key}/thumbs/{photo_id}-{safe_filename(source.name)}.webp"

    existing = (
        client.table("photos")
        .select("id")
        .eq("id", photo_id)
        .maybe_single()
        .execute()
    )
    if existing.data:
        LOG.info("Skipping previously uploaded file %s.", source.name)
        return False

    preview_file = source.with_name(f".{photo_id}.preview.webp")
    thumbnail_file = source.with_name(f".{photo_id}.thumbnail.webp")
    original_uploaded = False
    preview_uploaded = False
    thumbnail_uploaded = False
    row_created = False
    try:
        mime_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        with source.open("rb") as original:
            client.storage.from_(ORIGINALS_BUCKET).upload(
                original_path,
                original,
                file_options={"content-type": mime_type, "upsert": "false"},
            )
        original_uploaded = True

        prepare_previews(source, watermark_path, preview_file, thumbnail_file)
        with preview_file.open("rb") as preview:
            client.storage.from_(PREVIEW_BUCKET).upload(
                preview_path,
                preview,
                file_options={
                    "content-type": "image/webp",
                    "cache-control": "31536000",
                    "upsert": "false",
                },
            )
        preview_uploaded = True
        with thumbnail_file.open("rb") as thumbnail:
            client.storage.from_(PREVIEW_BUCKET).upload(
                thumbnail_path,
                thumbnail,
                file_options={
                    "content-type": "image/webp",
                    "cache-control": "31536000",
                    "upsert": "false",
                },
            )
        thumbnail_uploaded = True

        preview_url = client.storage.from_(PREVIEW_BUCKET).get_public_url(preview_path)
        thumbnail_url = client.storage.from_(PREVIEW_BUCKET).get_public_url(thumbnail_path)
        client.rpc(
            "register_ingested_photo",
            {
                "photo_id_input": photo_id,
                "preview_url_input": preview_url,
                "thumbnail_url_input": thumbnail_url,
                "filename_input": source.name[:255],
                "timestamp_input": timestamp_ms,
                "original_path_input": original_path,
                "original_bucket_input": ORIGINALS_BUCKET,
            },
        ).execute()
        row_created = True
        LOG.info("Uploaded %s as photo %s.", source.name, photo_id)
        return True
    except Exception:
        if row_created:
            try:
                client.table("photos").delete().eq("id", photo_id).execute()
            except Exception:
                LOG.exception("Could not roll back photo database row %s.", photo_id)
        if preview_uploaded:
            try:
                client.storage.from_(PREVIEW_BUCKET).remove([preview_path])
            except Exception:
                LOG.exception("Could not remove failed preview upload %s.", preview_path)
        if thumbnail_uploaded:
            try:
                client.storage.from_(PREVIEW_BUCKET).remove([thumbnail_path])
            except Exception:
                LOG.exception("Could not remove failed thumbnail upload %s.", thumbnail_path)
        if original_uploaded:
            try:
                client.storage.from_(ORIGINALS_BUCKET).remove([original_path])
            except Exception:
                LOG.exception("Could not remove failed original upload %s.", original_path)
        raise
    finally:
        preview_file.unlink(missing_ok=True)
        thumbnail_file.unlink(missing_ok=True)


def wait_until_stable(path: Path, stable_checks: int = 3, interval_seconds: float = 1.0) -> bool:
    previous_size = -1
    stable_count = 0
    for _ in range(60):
        try:
            current_size = path.stat().st_size
        except FileNotFoundError:
            return False
        if current_size > 0 and current_size == previous_size:
            stable_count += 1
            if stable_count >= stable_checks:
                return True
        else:
            stable_count = 0
        previous_size = current_size
        time.sleep(interval_seconds)
    LOG.error("File did not finish writing within 60 seconds: %s", path)
    return False


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    watch_dir = Path(required_env("CAMERA_WATCH_DIR")).expanduser().resolve()
    watermark_value = os.environ.get("WATERMARK_IMAGE")
    watermark_path = (
        Path(watermark_value).expanduser().resolve()
        if watermark_value
        else Path(__file__).resolve().parent.parent / "src" / "assets" / "watermark.png"
    )
    if not watch_dir.is_dir():
        raise RuntimeError(f"CAMERA_WATCH_DIR is not a directory: {watch_dir}")
    if not watermark_path.is_file():
        raise RuntimeError(f"Watermark image does not exist: {watermark_path}")

    try:
        camera_timezone = ZoneInfo(os.environ.get("CAMERA_TIMEZONE", "UTC"))
    except ZoneInfoNotFoundError as error:
        raise RuntimeError("CAMERA_TIMEZONE must be a valid IANA timezone.") from error
    try:
        offset_seconds = float(os.environ.get("CAMERA_CLOCK_OFFSET_SECONDS", "0"))
    except ValueError as error:
        raise RuntimeError("CAMERA_CLOCK_OFFSET_SECONDS must be numeric.") from error

    client = create_client(required_env("SUPABASE_URL"), required_env("SUPABASE_SERVICE_ROLE_KEY"))
    LOG.info("Watching %s for new camera images.", watch_dir)
    while True:
        for photo_path in sorted(watch_dir.iterdir()):
            if not photo_path.is_file() or photo_path.suffix.lower() not in PHOTO_EXTENSIONS:
                continue
            if photo_path.resolve() == watermark_path:
                continue
            if not wait_until_stable(photo_path):
                continue
            try:
                upload_photo(client, photo_path, watermark_path, camera_timezone, offset_seconds)
            except Exception:
                LOG.exception("Could not upload %s; it will be retried.", photo_path.name)
                time.sleep(5)
        time.sleep(1)


if __name__ == "__main__":
    main()
