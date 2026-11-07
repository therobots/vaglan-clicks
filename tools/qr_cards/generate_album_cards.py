#!/usr/bin/env python3
"""Generate printable album QR cards for a VAGLAN gallery."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import qrcode

A4_WIDTH_PX = 2480
A4_HEIGHT_PX = 3508
CARD_MARGIN = 120
CARD_GAP = 70
CARD_WIDTH = (A4_WIDTH_PX - (CARD_MARGIN * 2) - CARD_GAP) // 2
CARD_HEIGHT = (A4_HEIGHT_PX - (CARD_MARGIN * 2) - (CARD_GAP * 2)) // 3


def build_album_url(base_url: str, album_id: str) -> str:
    url = str(base_url).rstrip("/")
    sep = "?" if "?" not in url else "&"
    return f"{url}{sep}album={album_id}"


def create_card(album_id: str, base_url: str, title: str = "Vaglan Album") -> Image.Image:
    card = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), "white")
    draw = ImageDraw.Draw(card)

    qr_code = qrcode.QRCode(version=3, box_size=12, border=4, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr_code.add_data(build_album_url(base_url, album_id))
    qr_code.make(fit=True)
    qr_image = qr_code.make_image(fill_color="black", back_color="white").resize((300, 300))
    card.paste(qr_image, (60, 90))

    font_large = ImageFont.load_default()
    font_small = ImageFont.load_default()

    draw.text((430, 110), title, fill="black", font=font_large)
    draw.text((430, 180), f"Album: {album_id}", fill="black", font=font_small)
    draw.text((430, 240), build_album_url(base_url, album_id), fill="black", font=font_small)

    return card


def render_page(album_ids: list[str], base_url: str, title: str = "Vaglan Album") -> Image.Image:
    page = Image.new("RGB", (A4_WIDTH_PX, A4_HEIGHT_PX), "white")
    for index, album_id in enumerate(album_ids):
        row = index // 2
        column = index % 2
        x = CARD_MARGIN + column * (CARD_WIDTH + CARD_GAP)
        y = CARD_MARGIN + row * (CARD_HEIGHT + CARD_GAP)
        card = create_card(album_id, base_url, title)
        page.paste(card, (x, y))
    return page


def parse_album_ids(raw: str) -> list[str]:
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if not values:
        raise ValueError("Provide at least one album ID.")
    return values


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate A4 QR cards for album sessions.")
    parser.add_argument("--base-url", required=True, help="Public gallery base URL, e.g. https://gallery.example.com/")
    parser.add_argument("--album-ids", required=True, help="Comma-separated album IDs, e.g. general,042,043")
    parser.add_argument("--output", default="album-cards.pdf", help="Output path for the generated PDF")
    parser.add_argument("--title", default="Vaglan Album", help="Title printed on each card")
    args = parser.parse_args()

    album_ids = parse_album_ids(args.album_ids)
    page = render_page(album_ids, args.base_url, args.title)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    page.save(output, "PDF", resolution=300.0)
    print(f"Saved {len(album_ids)} cards to {output}")


if __name__ == "__main__":
    main()
