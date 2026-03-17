#!/usr/bin/env python3
"""Generate Cost Estimate Breakdown PDF for Commercial Building Permit — Bathroom Building."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)

OUTPUT = "/Users/jacquelinegiroux/alpacapps/.claude/worktrees/elastic-ellis/jackie/pages/permittingplan/building-permit-cost-breakdown.pdf"

# Colors — matching building permit page teal accent
DARK = HexColor("#1c1618")
MUTED = HexColor("#666666")
ACCENT = HexColor("#0d9488")
HEADER_BG = HexColor("#f0fdfa")
NOTE_BG = HexColor("#f5f0e8")
LIGHT_GRAY = HexColor("#eeeeee")
TABLE_BORDER = HexColor("#999999")
SUBTOTAL_BG = HexColor("#fef9c3")

styles = getSampleStyleSheet()

title_style = ParagraphStyle("DocTitle", parent=styles["Title"],
    fontName="Helvetica-Bold", fontSize=18, leading=22,
    alignment=TA_CENTER, spaceAfter=2, textColor=DARK)

subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"],
    fontName="Helvetica", fontSize=9, leading=12,
    alignment=TA_CENTER, textColor=MUTED, spaceAfter=12)

h2_style = ParagraphStyle("H2", parent=styles["Heading2"],
    fontName="Helvetica-Bold", fontSize=12, leading=16,
    spaceBefore=18, spaceAfter=8, textColor=ACCENT)

body_style = ParagraphStyle("Body", parent=styles["Normal"],
    fontName="Helvetica", fontSize=9.5, leading=14,
    spaceAfter=8, textColor=DARK)

bullet_style = ParagraphStyle("Bullet", parent=body_style,
    bulletIndent=12, leftIndent=24, spaceAfter=3)

small_style = ParagraphStyle("Small", parent=body_style,
    fontSize=8.5, leading=11, textColor=MUTED, alignment=TA_CENTER)

cell_style = ParagraphStyle("Cell", parent=body_style,
    fontName="Helvetica", fontSize=8.5, leading=11, spaceAfter=0)

cell_bold = ParagraphStyle("CellBold", parent=cell_style,
    fontName="Helvetica-Bold")

cell_right = ParagraphStyle("CellRight", parent=cell_style,
    alignment=2)  # TA_RIGHT = 2

cell_bold_right = ParagraphStyle("CellBoldRight", parent=cell_bold,
    alignment=2)


def make_cost_table(section_title, rows, subtotal_label, subtotal_low, subtotal_high, subtotal_mid, W):
    """Create a styled cost table section."""
    elements = []
    elements.append(Paragraph(section_title, h2_style))

    header = [
        Paragraph("<b>Task</b>", cell_bold),
        Paragraph("<b>Code</b>", cell_bold),
        Paragraph("<b>Low</b>", cell_bold),
        Paragraph("<b>High</b>", cell_bold),
        Paragraph("<b>Midpoint</b>", cell_bold),
        Paragraph("<b>Notes</b>", cell_bold),
    ]
    table_data = [header]
    for row in rows:
        table_data.append([
            Paragraph(row[0], cell_style),
            Paragraph(row[1], cell_style),
            Paragraph(row[2], cell_right),
            Paragraph(row[3], cell_right),
            Paragraph(row[4], cell_right),
            Paragraph(row[5], cell_style),
        ])
    # Subtotal row
    table_data.append([
        Paragraph(f"<b>{subtotal_label}</b>", cell_bold),
        Paragraph("", cell_style),
        Paragraph(f"<b>{subtotal_low}</b>", cell_bold_right),
        Paragraph(f"<b>{subtotal_high}</b>", cell_bold_right),
        Paragraph(f"<b>{subtotal_mid}</b>", cell_bold_right),
        Paragraph("", cell_style),
    ])

    col_widths = [W*0.26, 35, 55, 55, 60, W*0.30]
    table = Table(table_data, colWidths=col_widths)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("BACKGROUND", (0, -1), (-1, -1), SUBTOTAL_BG),
        ("GRID", (0, 0), (-1, -1), 0.5, TABLE_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    table.setStyle(TableStyle(style_cmds))
    elements.append(table)
    elements.append(Spacer(1, 8))
    return elements


def build_pdf():
    doc = SimpleDocTemplate(OUTPUT, pagesize=letter,
        topMargin=0.6*inch, bottomMargin=0.6*inch,
        leftMargin=0.75*inch, rightMargin=0.75*inch)

    story = []
    W = doc.width

    # ── TITLE ──
    story.append(Paragraph("Building Permit Cost Estimate", title_style))
    story.append(Paragraph(
        "160 Still Forest Dr, Cedar Creek TX 78612<br/>"
        "Commercial Building Permit — Bathroom Building (17' x 17', 2-Story)<br/>"
        "Prepared: March 17, 2026", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceAfter=14))

    # ── PROPERTY DETAILS ──
    story.append(Paragraph(
        "<b>Address:</b> 160 Still Forest Dr, Cedar Creek, TX 78612 (Bastrop County, unincorporated)<br/>"
        "<b>Lot Size:</b> 1.73 acres (75,499 sq ft)<br/>"
        "<b>Structure:</b> 17' x 17' two-story bathroom building (1st floor: 2 toilets + shower; 2nd floor: storage)<br/>"
        "<b>Occupancy:</b> Commercial (lodging amenity — shared guest bathroom)<br/>"
        "<b>Owner:</b> Revocable Trust of Subhash Sonnad", body_style))
    story.append(Spacer(1, 6))

    # ── PHASE A: DESIGN PROFESSIONALS ──
    story.extend(make_cost_table(
        "Phase A — Design Professionals",
        [
            ["Licensed Architect", "A1", "$3,000", "$6,000", "$4,500",
             "TX Registered Architect; small commercial"],
            ["Structural Engineer (PE)", "A2", "$2,000", "$4,000", "$3,000",
             "Foundation + framing for 2-story"],
            ["Geotechnical / Soil Report", "A3", "$1,500", "$3,000", "$2,000",
             "Soil borings for foundation design"],
            ["Architectural Plans", "A4", "$0", "$0", "$0",
             "Included in architect fee (A1)"],
            ["Structural Plans", "A5", "$0", "$0", "$0",
             "Included in structural engineer fee (A2)"],
            ["MEP — Mechanical (HVAC)", "A6", "$1,000", "$2,500", "$1,500",
             "Small commercial HVAC design"],
            ["MEP — Electrical", "A7", "$800", "$2,000", "$1,200",
             "Lighting, panels, NEC compliance"],
            ["MEP — Plumbing", "A8", "$800", "$2,000", "$1,200",
             "2 toilets + shower; tie to existing OSSF"],
        ],
        "Design Subtotal", "$9,100", "$19,500", "$13,400", W
    ))

    # ── PHASE B: COMPLIANCE & TECHNICAL ──
    story.extend(make_cost_table(
        "Phase B — Compliance &amp; Technical Studies",
        [
            ["Fire Protection / Suppression Plan", "B1", "$1,500", "$4,000", "$2,500",
             "Sprinkler + fire alarm per IFC"],
            ["TDLR Accessibility Registration", "B2", "$250", "$500", "$375",
             "State registration fee; required for all commercial"],
            ["ADA / TAS Compliance Review", "B3", "$500", "$1,500", "$1,000",
             "Accessible restroom + routes design"],
            ["Energy Code (IECC / COMcheck)", "B4", "$300", "$800", "$500",
             "COMcheck report; often included w/ architect"],
            ["Drainage Plan (PE-signed)", "B5", "$0", "$0", "$0",
             "Carried over from development permit"],
            ["Erosion &amp; Sediment Control", "B6", "$0", "$500", "$250",
             "May be bundled with drainage"],
            ["Site / Civil Plans Update", "B7", "$500", "$1,500", "$1,000",
             "Update existing site plan for building footprint"],
            ["Parking &amp; Traffic Analysis", "B8", "$0", "$500", "$250",
             "Small project; may not be required"],
            ["Septic Capacity Verification", "B9", "$500", "$1,500", "$1,000",
             "Verify existing Jet J-500 supports added load"],
            ["Elevation Certificates", "B10", "$0", "$0", "$0",
             "Zone X — not in floodplain"],
        ],
        "Compliance Subtotal", "$3,550", "$10,800", "$6,875", W
    ))

    # ── PHASE C: APPLICATION & FEES ──
    story.extend(make_cost_table(
        "Phase C — Application &amp; County Fees",
        [
            ["Development Application Fee", "C1", "$1,000", "$2,500", "$1,750",
             "Based on construction cost; check county schedule"],
            ["Proof of Ownership (Deed)", "C2", "$0", "$0", "$0",
             "Already on file from development permit"],
            ["Updated Survey / Plat", "C3", "$0", "$500", "$250",
             "May need update to show building footprint"],
            ["Compile Sealed Plans Package", "C4", "$0", "$0", "$0",
             "No additional cost; compilation task"],
            ["TDLR Review Approval", "C5", "$0", "$0", "$0",
             "No additional fee beyond B2 registration"],
            ["Release of Easement", "C6", "$0", "$500", "$0",
             "Only if building is on/near easement"],
            ["Submit Application + Fees", "C7", "$0", "$0", "$0",
             "Fee included in C1"],
            ["LPHCP Compliance", "C8", "$0", "$0", "$0",
             "Carried over from development permit"],
        ],
        "Application Subtotal", "$1,000", "$3,500", "$2,000", W
    ))

    # ── PHASE D: CONSTRUCTION & INSPECTION ──
    story.extend(make_cost_table(
        "Phase D — Construction &amp; Inspections",
        [
            ["Plan Review by County", "D1", "$0", "$0", "$0",
             "Included in application fee"],
            ["Address Review Comments", "D2", "$0", "$500", "$250",
             "Architect/engineer revisions if needed"],
            ["Building Permit Issuance", "D3", "$0", "$0", "$0",
             "Issued after plan review approval"],
            ["Construction Inspections", "D4", "$200", "$500", "$350",
             "Foundation, framing, MEP, fire, insulation"],
            ["Final Inspection", "D5", "$0", "$0", "$0",
             "Included in permit fees"],
            ["Certificate of Occupancy", "D6", "$0", "$0", "$0",
             "Issued after final inspection"],
        ],
        "Inspection Subtotal", "$200", "$1,000", "$600", W
    ))

    # ── GRAND TOTAL ──
    story.append(Spacer(1, 8))
    story.append(Paragraph("Grand Total Summary", h2_style))

    summary_header = [
        Paragraph("<b>Category</b>", cell_bold),
        Paragraph("<b>Low</b>", cell_bold),
        Paragraph("<b>High</b>", cell_bold),
        Paragraph("<b>Midpoint</b>", cell_bold),
    ]
    summary_rows = [
        summary_header,
        [Paragraph("Design Professionals (Phase A)", cell_style),
         Paragraph("$9,100", cell_right), Paragraph("$19,500", cell_right), Paragraph("$13,400", cell_right)],
        [Paragraph("Compliance &amp; Technical (Phase B)", cell_style),
         Paragraph("$3,550", cell_right), Paragraph("$10,800", cell_right), Paragraph("$6,875", cell_right)],
        [Paragraph("Application &amp; Fees (Phase C)", cell_style),
         Paragraph("$1,000", cell_right), Paragraph("$3,500", cell_right), Paragraph("$2,000", cell_right)],
        [Paragraph("Inspections (Phase D)", cell_style),
         Paragraph("$200", cell_right), Paragraph("$1,000", cell_right), Paragraph("$600", cell_right)],
        [Paragraph("<b>GRAND TOTAL</b>", cell_bold),
         Paragraph("<b>$13,850</b>", cell_bold_right), Paragraph("<b>$34,800</b>", cell_bold_right),
         Paragraph("<b>$22,875</b>", cell_bold_right)],
    ]

    summary_table = Table(summary_rows, colWidths=[W*0.45, W*0.18, W*0.18, W*0.19])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("BACKGROUND", (0, -1), (-1, -1), SUBTOTAL_BG),
        ("GRID", (0, 0), (-1, -1), 0.5, TABLE_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(summary_table)

    # ── IMPORTANT NOTES ──
    story.append(Spacer(1, 16))
    story.append(Paragraph("Important Notes", h2_style))
    notes = [
        "All estimates are for Bastrop County / Central Texas area, March 2026.",
        "This cost estimate covers <b>permitting and design costs only</b> — actual construction costs are separate.",
        "\"Midpoint\" values are used in the building_permit_tasks tracking system.",
        "The architect fee ($3K–$6K) is the largest design cost — negotiate a package deal that includes MEP coordination.",
        "Several items carry over from the development permit at no additional cost (drainage plan, LPHCP, deed, etc.).",
        "TDLR registration is <b>mandatory</b> for all commercial construction in Texas — do not skip.",
        "Fire suppression requirements should be confirmed with BCESD #3 — small buildings may qualify for reduced requirements.",
        "Septic capacity verification is critical: the existing Jet J-500 (300 GPD) must support added bathroom fixtures.",
        "Construction costs (materials, labor, concrete, framing, plumbing, electrical, finishes) are <b>not included</b> in this estimate.",
    ]
    for note in notes:
        story.append(Paragraph(f"• {note}", bullet_style))

    # ── SOURCES ──
    story.append(Spacer(1, 12))
    story.append(Paragraph("Sources", h2_style))
    sources = [
        "Bastrop County Development Services Application Fees (official fee schedule PDF)",
        "Texas Department of Licensing &amp; Regulation (TDLR) — Elimination of Architectural Barriers program",
        "International Building Code (IBC) 2021 — commercial construction requirements",
        "Central Texas architect, engineer, and MEP professional market rates (2025–2026)",
        "TCEQ OSSF requirements for commercial on-site sewage facilities",
    ]
    for src in sources:
        story.append(Paragraph(f"• {src}", bullet_style))

    # ── FOOTER ──
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Prepared for: Revocable Trust of Subhash Sonnad<br/>"
        "Bastrop County Development Services — 211 Jackson Street, Bastrop, TX 78602 • (512) 581-7176",
        small_style))

    doc.build(story)
    print(f"PDF created: {OUTPUT}")


if __name__ == "__main__":
    build_pdf()
