#!/usr/bin/env python3
"""Watch a camera folder, process QR album markers, and upload ordinary photos to the active album."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import mimetypes
import os
import queue
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import ExifTags, Image, ImageOps
from supabase import Client, create_client
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

PREVIEW_BUCKET = "public-previews"
ORIGINALS_BUCKET = "private-originals"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
PHOTO_NAMESPACE = uuid.UUID("08650d10-527c-4c78-bec7-572573cd1d83")
ALBUM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
QR_CARD_PATTERN = re.compile(r"(?:^|[_-])(?:qr|album)[_-]?card(?:$|[_-])", re.IGNORECASE)
RETRY_DELAYS_SECONDS = (5, 15, 60, 300)
LOG = logging.getLogger("camera_bridge")


def _read_image_setting(name: str, default: int, minimum: int, maximum: int | None = None) -> int:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer.") from error
    if parsed < minimum or (maximum is not None and parsed > maximum):
        bounds = f"between {minimum} and {maximum}" if maximum is not None else f"at least {minimum}"
        raise ValueError(f"{name} must be {bounds}.")
    return parsed


PREVIEW_MAX_DIMENSION = _read_image_setting("VAGLAN_PREVIEW_MAX_DIMENSION", 1080, 1)
PREVIEW_QUALITY = _read_image_setting("VAGLAN_PREVIEW_QUALITY", 60, 1, 100)
THUMB_MAX_DIMENSION = _read_image_setting("VAGLAN_THUMB_MAX_DIMENSION", 300, 1)
THUMB_QUALITY = _read_image_setting("VAGLAN_THUMB_QUALITY", 60, 1, 100)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not configured.")
    return value


def validate_album_id(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Album ID must be a string.")
    album_id = value.strip()
    if not album_id or not ALBUM_ID_PATTERN.fullmatch(album_id):
        raise ValueError("Invalid album ID. Use letters, numbers, hyphens, or underscores only.")
    return album_id


def parse_album_url(raw_url: str, gallery_base_url: str | None = None) -> str | None:
    if not isinstance(raw_url, str):
        return None
    candidate = raw_url.strip()
    if not candidate:
        return None
    try:
        parsed = urlparse(candidate)
    except Exception:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if gallery_base_url:
        try:
            trusted = urlparse(gallery_base_url.strip())
        except Exception:
            return None
        if trusted.scheme not in {"http", "https"} or not trusted.netloc:
            return None
        if parsed.netloc != trusted.netloc:
            return None
        if trusted.path and parsed.path not in {trusted.path, trusted.path.rstrip("/") + "/"}:
            if not parsed.path.startswith(trusted.path.rstrip("/") + "/"):
                return None
    album_values = parse_qs(parsed.query, keep_blank_values=True).get("album", [])
    if len(album_values) != 1:
        return None
    try:
        return validate_album_id(album_values[0])
    except ValueError:
        return None


def is_qr_card_frame(path: Path) -> bool:
    configured = os.environ.get("CAMERA_QR_CARD_MODE", "").strip().lower()
    return configured in {"1", "true", "yes", "on"} or bool(QR_CARD_PATTERN.search(path.stem))


def detect_album_qr(path: Path, gallery_base_url: str | None = None) -> str | None:
    try:
        from pyzbar.pyzbar import decode
    except Exception:
        LOG.warning("pyzbar is not available or missing libzbar dependencies; QR decoding disabled.")
        return None
    try:
        with Image.open(path) as image:
            image.draft("RGB", (1600, 1600))
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            decoded = decode(image)
        if not decoded and is_qr_card_frame(path):
            with Image.open(path) as image:
                decoded = decode(image)
    except Exception:
        return None
    matches = set()
    for item in decoded:
        if not item.data:
            continue
        try:
            payload = item.data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        album = parse_album_url(payload, gallery_base_url)
        if album:
            matches.add(album)
    if len(matches) == 1:
        return next(iter(matches))
    if len(matches) > 1:
        LOG.warning("Conflicting album QR codes detected in %s; album session unchanged.", path)
        return "__conflict__"
    return None


class RetryJournal:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._entries: dict[str, dict[str, int | float]] = {}
        self._load()

    def _load(self) -> None:
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Could not read camera retry journal {self.path}.") from error
        if not isinstance(saved, dict):
            raise RuntimeError(f"Camera retry journal {self.path} has an invalid format.")

        for file_path, entry in saved.items():
            if (
                not isinstance(file_path, str)
                or not isinstance(entry, dict)
                or not isinstance(entry.get("attempts"), int)
                or isinstance(entry.get("attempts"), bool)
                or entry["attempts"] < 1
                or not isinstance(entry.get("next_attempt_at"), (int, float))
                or not math.isfinite(entry["next_attempt_at"])
            ):
                raise RuntimeError(f"Camera retry journal {self.path} has an invalid entry.")
            self._entries[file_path] = {
                "attempts": entry["attempts"],
                "next_attempt_at": float(entry["next_attempt_at"]),
            }

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_name(f"{self.path.name}.tmp")
        try:
            with temporary_path.open("w", encoding="utf-8") as journal_file:
                json.dump(self._entries, journal_file, separators=(",", ":"))
                journal_file.flush()
                os.fsync(journal_file.fileno())
            os.replace(temporary_path, self.path)
        except OSError as error:
            raise RuntimeError(f"Could not persist camera retry journal {self.path}.") from error
        finally:
            temporary_path.unlink(missing_ok=True)

    def is_waiting(self, file_path: str, now: float | None = None) -> bool:
        current_time = time.time() if now is None else now
        with self._lock:
            entry = self._entries.get(file_path)
            return bool(entry and entry["next_attempt_at"] > current_time)

    def due_paths(self, now: float | None = None) -> list[str]:
        current_time = time.time() if now is None else now
        with self._lock:
            return [
                file_path
                for file_path, entry in self._entries.items()
                if entry["next_attempt_at"] <= current_time
            ]

    def record_failure(self, file_path: str, now: float | None = None) -> int:
        current_time = time.time() if now is None else now
        with self._lock:
            attempts = self._entries.get(file_path, {}).get("attempts", 0) + 1
            delay = RETRY_DELAYS_SECONDS[min(attempts - 1, len(RETRY_DELAYS_SECONDS) - 1)]
            self._entries[file_path] = {
                "attempts": attempts,
                "next_attempt_at": current_time + delay,
            }
            self._save()
        return delay

    def remove(self, file_path: str) -> None:
        with self._lock:
            if self._entries.pop(file_path, None) is not None:
                self._save()

    def remove_missing_files(self) -> None:
        with self._lock:
            missing = [
                file_path for file_path in self._entries
                if not Path(file_path).is_file()
            ]
            for file_path in missing:
                del self._entries[file_path]
            if missing:
                self._save()

    @property
    def pending_count(self) -> int:
        with self._lock:
            return len(self._entries)


def safe_filename(filename: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip("._-")
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
        opened.draft("RGB", (2 * PREVIEW_MAX_DIMENSION, 2 * PREVIEW_MAX_DIMENSION))
        image = ImageOps.exif_transpose(opened)
        image.thumbnail(
            (PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION),
            Image.Resampling.LANCZOS,
        )
        image = image.convert("RGBA")

    with Image.open(watermark_path) as opened_watermark:
        watermark = opened_watermark.convert("RGBA")
    max_watermark_size = (max(1, int(image.width * 0.7)), max(1, int(image.height * 0.7)))
    watermark.thumbnail(max_watermark_size, Image.Resampling.LANCZOS)
    position = ((image.width - watermark.width) // 2, (image.height - watermark.height) // 2)
    image.alpha_composite(watermark, position)

    image.convert("RGB").save(preview_destination, format="WEBP", quality=PREVIEW_QUALITY, method=4)

    thumbnail = image.copy()
    thumbnail.thumbnail(
        (THUMB_MAX_DIMENSION, THUMB_MAX_DIMENSION),
        Image.Resampling.LANCZOS,
    )
    thumbnail.convert("RGB").save(
        thumbnail_destination,
        format="WEBP",
        quality=THUMB_QUALITY,
        method=4,
    )


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as image:
        for chunk in iter(lambda: image.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def upload_photo(
    client: Client,
    source: Path,
    watermark_path: Path,
    camera_timezone: ZoneInfo,
    offset_seconds: float,
    album_id: str,
) -> bool:
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
        .select("id, album_id")
        .eq("id", photo_id)
        .maybe_single()
        .execute()
    )
    if existing.data:
        current_album = existing.data.get("album_id") or "general"
        if current_album != album_id:
            LOG.warning(
                "Duplicate image %s already registered under album %s instead of %s; skipping upload.",
                source.name,
                current_album,
                album_id,
            )
            return False
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
                "album_id_input": album_id,
            },
        ).execute()
        row_created = True
        LOG.info("Uploaded %s as photo %s in album %s.", source.name, photo_id, album_id)
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


class CameraEventHandler(FileSystemEventHandler):
    def __init__(
        self,
        watch_dir: Path,
        queue_ref: "queue.Queue[str]",
        seen: set[str],
        retry_journal: RetryJournal,
    ):
        self.watch_dir = watch_dir
        self.queue_ref = queue_ref
        self.seen = seen
        self.retry_journal = retry_journal

    def _enqueue(self, path: str) -> None:
        normalized = str(Path(path).resolve())
        if normalized in self.seen or self.retry_journal.is_waiting(normalized):
            return
        self.seen.add(normalized)
        self.queue_ref.put(normalized)

    def on_created(self, event) -> None:
        if event.is_directory:
            return
        self._enqueue(event.src_path)

    def on_modified(self, event) -> None:
        if event.is_directory:
            return
        self._enqueue(event.src_path)


def process_pending_files(
    watch_dir: Path,
    queue_ref: "queue.Queue[str]",
    client: Client,
    watermark_path: Path,
    camera_timezone: ZoneInfo,
    offset_seconds: float,
    gallery_base_url: str | None,
    default_album: str | None,
    active_album: dict,
    seen: set[str],
    retry_journal: RetryJournal,
    last_success: dict[str, float | None],
) -> None:
    while not queue_ref.empty():
        file_path = Path(queue_ref.get())
        try:
            if not file_path.exists() or not file_path.is_file():
                retry_journal.remove(str(file_path.resolve()))
                continue
            if file_path.suffix.lower() not in PHOTO_EXTENSIONS:
                retry_journal.remove(str(file_path.resolve()))
                continue
            if file_path.resolve() == watermark_path:
                retry_journal.remove(str(file_path.resolve()))
                continue
            if not wait_until_stable(file_path):
                raise RuntimeError("The camera file is not stable yet.")
            album_marker = detect_album_qr(file_path, gallery_base_url)
            if album_marker == "__conflict__":
                LOG.warning("Skipping ambiguous album QR card %s without changing the active album.", file_path)
                retry_journal.remove(str(file_path.resolve()))
                continue
            if album_marker:
                previous = active_album.get("value")
                active_album["value"] = album_marker
                LOG.info("Album session changed from %s to %s after QR scan %s.", previous, album_marker, file_path.name)
                retry_journal.remove(str(file_path.resolve()))
                continue

            if not active_album.get("value") and not default_album:
                LOG.info("Skipping %s until an album is established. Set CAMERA_DEFAULT_ALBUM to enable a fallback.", file_path.name)
                retry_journal.remove(str(file_path.resolve()))
                continue
            album_name = active_album.get("value") or default_album or "general"
            try:
                album_name = validate_album_id(album_name)
            except ValueError:
                LOG.warning("Default album %r is invalid; falling back to general.", album_name)
                album_name = "general"
            active_album["value"] = album_name
            uploaded = upload_photo(
                client,
                file_path,
                watermark_path,
                camera_timezone,
                offset_seconds,
                album_name,
            )
            retry_journal.remove(str(file_path.resolve()))
            if uploaded:
                last_success["at"] = time.time()
        except Exception:
            retry_path = str(file_path.resolve())
            delay = retry_journal.record_failure(retry_path)
            seen.discard(retry_path)
            LOG.exception("Could not process %s; retrying in %s seconds.", file_path.name, delay)
        finally:
            queue_ref.task_done()


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    watch_dir = Path(required_env("CAMERA_WATCH_DIR")).expanduser().resolve()
    gallery_base_url = os.environ.get("GALLERY_BASE_URL", "").strip() or None
    default_album = os.environ.get("CAMERA_DEFAULT_ALBUM", "").strip() or None
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

    if gallery_base_url:
        LOG.info("Accepted gallery base URL: %s", gallery_base_url)
    else:
        LOG.warning("GALLERY_BASE_URL is not configured; QR album switching will be disabled until it is set.")

    if default_album:
        LOG.info("Default album fallback is enabled for the bridge: %s", default_album)
    else:
        LOG.info("No default album fallback is configured; the bridge waits for a valid QR album before uploading photos.")

    client = create_client(required_env("SUPABASE_URL"), required_env("SUPABASE_SERVICE_ROLE_KEY"))
    active_album = {"value": None}
    queue_ref: "queue.Queue[str]" = queue.Queue()
    seen: set[str] = set()
    retry_journal = RetryJournal(Path.home() / ".vaglan-clicks-camera-retries.json")
    retry_journal.remove_missing_files()
    handler = CameraEventHandler(watch_dir, queue_ref, seen, retry_journal)

    for photo_path in sorted(watch_dir.iterdir()):
        if photo_path.is_file() and photo_path.suffix.lower() in PHOTO_EXTENSIONS:
            handler._enqueue(str(photo_path.resolve()))

    observer = Observer()
    observer.schedule(handler, str(watch_dir), recursive=False)
    observer.start()
    LOG.info("Watching %s for new camera images.", watch_dir)

    last_success: dict[str, float | None] = {"at": None}
    last_summary_at = 0.0
    try:
        while True:
            for retry_path in retry_journal.due_paths():
                handler._enqueue(retry_path)
            process_pending_files(
                watch_dir,
                queue_ref,
                client,
                watermark_path,
                camera_timezone,
                offset_seconds,
                gallery_base_url,
                default_album,
                active_album,
                seen,
                retry_journal,
                last_success,
            )
            if time.time() - last_summary_at >= 60:
                last_success_text = (
                    datetime.fromtimestamp(last_success["at"]).astimezone().strftime("%H:%M:%S")
                    if last_success["at"] is not None
                    else "never"
                )
                LOG.info(
                    "%d pending, last success at %s.",
                    retry_journal.pending_count,
                    last_success_text,
                )
                last_summary_at = time.time()
            time.sleep(1)
    finally:
        observer.stop()
        observer.join()


if __name__ == "__main__":
    main()
