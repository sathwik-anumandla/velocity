"""
Velocity PDF Export Service
Converts Markdown artifacts into structured, publication-quality A4 PDFs.
Strict constraint: Zero emojis in code, headers, or generated output.
"""

import re
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Tuple
import markdown
from fpdf import FPDF

logger = logging.getLogger("velocity.pdf_service")


def get_font_paths() -> Tuple[Optional[Path], Optional[Path], Optional[Path]]:
    """
    Finds DejaVu TrueType fonts with robust fallback paths across Docker and macOS.
    """
    candidates = [
        Path(__file__).resolve().parent / "fonts",
        Path("backend/fonts"),
        Path("/usr/share/fonts/truetype/dejavu"),
        Path("/usr/local/share/fonts"),
    ]
    sans: Optional[Path] = None
    bold: Optional[Path] = None
    mono: Optional[Path] = None

    for p in candidates:
        sans_candidate = p / "DejaVuSans.ttf"
        if sans_candidate.is_file():
            sans = sans_candidate
            bold_candidate = p / "DejaVuSans-Bold.ttf"
            if bold_candidate.is_file():
                bold = bold_candidate
            mono_candidate = p / "DejaVuSansMono.ttf"
            if mono_candidate.is_file():
                mono = mono_candidate
            break

    return sans, bold, mono


class VelocityPDF(FPDF):
    def __init__(self, doc_title: str = "Velocity Document"):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.doc_title = doc_title[:60]
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(left=18, top=18, right=18)

        sans_path, bold_path, mono_path = get_font_paths()
        if sans_path:
            self.add_font("DejaVu", "", str(sans_path))
            if bold_path:
                self.add_font("DejaVu", "B", str(bold_path))
            if mono_path:
                self.add_font("DejaVuMono", "", str(mono_path))
            self.font_family_name = "DejaVu"
            self.mono_family_name = "DejaVuMono" if mono_path else "Courier"
        else:
            self.font_family_name = "Helvetica"
            self.mono_family_name = "Courier"

    def header(self):
        # Header text
        self.set_font(self.font_family_name, "", 8)
        self.set_text_color(130, 130, 130)
        self.cell(100, 6, self.doc_title.upper(), border=0, align="L")
        self.cell(0, 6, "VELOCITY ARCHIVE", border=0, align="R")
        self.ln(7)
        # Subtle horizontal divider
        self.set_draw_color(220, 220, 220)
        self.set_line_width(0.2)
        self.line(18, self.get_y(), 192, self.get_y())
        self.ln(6)

    def footer(self):
        self.set_y(-14)
        self.set_font(self.font_family_name, "", 8)
        self.set_text_color(140, 140, 140)
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        self.cell(80, 8, f"Exported: {now_str}", border=0, align="L")
        self.cell(0, 8, f"Page {self.page_no()}/{{nb}}", border=0, align="R")


def sanitize_markdown_for_pdf(content: str) -> str:
    """
    Cleans up markdown content for smooth HTML/PDF rendering.
    Removes unsupported raw markdown HTML tags and normalizes code blocks.
    """
    # Replace triple backtick blocks with pre code
    clean = re.sub(r'```[a-zA-Z0-9_-]*\n', '<pre><code>\n', content)
    clean = clean.replace('```', '</code></pre>')

    # Normalize whitespace characters that can cause font mapping issues
    replacements = {
        "\u00a0": " ",
        "\u2009": " ",
        "\u200a": " ",
        "\u200b": "",
        "\ufeff": "",
    }
    for k, v in replacements.items():
        clean = clean.replace(k, v)

    return clean


def generate_artifact_pdf(
    title: str,
    content: str,
    artifact_type: str = "Document",
    version: int = 1,
    created_at: Optional[str] = None,
) -> bytes:
    """
    Generates a PDF byte stream from an artifact title, metadata, and markdown body.
    """
    pdf = VelocityPDF(doc_title=title)
    pdf.alias_nb_pages()
    pdf.add_page()

    # Document Header Title Block
    pdf.set_font(pdf.font_family_name, "B", 18)
    pdf.set_text_color(24, 24, 27)  # zinc-900
    pdf.multi_cell(0, 8, title)
    pdf.ln(2)

    # Metadata subtitle
    type_badge = artifact_type.replace("_", " ").upper()
    meta_info = f"TYPE: {type_badge}  |  VERSION: v{version}"
    if created_at:
        try:
            created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            meta_info += f"  |  CREATED: {created_dt.strftime('%b %d, %Y')}"
        except Exception:
            pass

    pdf.set_font(pdf.font_family_name, "", 8)
    pdf.set_text_color(113, 113, 122)  # zinc-500
    pdf.cell(0, 5, meta_info)
    pdf.ln(6)

    # Thick separator below title block
    pdf.set_draw_color(39, 39, 42)  # zinc-800
    pdf.set_line_width(0.4)
    pdf.line(18, pdf.get_y(), 192, pdf.get_y())
    pdf.ln(6)

    # Convert Markdown to HTML
    clean_md = sanitize_markdown_for_pdf(content)
    html = markdown.markdown(
        clean_md,
        extensions=["tables", "fenced_code"],
        output_format="html5",
    )

    # Render HTML content using fpdf2 HTML engine
    pdf.set_font(pdf.font_family_name, "", 10)
    pdf.set_text_color(39, 39, 42)  # zinc-800

    try:
        pdf.write_html(html)
        return bytes(pdf.output())
    except Exception as e:
        logger.warning(f"write_html encountered an error: {e}. Falling back to structured monospace PDF.")
        fallback_pdf = VelocityPDF(doc_title=title)
        fallback_pdf.alias_nb_pages()
        fallback_pdf.add_page()
        fallback_pdf.set_font(fallback_pdf.font_family_name, "B", 16)
        fallback_pdf.multi_cell(0, 7, title)
        fallback_pdf.ln(4)
        fallback_pdf.set_font(fallback_pdf.mono_family_name, "", 8.5)
        fallback_pdf.set_text_color(40, 40, 40)
        fallback_pdf.multi_cell(0, 4.5, content)
        return bytes(fallback_pdf.output())
