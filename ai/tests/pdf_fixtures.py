"""Builds tiny synthetic PDFs in memory for tests: positioned text, ink colours and drawn lines."""


def build_pdf(pages: list[list[tuple]]) -> bytes:
    """Each page is a list of operations:
    ("text", x, y, size, "string", (r, g, b))   y is from the bottom, PDF style
    ("line", x0, y0, x1, y1, width)
    """
    objects: list[bytes] = []
    page_ids = []
    font_id = 3
    contents = []
    for ops in pages:
        stream = []
        for op in ops:
            if op[0] == "text":
                _, x, y, size, text, colour = op
                escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
                stream.append(f"{colour[0]} {colour[1]} {colour[2]} rg BT /F1 {size} Tf {x} {y} Td ({escaped}) Tj ET")
            elif op[0] == "line":
                _, x0, y0, x1, y1, width = op
                stream.append(f"0 0 0 RG {width} w {x0} {y0} m {x1} {y1} l S")
        contents.append("\n".join(stream).encode("latin-1"))
    # 1 catalog, 2 pages, 3 font, then per page: page object and content stream.
    next_id = 4
    for content in contents:
        page_ids.append(next_id)
        next_id += 2
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for pid, content in zip(page_ids, contents):
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {pid + 1} 0 R >>".encode())
        objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


BLACK, GREY, BLUE = (0, 0, 0), (0.55, 0.55, 0.55), (0.1, 0.2, 0.85)


def idea_brief_pdf() -> bytes:
    """A synthetic two-page idea brief: numbered questions, a struck grey value with a blue correction,
    a blank marker, a missing question (raw materials) and a phone number to redact."""
    page1 = [
        ("text", 72, 800, 16, "Business Idea Brief", BLACK),
        ("text", 72, 785, 11, "Name: Synthetic Kamala Devi", BLACK),
        ("text", 72, 770, 11, "Mobile: 9876543210", BLACK),
        ("text", 72, 755, 11, "Address: House 12, Synthetic Lane, Sinnar", BLACK),
        ("text", 72, 740, 11, "1. Where do you intend to set up your business?", BLACK),
        ("text", 90, 722, 11, "Sinnar, Nashik, Maharashtra 422103", BLACK),
        ("text", 72, 700, 11, "2. What products or services will you provide? List all.", BLACK),
        ("text", 90, 682, 11, "Mobile phone repair and spare parts", BLACK),
        ("text", 72, 660, 11, "3. Who are your target customers?", BLACK),
        ("text", 90, 642, 11, "Farmers and students in 12 villages", BLACK),
        ("text", 72, 620, 11, "4. Who will be your suppliers?", BLACK),
        ("text", 90, 602, 11, "[Left Blank]", BLACK),
        ("text", 72, 580, 11, "5. How much do you expect to earn every month?", BLACK),
        ("text", 90, 562, 11, "Rs 20,000", GREY),
        ("line", 88, 565.5, 140, 565.5, 1),
        ("text", 160, 562, 11, "Rs 12,000 per month", BLUE),
    ]
    page2 = [
        ("text", 72, 800, 11, "6. Is there any competition for your business? Details.", BLACK),
        ("text", 90, 782, 11, "One shop in town, none in the villages", BLACK),
        ("text", 72, 760, 11, "7. What is your favourite cricket team?", BLACK),
        ("text", 90, 742, 11, "Mumbai", BLACK),
        ("line", 72, 700, 520, 700, 0.5),
    ]
    return build_pdf([page1, page2])
