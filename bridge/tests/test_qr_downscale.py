import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from bridge.camera_bridge import detect_album_qr


class QRDownscaleTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_large_photo_is_downscaled_before_decoding(self):
        path = self.directory / "large-photo.jpg"
        Image.new("RGB", (4000, 3000), (255, 255, 255)).save(path)
        decoded_sizes = []

        def decode(image):
            decoded_sizes.append(image.size)
            return []

        pyzbar_package = types.ModuleType("pyzbar")
        pyzbar_module = types.ModuleType("pyzbar.pyzbar")
        pyzbar_module.decode = decode
        pyzbar_package.pyzbar = pyzbar_module
        with patch.dict(
            sys.modules,
            {"pyzbar": pyzbar_package, "pyzbar.pyzbar": pyzbar_module},
        ), patch.dict("os.environ", {"CAMERA_QR_CARD_MODE": ""}):
            result = detect_album_qr(path, "https://gallery.example.com/")

        self.assertIsNone(result)
        self.assertEqual(len(decoded_sizes), 1)
        self.assertLessEqual(max(decoded_sizes[0]), 1600)

    def test_card_frame_uses_full_resolution_fallback(self):
        path = self.directory / "event-qr-card.jpg"
        Image.new("RGB", (4000, 3000), (255, 255, 255)).save(path)
        decoded_sizes = []
        qr = types.SimpleNamespace(data=b"https://gallery.example.com/?album=042")

        def decode(image):
            decoded_sizes.append(image.size)
            return [qr] if len(decoded_sizes) == 2 else []

        pyzbar_package = types.ModuleType("pyzbar")
        pyzbar_module = types.ModuleType("pyzbar.pyzbar")
        pyzbar_module.decode = decode
        pyzbar_package.pyzbar = pyzbar_module
        with patch.dict(
            sys.modules,
            {"pyzbar": pyzbar_package, "pyzbar.pyzbar": pyzbar_module},
        ), patch.dict("os.environ", {"CAMERA_QR_CARD_MODE": ""}):
            result = detect_album_qr(path, "https://gallery.example.com/")

        self.assertEqual(result, "042")
        self.assertLessEqual(max(decoded_sizes[0]), 1600)
        self.assertEqual(decoded_sizes[1], (4000, 3000))


if __name__ == "__main__":
    unittest.main()
