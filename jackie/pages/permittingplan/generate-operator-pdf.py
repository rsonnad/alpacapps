#!/usr/bin/env python3
"""Generate Operator Information PDF (B16) for 160 Still Forest Dr IDP submission."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)

OUTPUT = "/Users/jacquelinegiroux/alpacapps/.claude/worktrees/strange-easley/jackie/pages/permittingplan/operator-information.pdf"

# Colors (same as A6 development description)
DARK = HexColor("#1c1618")
MUTED = HexColor("#666666")
ACCENT = HexColor("#d4883a")
LIGHT_GRAY = HexColor("#eeeeee")
TABLE_BORDER = HexColor("#999999")

styles = getSampleStyleSheet()

title_style = ParagraphStyle("DocTitle", parent=styles["Title"],
    fontName="Helvetica-Bold", fontSize=16, leading=20,
    alignment=TA_CENTER, spaceAfter=2, textColor=DARK)

subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"],
    fontName="Helvetica", fontSize=9, leading=12,
    alignment=TA_CENTER, textColor=MUTED, spaceAfter=12)

h2_style = ParagraphStyle("H2", parent=styles["Heading2"],
    fontName="Helvetica-Bold", fontSize=12, leading=16,
    spaceBefore=18, spaceAfter=6, textColor=DARK)

body_style = ParagraphStyle("Body", parent=styles["Normal"],
    fontName="Helvetica", fontSize=9.5, leading=14,
    spaceAfter=8, textColor=DARK)

bullet_style = ParagraphStyle("Bullet", parent=body_style,
    bulletIndent=12, leftIndent=24, spaceAfter=3)

label_style = ParagraphStyle("Label", parent=body_style,
    fontName="Helvetica-Bold", fontSize=8.5, textColor=HexColor("#444444"))

value_style = ParagraphStyle("Value", parent=body_style,
    fontName="Helvetica", fontSize=8.5)

cell_style = ParagraphStyle("Cell", parent=body_style,
    fontName="Helvetica", fontSize=8.5, leading=12, spaceAfter=0)

cell_bold = ParagraphStyle("CellBold", parent=cell_style,
    fontName="Helvetica-Bold")

small_style = ParagraphStyle("Small", parent=body_style,
    fontSize=8.5, leading=11, textColor=MUTED, alignment=TA_CENTER)

indent_style = ParagraphStyle("Indent", parent=body_style,
    leftIndent=24)


def build_pdf():
    doc = SimpleDocTemplate(OUTPUT, pagesize=letter,
        topMargin=0.6*inch, bottomMargin=0.6*inch,
        leftMargin=0.75*inch, rightMargin=0.75*inch)

    story = []
    W = doc.width

    # ── TITLE ──
    story.append(Paragraph("OPERATOR INFORMATION", title_style))
    story.append(Paragraph(
        "Supplemental Document B16 — IDP Submission<br/>"
        "Submitted to Bastrop County Development Services", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=2, color=DARK, spaceAfter=12))

    # ── HEADER BLOCK ──
    header_data = [
        ("Property Address:", "160 Still Forest Drive, Cedar Creek, TX 78612"),
        ("Property ID (PID):", "44401"),
        ("Property Owner:", "Revocable Trust of Subhash Sonnad"),
        ("Development Type:", "Mixed-use commercial lodging (IDP)"),
    ]
    rows = []
    for i in range(0, len(header_data), 2):
        left_label = Paragraph(f"<b>{header_data[i][0]}</b>", label_style)
        left_value = Paragraph(header_data[i][1], value_style)
        if i + 1 < len(header_data):
            right_label = Paragraph(f"<b>{header_data[i+1][0]}</b>", label_style)
            right_value = Paragraph(header_data[i+1][1], value_style)
        else:
            right_label = Paragraph("", label_style)
            right_value = Paragraph("", value_style)
        rows.append([left_label, left_value, right_label, right_value])

    col_w = W / 4
    header_table = Table(rows, colWidths=[col_w*0.9, col_w*1.1, col_w*0.9, col_w*1.1])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 12))

    # ── 1. DESIGNATED OPERATOR ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("1. DESIGNATED OPERATOR", h2_style))

    op_data = [
        [Paragraph("<b>Full Name</b>", cell_bold), Paragraph("Rahul Sonnad", cell_style)],
        [Paragraph("<b>Role</b>", cell_bold), Paragraph("Operator &amp; On-Site Manager", cell_style)],
        [Paragraph("<b>Mailing Address</b>", cell_bold), Paragraph("160 Still Forest Dr, Cedar Creek, TX 78612", cell_style)],
        [Paragraph("<b>Phone</b>", cell_bold), Paragraph("+1 (424) 234-1750", cell_style)],
        [Paragraph("<b>Email</b>", cell_bold), Paragraph("rahulioson@gmail.com", cell_style)],
    ]
    op_table = Table(op_data, colWidths=[W*0.3, W*0.7])
    op_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), LIGHT_GRAY),
        ("GRID", (0, 0), (-1, -1), 0.5, TABLE_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(op_table)
    story.append(Spacer(1, 8))

    # ── 2. AUTHORITY TO OPERATE ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("2. AUTHORITY TO OPERATE", h2_style))
    story.append(Paragraph(
        "The property at 160 Still Forest Drive, Cedar Creek, TX 78612 (PID 44401) is owned by the "
        "<b>Revocable Trust of Subhash Sonnad</b>. Rahul Sonnad serves as <b>Trustee</b> of the trust "
        "and is authorized to act on behalf of the trust in all matters related to this property, including "
        "development applications, permit submissions, and day-to-day operation of the lodging development.",
        body_style))

    # ── 3. OPERATIONAL RESPONSIBILITIES ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("3. OPERATIONAL RESPONSIBILITIES", h2_style))
    story.append(Paragraph(
        "As the designated operator, Rahul Sonnad will be responsible for:", body_style))

    responsibilities = [
        "<b>On-site management</b> — Residing at the property and providing on-site supervision "
        "at all times during guest occupancy",
        "<b>Guest safety &amp; compliance</b> — Ensuring all lodging operations comply with Bastrop County "
        "development conditions, fire safety requirements, and occupancy limits (maximum 9 guests)",
        "<b>Infrastructure maintenance</b> — Maintaining the fire suppression water tank, septic system, "
        "private water well, driveways, and all structures in compliance with county standards",
        "<b>Emergency coordination</b> — Serving as the primary point of contact for BCESD #3 and "
        "Bastrop County in the event of an emergency or compliance inquiry",
        "<b>Record keeping</b> — Maintaining guest records and occupancy logs as required by Bastrop County",
    ]
    for item in responsibilities:
        story.append(Paragraph(f"• {item}", bullet_style))

    # ── 4. CONTACT FOR COUNTY CORRESPONDENCE ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("4. CONTACT FOR COUNTY CORRESPONDENCE", h2_style))
    story.append(Paragraph(
        "All correspondence regarding this development should be directed to:", body_style))
    story.append(Paragraph(
        "<b>Rahul Sonnad, Trustee</b><br/>"
        "Revocable Trust of Subhash Sonnad<br/>"
        "160 Still Forest Dr<br/>"
        "Cedar Creek, TX 78612<br/>"
        "Phone: +1 (424) 234-1750<br/>"
        "Email: rahulioson@gmail.com", indent_style))

    # ── FOOTER / SIGNATURE ──
    story.append(Spacer(1, 30))
    story.append(HRFlowable(width="100%", thickness=2, color=DARK))
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "Prepared for submission to Bastrop County Development Services<br/>"
        "211 Jackson Street, Bastrop, Texas 78602 • (512) 581-7176", small_style))
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "<b>Date:</b> ________________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
        "<b>Signature:</b> ___________________________<br/>"
        "Rahul Sonnad, Trustee — Revocable Trust of Subhash Sonnad", small_style))

    doc.build(story)
    print(f"PDF created: {OUTPUT}")


if __name__ == "__main__":
    build_pdf()
