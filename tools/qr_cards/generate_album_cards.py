#!/usr/bin/env python3
"""Generate printable album QR cards for a VAGLAN gallery."""

from __future__ import annotations

import argparse
import re
import secrets
import string
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import qrcode

A4_WIDTH_PX = 2480
A4_HEIGHT_PX = 3508
CARD_MARGIN = 120
CARD_GAP = 70
CARD_WIDTH = (A4_WIDTH_PX - (CARD_MARGIN * 2) - CARD_GAP) // 2
CARD_HEIGHT = (A4_HEIGHT_PX - (CARD_MARGIN * 2) - (CARD_GAP * 2)) // 3
ALBUM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ALBUM_ID_ALPHABET = string.ascii_letters + string.digits


def build_album_url(base_url: str, album_id: str) -> str:
    if not ALBUM_ID_PATTERN.fullmatch(album_id):
        raise ValueError("Album IDs must use 1-64 letters, numbers, hyphens, or underscores.")
    url = str(base_url).rstrip("/")
    sep = "?" if "?" not in url else "&"
    return f"{url}{sep}album={album_id}"


def generate_album_id(length: int | None = None) -> str:
    selected_length = secrets.randbelow(5) + 8 if length is None else length
    if not 8 <= selected_length <= 12:
        raise ValueError("Generated album IDs must be 8-12 characters long.")
    return "".join(secrets.choice(ALBUM_ID_ALPHABET) for _ in range(selected_length))


def generate_album_ids(count: int) -> list[str]:
    if count < 1:
        raise ValueError("Generate at least one album ID.")
    album_ids: set[str] = set()
    while len(album_ids) < count:
        album_ids.add(generate_album_id())
    return list(album_ids)


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


def render_pages(album_ids: list[str], base_url: str, title: str = "Vaglan Album") -> list[Image.Image]:
    return [
        render_page(album_ids[offset : offset + 6], base_url, title)
        for offset in range(0, len(album_ids), 6)
    ]


def parse_album_ids(raw: str) -> list[str]:
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if not values:
        raise ValueError("Provide at least one album ID.")
    invalid = [value for value in values if not ALBUM_ID_PATTERN.fullmatch(value)]
    if invalid:
        raise ValueError(
            "Album IDs must use 1-64 letters, numbers, hyphens, or underscores."
        )
    return values


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate A4 QR cards for album sessions.")
    parser.add_argument("--base-url", required=True, help="Public gallery base URL, e.g. https://gallery.example.com/")
    parser.add_argument("--album-ids", help="Existing comma-separated album IDs, e.g. general,042,043")
    parser.add_argument("--count", type=int, help="Generate this many random album IDs (default: 1)")
    parser.add_argument("--output", default="album-cards.pdf", help="Output path for the generated PDF")
    parser.add_argument("--title", default="Vaglan Album", help="Title printed on each card")
    args = parser.parse_args()

    if args.album_ids and args.count is not None:
        parser.error("Choose either --album-ids or --count, not both.")
    try:
        album_ids = (
            parse_album_ids(args.album_ids)
            if args.album_ids
            else generate_album_ids(1 if args.count is None else args.count)
        )
    except ValueError as error:
        parser.error(str(error))
    pages = render_pages(album_ids, args.base_url, args.title)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(
        output,
        "PDF",
        resolution=300.0,
        save_all=True,
        append_images=pages[1:],
    )
    print(f"Saved {len(album_ids)} cards to {output}")
    if not args.album_ids:
        print(f"Generated album IDs: {', '.join(album_ids)}")


if __name__ == "__main__":
    main()
