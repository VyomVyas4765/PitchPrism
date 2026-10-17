"""A-07 scans, photos and handwriting: render, measure blur, OCR with per-line confidence.

Engine: Tesseract 5 (Apache-2.0) with the tessdata_best models for the six launch languages, run
locally. Its handwriting accuracy is unproven on the organiser scans; lines below the confidence
threshold are returned as unreadable regions (with their box) for the assessor, never guessed.
A vision-model fallback needs an installed, evaluated local vision model and is not configured.
"""
from dataclasses import dataclass
import os
from pathlib import Path
import shutil

from PIL import Image, ImageFilter, ImageStat

from ai.providers import CapabilityUnavailable

RENDER_DPI = 300
MIN_LINE_CONFIDENCE = 60.0
BLUR_THRESHOLD = 60.0            # Laplacian variance below this suggests a blurred page (untuned).
TESS_LANG = {"hi": "hin", "mr": "mar", "te": "tel", "or": "ori", "bn": "ben", "en": "eng"}
DITTO = {'"', "''", "〃", "”", "“", "do", "do.", "-do-", "\u201d\u201d"}
_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class OcrLine:
    text: str
    confidence: float          # 0–100, mean word confidence
    bbox: tuple[float, float, float, float]   # x0, top, x1, bottom in PDF points (image pixels × 72 / dpi)
    unreadable: bool
    ditto_of: int | None = None


@dataclass
class OcrWord:
    text: str
    confidence: float
    bbox: tuple[float, float, float, float]   # PDF points


@dataclass
class OcrPage:
    number: int
    blur: float
    blurred: bool
    lines: list[OcrLine]
    words: list[OcrWord] | None = None


def _tesseract():
    import pytesseract
    binary = os.getenv("TESSERACT_CMD") or shutil.which("tesseract") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if not Path(binary).exists() and not shutil.which(binary):
        raise CapabilityUnavailable("Tesseract OCR is not installed on the worker; scanned pages stay pending.")
    pytesseract.pytesseract.tesseract_cmd = binary
    return pytesseract


def _tessdata() -> str:
    return os.getenv("TESSDATA_PREFIX") or str(_ROOT / "local" / "tessdata")


def available_languages() -> set[str]:
    folder = Path(_tessdata())
    return {lang for lang, code in TESS_LANG.items() if (folder / f"{code}.traineddata").exists()}


def blur_score(image: Image.Image) -> float:
    """Variance of a Laplacian: low values mean few sharp edges."""
    edges = image.convert("L").filter(ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1))
    return float(ImageStat.Stat(edges).var[0])


def render_pdf_page(path: Path, number: int, dpi: int = RENDER_DPI) -> Image.Image:
    import pypdfium2
    document = pypdfium2.PdfDocument(str(path))
    try:
        return document[number - 1].render(scale=dpi / 72).to_pil()
    finally:
        document.close()


def ocr_image(image: Image.Image, languages: list[str], number: int = 1, dpi: int = RENDER_DPI) -> OcrPage:
    tesseract = _tesseract()
    installed = available_languages()
    wanted = [lang for lang in languages if lang in installed]
    if not wanted:
        raise CapabilityUnavailable(f"No OCR language data installed for {languages}; the page stays pending.")
    # Pass the model folder through the environment: quoted paths reach Tesseract literally on Windows.
    os.environ["TESSDATA_PREFIX"] = _tessdata()
    config = "--psm 4"
    data = tesseract.image_to_data(image, lang="+".join(TESS_LANG[lang] for lang in wanted), config=config,
                                   output_type=tesseract.Output.DICT)
    scale = 72 / dpi
    grouped: dict[tuple[int, int, int], list[int]] = {}
    for index, word in enumerate(data["text"]):
        if word.strip() and float(data["conf"][index]) >= 0:
            grouped.setdefault((data["block_num"][index], data["par_num"][index], data["line_num"][index]), []).append(index)
    lines = []
    for indexes in grouped.values():
        text = " ".join(data["text"][i] for i in indexes)
        confidence = sum(float(data["conf"][i]) for i in indexes) / len(indexes)
        x0 = min(data["left"][i] for i in indexes)
        top = min(data["top"][i] for i in indexes)
        x1 = max(data["left"][i] + data["width"][i] for i in indexes)
        bottom = max(data["top"][i] + data["height"][i] for i in indexes)
        lines.append(OcrLine(text=text, confidence=round(confidence, 1), bbox=(x0 * scale, top * scale, x1 * scale, bottom * scale),
                             unreadable=confidence < MIN_LINE_CONFIDENCE))
    lines.sort(key=lambda line: (round(line.bbox[1]), line.bbox[0]))
    resolve_dittos(lines)
    words = [OcrWord(data["text"][i], float(data["conf"][i]),
                     (data["left"][i] * scale, data["top"][i] * scale, (data["left"][i] + data["width"][i]) * scale, (data["top"][i] + data["height"][i]) * scale))
             for indexes in grouped.values() for i in indexes]
    blur = blur_score(image)
    return OcrPage(number=number, blur=round(blur, 1), blurred=blur < BLUR_THRESHOLD, lines=lines, words=words)


def ocr_pdf_page(path: Path, number: int, languages: list[str]) -> OcrPage:
    return ocr_image(render_pdf_page(path, number), languages, number)


def resolve_dittos(lines: list[OcrLine]) -> None:
    """A ditto mark repeats the value above it in the same column (handwritten cash books)."""
    for index, line in enumerate(lines):
        if line.text.strip().lower() not in DITTO:
            continue
        for above in range(index - 1, -1, -1):
            candidate = lines[above]
            overlap = min(line.bbox[2], candidate.bbox[2]) - max(line.bbox[0], candidate.bbox[0])
            if overlap > 0 and candidate.text.strip().lower() not in DITTO:
                line.ditto_of = above
                line.text = candidate.text
                break
