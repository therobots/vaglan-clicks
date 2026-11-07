import tempfile
import unittest
from pathlib import Path
from PIL import Image
from bridge.camera_bridge import prepare_previews


class TestPreparePreviews(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_path = Path(self.temp_dir.name)
        # Create a dummy watermark
        self.watermark_path = self.dir_path / "watermark.png"
        watermark = Image.new("RGBA", (200, 100), (255, 0, 0, 128))
        watermark.save(self.watermark_path, format="PNG")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_landscape_preview_dimensions(self):
        source = self.dir_path / "landscape.jpg"
        Image.new("RGB", (2560, 1440), (100, 150, 200)).save(source, format="JPEG")
        preview = self.dir_path / "preview.webp"
        thumb = self.dir_path / "thumb.webp"

        prepare_previews(source, self.watermark_path, preview, thumb)

        with Image.open(preview) as p:
            self.assertEqual(p.format, "WEBP")
            self.assertEqual(p.width, 1280)
            self.assertEqual(p.height, 720)
            self.assertLessEqual(max(p.width, p.height), 1280)

        with Image.open(thumb) as t:
            self.assertEqual(t.format, "WEBP")
            self.assertEqual(t.width, 300)
            self.assertLessEqual(max(t.width, t.height), 300)

    def test_portrait_preview_dimensions(self):
        source = self.dir_path / "portrait.jpg"
        Image.new("RGB", (1800, 3600), (200, 150, 100)).save(source, format="JPEG")
        preview = self.dir_path / "preview_portrait.webp"
        thumb = self.dir_path / "thumb_portrait.webp"

        prepare_previews(source, self.watermark_path, preview, thumb)

        with Image.open(preview) as p:
            self.assertEqual(p.format, "WEBP")
            self.assertEqual(p.height, 1280)
            self.assertEqual(p.width, 640)
            self.assertLessEqual(max(p.width, p.height), 1280)

        with Image.open(thumb) as t:
            self.assertEqual(t.format, "WEBP")
            self.assertEqual(t.height, 300)
            self.assertEqual(t.width, 150)
            self.assertLessEqual(max(t.width, t.height), 300)


if __name__ == "__main__":
    unittest.main()
