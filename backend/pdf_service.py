"""Theme-aware Markdown PDF export without remote resource loading."""

import html
from html.parser import HTMLParser
from pathlib import Path
from datetime import datetime
from typing import Optional

import markdown
from fpdf import FPDF
from fpdf.fonts import TextStyle


THEMES = {
    "editorial": {"family": "Serif", "size": 11, "background": (255, 255, 255), "text": (32, 32, 35)},
    "clean": {"family": "Sans", "size": 10.5, "background": (255, 255, 255), "text": (32, 32, 35)},
    "technical": {"family": "Sans", "size": 9.5, "background": (248, 248, 250), "text": (32, 32, 35)},
    "midnight": {"family": "Sans", "size": 10.5, "background": (20, 20, 22), "text": (228, 228, 231)},
}


class SafeDocumentHTML(HTMLParser):
    allowed = {"p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "a"}
    blocked = {"script", "style", "iframe", "object", "svg"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.blocked_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.blocked:
            self.blocked_depth += 1
        if self.blocked_depth or tag not in self.allowed:
            return
        safe = []
        for name, value in attrs:
            if tag == "a" and name == "href" and value and value.startswith(("https://", "http://", "mailto:")):
                safe.append(f' href="{html.escape(value, quote=True)}"')
            if tag == "ol" and name == "start" and value and value.isdigit():
                safe.append(f' start="{value}"')
        self.parts.append("<" + tag + "".join(safe) + ">")

    def handle_endtag(self, tag):
        if tag in self.blocked:
            self.blocked_depth = max(0, self.blocked_depth - 1)
            return
        if not self.blocked_depth and tag in self.allowed:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.blocked_depth:
            self.parts.append(html.escape(data))


class VelocityPDF(FPDF):
    def __init__(self, doc_title="Velocity Document", theme="editorial"):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.doc_title = doc_title[:60]
        self.appearance = THEMES[theme]
        self.font_family_name = self.appearance["family"]
        self.mono_family_name = "Mono"
        self.set_auto_page_break(auto=True, margin=20)
        self.set_margins(20, 24, 20)
        directory = Path(__file__).resolve().parent / "fonts"
        for family, basename, italic in (("Sans", "DejaVuSans", "Oblique"), ("Serif", "DejaVuSerif", "Italic")):
            for style, suffix in (("", ""), ("B", "-Bold"), ("I", "-" + italic), ("BI", "-Bold" + italic)):
                self.add_font(family, style, str(directory / (basename + suffix + ".ttf")))
        for style in ("", "B", "I", "BI"):
            self.add_font("Mono", style, str(directory / "DejaVuSansMono.ttf"))

    def header(self):
        self.set_fill_color(*self.appearance["background"])
        self.rect(0, 0, self.w, self.h, style="F")
        self.set_font("Sans", "", 8)
        self.set_text_color(*( (154, 163, 208) if self.appearance["background"][0] < 30 else (87, 95, 159) ))
        self.cell(0, 5, "Velocity", align="R")
        self.ln(9)
        self.set_text_color(*self.appearance["text"])

    def footer(self):
        self.set_y(-14)
        self.set_font("Sans", "", 8)
        self.set_text_color(*self.appearance["text"])
        self.cell(0, 6, f"{self.page_no()} / {{nb}}", align="C")


def sanitize_markdown_for_pdf(content):
    return content.replace("\u200b", "").replace("\ufeff", "")


def generate_artifact_pdf(title: str, content: str, artifact_type: str = "Document", version: int = 1,
                          created_at: Optional[str] = None, theme: str = "editorial") -> bytes:
    if theme not in THEMES:
        raise ValueError("Unknown document theme")
    pdf = VelocityPDF(title, theme)
    pdf.set_title(title)
    pdf.set_author("Velocity")
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_font(pdf.font_family_name, "B", 22)
    pdf.multi_cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    metadata = f"{artifact_type.replace('_', ' ').upper()}  ·  VERSION {version}"
    if created_at:
        try:
            metadata += "  ·  " + datetime.fromisoformat(created_at.replace("Z", "+00:00")).strftime("%b %d, %Y")
        except ValueError:
            pass
    pdf.set_font("Sans", "", 8)
    pdf.multi_cell(0, 5, metadata, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)
    converter = SafeDocumentHTML()
    converter.feed(markdown.markdown(sanitize_markdown_for_pdf(content), extensions=["tables", "fenced_code", "sane_lists"], output_format="html5"))
    converter.close()
    pdf.set_font(pdf.font_family_name, "", pdf.appearance["size"])
    pdf.set_text_color(*pdf.appearance["text"])
    styles = {tag: TextStyle(font_family=pdf.font_family_name, color=pdf.appearance["text"], font_size_pt=size)
              for tag, size in (("p", pdf.appearance["size"]), ("h1", 19), ("h2", 16), ("h3", 13), ("h4", 12), ("h5", 11), ("h6", 10))}
    styles["pre"] = TextStyle(font_family="Mono", font_size_pt=8, color=pdf.appearance["text"])
    styles["a"] = TextStyle(color=(154, 163, 208) if theme == "midnight" else (87, 95, 159))
    styles["li"] = TextStyle(l_margin=5)
    styles["blockquote"] = TextStyle(l_margin=5, color=pdf.appearance["text"])
    pdf.write_html("".join(converter.parts), font_family=pdf.font_family_name,
                   li_prefix_color=pdf.appearance["text"], tag_styles=styles, table_line_separators=True)
    return bytes(pdf.output())
