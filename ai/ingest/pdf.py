"""A-05 digital PDF reading and A-08 strike-through detection.

Text comes from the text layer as positioned words, grouped by geometry (top-to-bottom, left-to-right),
not by content-stream order, because corrections in the organiser forms are drawn late. A drawn
horizontal line through a word's vertical middle marks it struck. Ink colour is kept so the structure
stage can tell grey history from blue corrections. Coordinates are PDF points with a top-left origin.
"""
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

DIGITAL_MIN_CHARS = 20          # A page with fewer text-layer characters is treated as scanned.
LINE_TOLERANCE = 3.0            # Words whose tops differ by less than this share a line.
STRIKE_MAX_THICKNESS = 2.5


@dataclass
class Span:
    page: int
    text: str
    bbox: tuple[float, float, float, float]   # x0, top, x1, bottom
    font: str
    size: float
    ink: str                                   # black | grey | blue | colour
    struck: bool = False
    cell: tuple[int, int, int] | None = None   # (table, row, column) when the word sits in a ruled table cell
    ocr_confidence: float | None = None         # set when A-06 replaced a corrupt text layer with OCR


@dataclass
class Page:
    number: int
    width: float
    height: float
    text_chars: int
    digital: bool
    spans: list[Span] = field(default_factory=list)


def _ink(colour) -> str:
    if colour is None:
        return "black"
    values = list(colour) if isinstance(colour, (list, tuple)) else [colour]
    if len(values) == 1:
        grey = float(values[0])
        return "black" if grey < 0.25 else "grey" if grey < 0.9 else "colour"
    if len(values) == 3:
        r, g, b = (float(v) for v in values)
        if max(r, g, b) - min(r, g, b) < 0.08:
            return "black" if r < 0.25 else "grey"
        return "blue" if b > r + 0.15 and b > g + 0.05 else "colour"
    if len(values) == 4:  # CMYK
        c, m, y, k = (float(v) for v in values)
        if c < 0.05 and m < 0.05 and y < 0.05:
            return "black" if k > 0.75 else "grey"
        return "blue" if c > 0.4 and y < 0.3 else "colour"
    return "colour"


def _strike_segments(page) -> list[tuple[float, float, float]]:
    """Horizontal drawn strokes as (x0, x1, y) from lines and thin rectangles."""
    strokes = []
    for line in page.lines:
        if abs(line["top"] - line["bottom"]) <= STRIKE_MAX_THICKNESS:
            strokes.append((min(line["x0"], line["x1"]), max(line["x0"], line["x1"]), (line["top"] + line["bottom"]) / 2))
    for rect in page.rects:
        if rect["height"] <= STRIKE_MAX_THICKNESS and rect["width"] > 2:
            strokes.append((rect["x0"], rect["x1"], (rect["top"] + rect["bottom"]) / 2))
    return strokes


def _is_struck(bbox, strokes) -> bool:
    x0, top, x1, bottom = bbox
    height = bottom - top
    for sx0, sx1, y in strokes:
        # Through the middle band of the glyphs (not an underline or a table rule)…
        if not top + 0.3 * height <= y <= bottom - 0.25 * height:
            continue
        # …and covering most of the word.
        overlap = min(x1, sx1) - max(x0, sx0)
        if overlap >= 0.6 * (x1 - x0):
            return True
    return False


def read_pdf(path: Path) -> list[Page]:
    pages: list[Page] = []
    with pdfplumber.open(str(path)) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            chars = [char for char in page.chars if char.get("text", "").strip()]
            info = Page(number=number, width=float(page.width), height=float(page.height), text_chars=len(chars),
                        digital=len(chars) >= DIGITAL_MIN_CHARS)
            if not info.digital:
                pages.append(info)
                continue
            strokes = _strike_segments(page)
            # Ruled tables (the organiser forms are question | response grids): words belong to the cell
            # whose box holds their centre, so a question and its answer are never stitched together.
            cells = [(t_index, r_index, c_index, cell)
                     for t_index, table in enumerate(page.find_tables())
                     for r_index, row in enumerate(table.rows)
                     for c_index, cell in enumerate(row.cells) if cell is not None]
            words = page.extract_words(keep_blank_chars=False, use_text_flow=False,
                                       extra_attrs=["fontname", "size", "non_stroking_color"])
            words.sort(key=lambda word: (round(word["top"] / LINE_TOLERANCE), word["x0"]))
            # Merge neighbouring words on one line with the same ink and strike state into spans.
            for word in words:
                bbox = (float(word["x0"]), float(word["top"]), float(word["x1"]), float(word["bottom"]))
                centre = ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
                cell = next(((t_i, r_i, c_i) for t_i, r_i, c_i, box in cells
                             if box[0] <= centre[0] <= box[2] and box[1] <= centre[1] <= box[3]), None)
                span = Span(page=number, text=word["text"], bbox=bbox, font=str(word.get("fontname", "")),
                            size=float(word.get("size", 0)), ink=_ink(word.get("non_stroking_color")),
                            struck=_is_struck(bbox, strokes), cell=cell)
                last = info.spans[-1] if info.spans else None
                same_line = last is not None and abs(last.bbox[1] - span.bbox[1]) < LINE_TOLERANCE
                gap = span.bbox[0] - last.bbox[2] if last else 0
                if (last and same_line and last.ink == span.ink and last.struck == span.struck and last.cell == span.cell
                        and 0 <= gap < 2.5 * max(span.size, 1)):
                    last.text = f"{last.text} {span.text}"
                    last.bbox = (last.bbox[0], min(last.bbox[1], span.bbox[1]), span.bbox[2], max(last.bbox[3], span.bbox[3]))
                else:
                    info.spans.append(span)
            pages.append(info)
    return pages


def lines_of(page: Page) -> list[list[Span]]:
    """Spans grouped into visual lines, top to bottom."""
    lines: list[list[Span]] = []
    for span in page.spans:
        if lines and abs(lines[-1][0].bbox[1] - span.bbox[1]) < LINE_TOLERANCE:
            lines[-1].append(span)
        else:
            lines.append([span])
    return lines
