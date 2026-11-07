import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools import rebuild_previews
from tools.rebuild_previews import parse_public_legacy_url


class FakePhotoQuery:
    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return SimpleNamespace(
            data={
                "watermark_baked": True,
                "preview_url": "https://example.supabase.co/storage/v1/object/public/public-previews/new.webp",
            }
        )


class FakeStorageBucket:
    def __init__(self, bucket, removed):
        self.bucket = bucket
        self.removed = removed

    def download(self, _path):
        if self.bucket != "private-originals":
            raise AssertionError("Cleanup must verify the private original first.")
        return b"verified original"

    def remove(self, paths):
        self.removed.append((self.bucket, paths))
        return SimpleNamespace(error=None)


class FakeClient:
    def __init__(self):
        self.removed = []

    def table(self, _table):
        return FakePhotoQuery()

    class Storage:
        def __init__(self, removed):
            self.removed = removed

        def from_(self, bucket):
            return FakeStorageBucket(bucket, self.removed)

    @property
    def storage(self):
        return self.Storage(self.removed)


class TestLegacyPreviewUrls(unittest.TestCase):
    def test_parses_legacy_public_storage_urls(self):
        self.assertEqual(
            parse_public_legacy_url(
                "https://example.supabase.co/storage/v1/object/public/photos/night/photo%201.jpg"
            ),
            ("photos", "night/photo 1.jpg"),
        )

    def test_rejects_non_legacy_or_unsafe_paths(self):
        self.assertIsNone(
            parse_public_legacy_url(
                "https://example.supabase.co/storage/v1/object/public/private-originals/night/photo.jpg"
            )
        )
        self.assertIsNone(
            parse_public_legacy_url(
                "https://example.supabase.co/storage/v1/object/public/previews/../photo.jpg"
            )
        )
        self.assertIsNone(parse_public_legacy_url("not a URL"))

    def test_pending_cleanup_is_retried_only_after_private_original_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            journal_path = Path(directory) / "pending.json"
            client = FakeClient()
            with patch.object(rebuild_previews, "PENDING_CLEANUP_PATH", journal_path):
                rebuild_previews.remember_pending_cleanup(
                    "photo-id",
                    "night/photo.jpg",
                    [("photos", "night/old.jpg")],
                )

                completed, failures = rebuild_previews.retry_pending_cleanup(client)

                self.assertEqual(completed, 1)
                self.assertEqual(failures, [])
                self.assertEqual(client.removed, [("photos", ["night/old.jpg"])])
                self.assertEqual(rebuild_previews.read_pending_cleanup(), [])


if __name__ == "__main__":
    unittest.main()
