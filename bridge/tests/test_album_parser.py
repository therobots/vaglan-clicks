import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bridge.camera_bridge import parse_album_url, validate_album_id


class AlbumParserTests(unittest.TestCase):
    def test_valid_album_urls_are_accepted(self):
        self.assertEqual(parse_album_url('https://gallery.example.com/?album=042', 'https://gallery.example.com/'), '042')
        self.assertEqual(parse_album_url('https://gallery.example.com/?album=043', 'https://gallery.example.com/'), '043')

    def test_invalid_or_untrusted_urls_fail(self):
        self.assertIsNone(parse_album_url('https://gallery.example.com/?album=bad id', 'https://gallery.example.com/'))
        self.assertIsNone(parse_album_url('https://evil.example/?album=042', 'https://gallery.example.com/'))
        self.assertIsNone(parse_album_url('https://gallery.example.com/?album=042&album=043', 'https://gallery.example.com/'))
        self.assertIsNone(parse_album_url('https://gallery.example.com/?', 'https://gallery.example.com/'))

    def test_album_ids_keep_leading_zeroes_and_validate_format(self):
        self.assertEqual(validate_album_id('042'), '042')
        self.assertEqual(validate_album_id('A_9-2'), 'A_9-2')
        with self.assertRaises(ValueError):
            validate_album_id('42?')


if __name__ == '__main__':
    unittest.main()
