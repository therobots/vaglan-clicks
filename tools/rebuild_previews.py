#!/usr/bin/env python3
"""Rebuild public WebP previews with baked watermarks from stored originals."""

from __future__ import annotations

import argparse
import mimetypes
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bridge.camera_bridge import (  # noqa: E402
    ORIGINALS_BUCKET,
    PREVIEW_BUCKET,
    athens_night_key,
    prepare_previews,
    safe_filename,
)
from supabase import Client, create_client  # noqa: E402

LEGACY_PUBLIC_BUCKETS = {"photos", "previews"}
LEGACY_ORIGINAL_BUCKETS = {"originals", "photo-originals"}
WATERMARK_PATH = ROOT / "src" / "assets" / "watermark.png"


def parse_public_legacy_url(url: str | None) -> tuple[str, str] | None:
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    marker = "/storage/v1/object/public/"
    if marker not in parsed.path:
        return None
    bucket_and_path = unquote(parsed.path.split(marker, 1)[1])
    bucket, separator, path = bucket_and_path.partition("/")
    if (
        not separator
        or bucket not in LEGACY_PUBLIC_BUCKETS
        or not path
        or any(part in {"", ".", ".."} for part in path.split("/"))
    ):
        return None
    return bucket, path


def response_data(response: object) -> object:
    return getattr(response, "data", None)


def get_original_info(client: Client, photo_id: str) -> dict[str, str] | None:
    response = client.rpc(
        "get_photo_original_info",
        {"photo_id_input": photo_id},
    ).execute()
    data = response_data(response)
    if isinstance(data, list):
        data = data[0] if data else None
    if not isinstance(data, dict):
        return None
    path = data.get("object_path")
    bucket = data.get("storage_bucket")
    if isinstance(path, str) and path and isinstance(bucket, str) and bucket:
        return {"object_path": path, "storage_bucket": bucket}
    return None


def download_object(client: Client, bucket: str, path: str) -> bytes:
    result = client.storage.from_(bucket).download(path)
    if not isinstance(result, (bytes, bytearray)):
        raise RuntimeError(f"Storage returned invalid data for {bucket}/{path}.")
    return bytes(result)


def legacy_source_paths(photo: dict[str, object]) -> list[tuple[str, str]]:
    paths = []
    seen = set()
    for column in ("preview_url", "thumbnail_url"):
        parsed = parse_public_legacy_url(photo.get(column) if isinstance(photo.get(column), str) else None)
        if parsed and parsed not in seen:
            paths.append(parsed)
            seen.add(parsed)
    return paths


def private_original_path(photo: dict[str, object]) -> str:
    photo_id = str(photo["id"])
    timestamp = int(photo["timestamp"])
    filename = str(photo.get("filename") or "photo")
    suffix = Path(filename).suffix.lower() or ".jpg"
    stem = safe_filename(filename)
    return f"{athens_night_key(timestamp)}/{photo_id}-{stem}{suffix}"


def resolve_original(
    client: Client,
    photo: dict[str, object],
    apply: bool,
) -> tuple[bytes, str, list[tuple[str, str]], bool]:
    photo_id = str(photo["id"])
    old_objects = legacy_source_paths(photo)
    original = get_original_info(client, photo_id)
    original_bytes = None

    if original:
        try:
            original_bytes = download_object(
                client,
                original["storage_bucket"],
                original["object_path"],
            )
        except Exception:
            if not old_objects:
                raise

    if original_bytes is None:
        if not old_objects:
            raise FileNotFoundError("No accessible original or legacy public source was found.")
        source_bucket, source_path = old_objects[0]
        original_bytes = download_object(client, source_bucket, source_path)
        destination_path = private_original_path(photo)
        if apply:
            mime_type = mimetypes.guess_type(source_path)[0] or "application/octet-stream"
            client.storage.from_(ORIGINALS_BUCKET).upload(
                destination_path,
                original_bytes,
                file_options={
                    "content-type": mime_type,
                    "cache-control": "31536000",
                    "upsert": "true",
                },
            )
            verified_bytes = download_object(client, ORIGINALS_BUCKET, destination_path)
            if not verified_bytes:
                raise RuntimeError("Uploaded private original could not be verified.")
            client.rpc(
                "attach_photo_original",
                {
                    "photo_id_input": photo_id,
                    "original_path_input": destination_path,
                    "original_bucket_input": ORIGINALS_BUCKET,
                },
            ).execute()
        return original_bytes, destination_path, old_objects, True

    if original["storage_bucket"] == ORIGINALS_BUCKET:
        private_path = original["object_path"]
    elif original["storage_bucket"] in LEGACY_ORIGINAL_BUCKETS:
        private_path = private_original_path(photo)
        if apply:
            client.storage.from_(ORIGINALS_BUCKET).upload(
                private_path,
                original_bytes,
                file_options={
                    "content-type": mimetypes.guess_type(str(photo.get("filename") or ""))[0]
                    or "application/octet-stream",
                    "upsert": "true",
                },
            )
            verified_bytes = download_object(client, ORIGINALS_BUCKET, private_path)
            if not verified_bytes:
                raise RuntimeError("Migrated private original could not be verified.")
            client.rpc(
                "attach_photo_original",
                {
                    "photo_id_input": photo_id,
                    "original_path_input": private_path,
                    "original_bucket_input": ORIGINALS_BUCKET,
                },
            ).execute()
        return original_bytes, private_path, old_objects, True

    if original["storage_bucket"] != ORIGINALS_BUCKET:
        if not old_objects:
            raise RuntimeError(
                f"Original metadata points to unsupported bucket {original['storage_bucket']}."
            )
        source_bucket, source_path = old_objects[0]
        original_bytes = download_object(client, source_bucket, source_path)
        private_path = private_original_path(photo)
        if apply:
            client.storage.from_(ORIGINALS_BUCKET).upload(
                private_path,
                original_bytes,
                file_options={
                    "content-type": mimetypes.guess_type(source_path)[0]
                    or "application/octet-stream",
                    "upsert": "true",
                },
            )
            download_object(client, ORIGINALS_BUCKET, private_path)
            client.rpc(
                "attach_photo_original",
                {
                    "photo_id_input": photo_id,
                    "original_path_input": private_path,
                    "original_bucket_input": ORIGINALS_BUCKET,
                },
            ).execute()
        return original_bytes, private_path, old_objects, True

    return original_bytes, private_path, old_objects, False


def upload_preview(client: Client, path: str, local_path: Path) -> None:
    with local_path.open("rb") as source:
        client.storage.from_(PREVIEW_BUCKET).upload(
            path,
            source.read(),
            file_options={
                "content-type": "image/webp",
                "cache-control": "31536000",
                "upsert": "true",
            },
        )


def rebuild_photo(client: Client, photo: dict[str, object], apply: bool) -> bool:
    original_bytes, original_path, old_objects, migrated = resolve_original(client, photo, apply)
    photo_id = str(photo["id"])
    filename = str(photo.get("filename") or "photo")
    timestamp = int(photo["timestamp"])
    night = athens_night_key(timestamp)
    base_name = f"{photo_id}-{safe_filename(filename)}"

    with tempfile.TemporaryDirectory(prefix="vaglan-rebuild-") as directory:
        temp_dir = Path(directory)
        source_path = temp_dir / (Path(filename).name or "photo.jpg")
        preview_path = temp_dir / "preview.webp"
        thumbnail_path = temp_dir / "thumbnail.webp"
        source_path.write_bytes(original_bytes)
        prepare_previews(source_path, WATERMARK_PATH, preview_path, thumbnail_path)

        if not apply:
            return False

        if migrated:
            verified = download_object(client, ORIGINALS_BUCKET, original_path)
            if not verified:
                raise RuntimeError("Private original is missing or empty; legacy objects were not deleted.")

        preview_object = f"{night}/{base_name}.webp"
        thumbnail_object = f"{night}/thumbs/{base_name}.webp"
        upload_preview(client, preview_object, preview_path)
        upload_preview(client, thumbnail_object, thumbnail_path)
        preview_url = client.storage.from_(PREVIEW_BUCKET).get_public_url(preview_object)
        thumbnail_url = client.storage.from_(PREVIEW_BUCKET).get_public_url(thumbnail_object)

        update = (
            client.table("photos")
            .update(
                {
                    "preview_url": preview_url,
                    "thumbnail_url": thumbnail_url,
                    "watermark_baked": True,
                }
            )
            .select("id")
            .eq("id", photo_id)
            .eq("watermark_baked", False)
            .execute()
        )
        if not response_data(update):
            raise RuntimeError("Photo row was not updated; legacy objects were not deleted.")

        for bucket, object_path in old_objects:
            if bucket not in LEGACY_PUBLIC_BUCKETS:
                raise RuntimeError("Refusing to delete an object outside legacy public buckets.")
            result = client.storage.from_(bucket).remove([object_path])
            error = getattr(result, "error", None)
            if error:
                raise RuntimeError(f"Could not remove legacy public object {bucket}/{object_path}: {error}")
    return True


def count_bucket_objects(client: Client, bucket: str) -> int:
    pending = [""]
    count = 0
    while pending:
        folder = pending.pop()
        offset = 0
        while True:
            entries = client.storage.from_(bucket).list(
                path=folder,
                options={"limit": 1000, "offset": offset},
            )
            if not isinstance(entries, list):
                raise RuntimeError(f"Storage returned invalid listing for bucket {bucket}.")
            for entry in entries:
                name = entry.get("name") if isinstance(entry, dict) else None
                if not isinstance(name, str) or not name:
                    continue
                is_folder = (
                    isinstance(entry, dict)
                    and entry.get("id") is None
                    and entry.get("metadata") is None
                )
                if is_folder:
                    pending.append(f"{folder}/{name}".strip("/"))
                else:
                    count += 1
            if len(entries) < 1000:
                break
            offset += len(entries)
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Upload rebuilt images and remove old public objects.")
    parser.add_argument("--limit", type=int, help="Process at most N photos.")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be a positive integer.")

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        parser.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.")
    if not WATERMARK_PATH.is_file():
        parser.error(f"Watermark asset is missing: {WATERMARK_PATH}")

    client = create_client(supabase_url, service_key)
    query = (
        client.table("photos")
        .select("id, preview_url, thumbnail_url, filename, timestamp, watermark_baked")
        .eq("watermark_baked", False)
        .order("timestamp")
    )
    if args.limit:
        query = query.limit(args.limit)
    rows = response_data(query.execute()) or []

    rebuilt = 0
    rebuildable = 0
    failures: list[tuple[str, str]] = []
    no_original: list[str] = []
    for photo in rows:
        photo_id = str(photo.get("id", "<unknown>"))
        try:
            changed = rebuild_photo(client, photo, args.apply)
            rebuilt += int(changed)
            if not args.apply:
                rebuildable += 1
                print(f"DRY RUN: photo {photo_id} is rebuildable.")
        except FileNotFoundError as error:
            no_original.append(photo_id)
            failures.append((photo_id, str(error)))
        except Exception as error:
            message = str(error).replace(service_key, "[REDACTED]")
            failures.append((photo_id, message))

    object_counts: dict[str, int | str] = {}
    for bucket in sorted(LEGACY_PUBLIC_BUCKETS):
        try:
            object_counts[bucket] = count_bucket_objects(client, bucket)
        except Exception as error:
            failures.append((f"bucket:{bucket}", str(error).replace(service_key, "[REDACTED]")))
            object_counts[bucket] = "unavailable"

    print(f"Mode: {'apply' if args.apply else 'dry-run'}")
    print(f"Rebuilt count: {rebuilt}")
    if not args.apply:
        print(f"Rebuildable in dry-run: {rebuildable}")
    print(f"Failures: {len(failures)}")
    print(f"Photos with no recoverable original: {len(no_original)}")
    for photo_id in no_original:
        print(f"  no original: {photo_id}")
    for photo_id, message in failures:
        print(f"  failure {photo_id}: {message}")
    print("Objects remaining in legacy buckets:")
    for bucket, count in object_counts.items():
        print(f"  {bucket}: {count}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
