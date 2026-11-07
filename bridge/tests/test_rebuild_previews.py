import unittest

from tools.rebuild_previews import parse_public_legacy_url


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


if __name__ == "__main__":
    unittest.main()
