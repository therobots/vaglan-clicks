import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[2] / "tools" / "qr_cards"),
)

from generate_album_cards import (  # noqa: E402
    build_album_url,
    generate_album_id,
    generate_album_ids,
    parse_album_ids,
    render_pages,
)


class AlbumCardIdTests(unittest.TestCase):
    def test_generated_ids_are_8_to_12_url_safe_characters(self):
        for _ in range(100):
            album_id = generate_album_id()
            self.assertGreaterEqual(len(album_id), 8)
            self.assertLessEqual(len(album_id), 12)
            self.assertRegex(album_id, r"^[A-Za-z0-9_-]+$")

    def test_generation_returns_unique_requested_count(self):
        album_ids = generate_album_ids(20)
        self.assertEqual(len(album_ids), 20)
        self.assertEqual(len(set(album_ids)), 20)

    def test_existing_album_ids_and_leading_zeroes_are_preserved(self):
        self.assertEqual(parse_album_ids("general,042,session_3"), ["general", "042", "session_3"])
        self.assertEqual(
            build_album_url("https://gallery.example/", "042"),
            "https://gallery.example?album=042",
        )

    def test_invalid_ids_and_counts_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_album_ids("not/a-valid-id")
        with self.assertRaises(ValueError):
            generate_album_ids(0)
        with self.assertRaises(ValueError):
            generate_album_id(13)

    def test_multiple_sheets_render_when_more_than_six_ids_are_requested(self):
        album_ids = [f"album{index}" for index in range(7)]
        with patch("generate_album_cards.render_page", side_effect=lambda ids, *_: ids):
            pages = render_pages(album_ids, "https://gallery.example")
        self.assertEqual(pages, [album_ids[:6], album_ids[6:]])


if __name__ == "__main__":
    unittest.main()
