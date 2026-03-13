#!/usr/bin/env python3
"""Generate Development Description PDF for 160 Still Forest Dr IDP submission."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)

OUTPUT = "/Users/jacquelinegiroux/alpacapps/.claude/worktrees/admiring-chatterjee/jackie/pages/permittingplan/development-description.pdf"

# Colors
DARK = HexColor("#1c1618")
MUTED = HexColor("#666666")
ACCENT = HexColor("#d4883a")
NOTE_BG = HexColor("#f5f0e8")
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

h3_style = ParagraphStyle("H3", parent=styles["Heading3"],
    fontName="Helvetica-Bold", fontSize=10, leading=13,
    spaceBefore=10, spaceAfter=3, textColor=DARK)

body_style = ParagraphStyle("Body", parent=styles["Normal"],
    fontName="Helvetica", fontSize=9.5, leading=14,
    spaceAfter=8, textColor=DARK)

bullet_style = ParagraphStyle("Bullet", parent=body_style,
    bulletIndent=12, leftIndent=24, spaceAfter=3)

numbered_style = ParagraphStyle("Numbered", parent=body_style,
    leftIndent=24, spaceAfter=3)

note_style = ParagraphStyle("Note", parent=body_style,
    fontName="Helvetica", fontSize=8.5, leading=12,
    leftIndent=12, borderPadding=8, textColor=DARK)

small_style = ParagraphStyle("Small", parent=body_style,
    fontSize=8.5, leading=11, textColor=MUTED, alignment=TA_CENTER)

label_style = ParagraphStyle("Label", parent=body_style,
    fontName="Helvetica-Bold", fontSize=8.5, textColor=HexColor("#444444"))

value_style = ParagraphStyle("Value", parent=body_style,
    fontName="Helvetica", fontSize=8.5)

cell_style = ParagraphStyle("Cell", parent=body_style,
    fontName="Helvetica", fontSize=8, leading=11, spaceAfter=0)

cell_bold = ParagraphStyle("CellBold", parent=cell_style,
    fontName="Helvetica-Bold")


def build_pdf():
    doc = SimpleDocTemplate(OUTPUT, pagesize=letter,
        topMargin=0.6*inch, bottomMargin=0.6*inch,
        leftMargin=0.75*inch, rightMargin=0.75*inch)

    story = []
    W = doc.width

    # ── TITLE ──
    story.append(Paragraph("DEVELOPMENT DESCRIPTION", title_style))
    story.append(Paragraph(
        "Individualized Development Plan (IDP) — Lodging Development<br/>"
        "Submitted to Bastrop County Development Services", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=2, color=DARK, spaceAfter=12))

    # ── HEADER BLOCK ──
    header_data = [
        ("Property Address:", "160 Still Forest Drive, Cedar Creek, TX 78612"),
        ("Property ID (PID):", "44401"),
        ("Legal Description:", "Lot 14-B, Block 6, Replat of Lots 14 &amp; 15, Blue Bonnet Acres, Corrected Plat, Section One, O.P.R.B.C.T."),
        ("Acreage:", "1.7348 acres (75,133 SF)"),
        ("Property Owner:", "Revocable Trust of Subhash Sonnad (Revocable Transfer on Death Deed, Feb 21, 2021, Bastrop County)"),
        ("Owner Address:", "160 Still Forest Dr, Cedar Creek, TX 78612"),
        ("Owner Phone:", "+1 (424) 234-1750"),
        ("Owner Email:", "rahulioson@gmail.com"),
        ("Operator:", "Rahul Sonnad"),
        ("Floodplain Status:", "Zone X (unshaded) — NOT in 100-year floodplain"),
        ("Emergency Service District:", "BCESD #3 (Bastrop County Emergency Services District #3)"),
        ("Houston Toad Habitat:", "NOT in Lost Pines Habitat Conservation Plan (LPHCP) area — no Declination required"),
        ("Road Access:", "Still Forest Drive (County Road 329) — 60' right-of-way"),
        ("Survey:", "4Ward Land Surveying (2/4/2021), Jason Ward R.P.L.S. #5811"),
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

    # ── 1. PROJECT SUMMARY ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("1. PROJECT SUMMARY", h2_style))
    story.append(Paragraph(
        "The property owner proposes to develop the existing 1.7348-acre residential property at "
        "160 Still Forest Drive, Cedar Creek, Texas 78612 as a <b>mixed-use commercial lodging "
        "development</b> under an Individualized Development Plan (IDP) per the Bastrop County "
        "Infrastructure Requirements for Lodging &amp; Recreational Vehicle Park Developments.",
        body_style))
    story.append(Paragraph(
        "The development will provide <b>short-term lodging accommodations for a maximum of "
        "nine (9) guests</b> across multiple existing structures, with the property owner residing "
        "on-site in the main residence. The development is owner-operated with on-site management "
        "at all times.", body_style))
    story.append(Paragraph(
        "The property is accessed via Still Forest Drive (CR 329), a county-maintained road with a "
        "60-foot right-of-way. The property is <b>not</b> located on a State Highway; therefore, no "
        "TxDOT driveway permit is required.", body_style))

    # ── 2. EXISTING STRUCTURES ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("2. EXISTING STRUCTURES &amp; PROPOSED USE", h2_style))
    story.append(Paragraph(
        "The property currently contains the following structures, as documented on the 2021 survey "
        "by 4Ward Land Surveying and the preliminary site plan:", body_style))

    struct_header = [
        Paragraph("<b>#</b>", cell_bold),
        Paragraph("<b>Structure</b>", cell_bold),
        Paragraph("<b>Size</b>", cell_bold),
        Paragraph("<b>Proposed Use</b>", cell_bold),
        Paragraph("<b>Guest Capacity</b>", cell_bold),
    ]
    struct_rows = [
        ["1", "2-Story Stone &amp; Frame Residence (Main House)", "Approx. 2,400 SF",
         "<b>Owner-occupied</b> (1 BR) + <b>Lodging</b> (2 guest BRs)", "Up to 4 guests"],
        ["2", "1-Story Wood Building (Back House)", "Per survey",
         "<b>Lodging</b> — 2 guest bedrooms", "Up to 2 guests"],
        ["3", "Large Trailer", "10' x 42'",
         "<b>Lodging</b> — Studio rental unit", "Up to 2 guests"],
        ["4", "Small Trailer", "7'5\" x 20'5\"",
         "<b>Lodging</b> — 1-bedroom rental unit", "Up to 1 guest"],
        ["5", "Bathroom Building (under construction)", "17' x 17'",
         "<b>Amenity</b> — Shared guest bathroom (2 toilets + shower, 1st floor). 2nd floor: storage.", "—"],
        ["6", "Deck", "30' x 24'",
         "<b>Amenity</b> — Outdoor guest recreation", "—"],
        ["7", "Sauna", "7' x 7'",
         "<b>Amenity</b> — Guest wellness", "—"],
        ["8", "Shipping Container #1 (west side)", "40' x 8'",
         "<b>Storage</b> — Non-habitable", "—"],
        ["9", "Shipping Container #2 (front right)", "40' x 8'",
         "<b>Storage</b> — Non-habitable", "—"],
        ["10", "Shipping Container #3 (front left)", "40' x 8'",
         "<b>Storage</b> — Non-habitable", "—"],
    ]
    table_data = [struct_header]
    for row in struct_rows:
        table_data.append([Paragraph(c, cell_style) for c in row])

    struct_table = Table(table_data, colWidths=[22, W*0.28, 70, W*0.32, 65])
    struct_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_GRAY),
        ("GRID", (0, 0), (-1, -1), 0.5, TABLE_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(struct_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        "<b>Total rental units:</b> 4 structures (5 guest bedrooms + 1 studio = 6 rentable rooms)<br/>"
        "<b>Maximum simultaneous occupancy:</b> 9 guests + 1 owner = 10 persons<br/>"
        "<b>Owner-occupied:</b> 1 bedroom in main house (on-site management at all times)",
        body_style))

    # ── 3. PLANNED CONSTRUCTION ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("3. PLANNED CONSTRUCTION &amp; IMPROVEMENTS", h2_style))
    story.append(Paragraph(
        "The development primarily utilizes <b>existing structures</b> with minimal new construction required:",
        body_style))

    improvements = [
        "<b>Bathroom Building — Complete 2nd floor (storage):</b> The 1st floor (2 toilets + 1 shower) "
        "is substantially complete. The 2nd floor will be finished as non-habitable storage space only. "
        "No additional plumbing or occupancy on the 2nd floor.",
        "<b>Fire suppression water tank:</b> Install one (1) non-metallic 2,500-gallon water tank per "
        "Bastrop County fire protection requirements, with 2.5-inch fire hose coupling (N.S.T.), adjacent "
        "to the internal road, on an adequate foundation, labeled non-potable, vented, and secured.",
        "<b>9-1-1 address signage:</b> Address markers for each rental unit per county-assigned addresses.",
        "<b>Parking area improvements:</b> Designated parking for guests with all-weather surface as needed.",
    ]
    for i, item in enumerate(improvements, 1):
        story.append(Paragraph(f"{i}. {item}", numbered_style))

    story.append(Paragraph(
        "No new habitable structures are planned. All lodging units are existing structures.", body_style))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Note regarding the bathroom building:</b> This structure is currently under construction. "
        "The owner acknowledges that construction commenced prior to obtaining a development permit and "
        "will work with Bastrop County Development Services to bring the structure into compliance as "
        "part of the IDP approval process.", note_style))

    # ── 4. UTILITIES ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("4. UTILITIES &amp; INFRASTRUCTURE", h2_style))

    story.append(Paragraph("4a. Water Supply", h3_style))
    story.append(Paragraph(
        "The property is served by a <b>private water well</b>. The owner will obtain certification from "
        "the applicable groundwater conservation district confirming that adequate groundwater is available "
        "for the proposed development (10 persons maximum occupancy).", body_style))

    story.append(Paragraph("4b. Wastewater / Septic", h3_style))
    story.append(Paragraph(
        "The property is served by an <b>existing on-site sewage facility (OSSF)</b>. The owner will "
        "engage a licensed septic designer to:", body_style))
    for item in [
        "Evaluate the existing system's capacity to serve the proposed 10-person occupancy, including "
        "the new bathroom building (2 toilets + 1 shower)",
        "Prepare septic plan/specifications per Bastrop County OSSF requirements",
        "Determine whether the existing soil evaluation (2000) is valid or requires update",
        "Submit a commercial OSSF permit application to Bastrop County",
    ]:
        story.append(Paragraph(f"• {item}", bullet_style))
    story.append(Paragraph(
        "Upgrades to the septic system will be made as recommended by the licensed septic designer and "
        "approved by Bastrop County / TCEQ designated agent.", body_style))

    story.append(Paragraph("4c. Electric", h3_style))
    story.append(Paragraph(
        "The property is currently served by electric service (provider to be confirmed — likely "
        "Bluebonnet Electric Cooperative). An availability letter will be obtained confirming sufficient "
        "capacity for the development.", body_style))

    story.append(Paragraph("4d. Gas", h3_style))
    story.append(Paragraph(
        "Natural gas service availability will be confirmed during the pre-development meeting. "
        "If applicable, a gas availability letter will be provided.", body_style))

    story.append(Paragraph("4e. Fire Protection", h3_style))
    story.append(Paragraph(
        "No fire hydrants exist on the property. Per Bastrop County requirements for developments with "
        "fewer than 50 units, fire protection will be provided by a <b>2,500-gallon non-metallic water "
        "storage tank</b> with:", body_style))
    for item in [
        "At least one 2.5-inch fire hose coupling with National Standard Treads (N.S.T.)",
        "Placement adjacent to the internal road/driveway, accessible to BCESD #3 apparatus",
        "Non-potable label, adequate venting, secure foundation",
        "Tank to be installed, filled, and inspected prior to any guest occupancy",
    ]:
        story.append(Paragraph(f"• {item}", bullet_style))

    # ── 5. ACCESS ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("5. ACCESS &amp; CIRCULATION", h2_style))
    story.append(Paragraph(
        "The property is accessed from <b>Still Forest Drive (CR 329)</b>, a county-maintained road. "
        "The existing concrete and asphalt driveways provide access from the road to the main house and "
        "throughout the property.", body_style))
    story.append(Paragraph("Internal circulation will meet Bastrop County requirements:", body_style))
    for item in [
        "One-way drives: minimum 10 feet wide",
        "Two-way drives: minimum 20 feet wide",
        "All-weather surface, passable in all conditions",
        "Adequate turnaround space for emergency vehicles",
    ]:
        story.append(Paragraph(f"• {item}", bullet_style))
    story.append(Paragraph(
        "The existing driveway permit status will be confirmed with the county. A new county driveway "
        "permit ($50) will be obtained if required.", body_style))

    # ── 6. SETBACKS ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("6. SETBACK COMPLIANCE", h2_style))
    story.append(Paragraph(
        "The following setback requirements apply per Bastrop County Lodging Development regulations:",
        body_style))

    setback_data = [
        [Paragraph("<b>Setback Type</b>", cell_bold), Paragraph("<b>Required Distance</b>", cell_bold)],
        [Paragraph("From road right-of-way (Still Forest Dr)", cell_style), Paragraph("25 feet", cell_style)],
        [Paragraph("From property lines (all sides)", cell_style), Paragraph("15 feet", cell_style)],
        [Paragraph("From internal roads", cell_style), Paragraph("10 feet", cell_style)],
        [Paragraph("Between lodging units", cell_style), Paragraph("20 feet", cell_style)],
    ]
    setback_table = Table(setback_data, colWidths=[W*0.65, W*0.35])
    setback_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_GRAY),
        ("GRID", (0, 0), (-1, -1), 0.5, TABLE_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(setback_table)
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        "The preliminary site plan identifies several existing structures that may not meet the 15-foot "
        "property line setback requirement. The owner will work with the civil engineer and Bastrop County "
        "to address setback compliance through the IDP review process, which may include:", body_style))
    for item in [
        "Reclassifying non-lodging structures (storage containers) where setback requirements differ",
        "Relocating structures where feasible",
        "Requesting variances where relocation is not practical",
    ]:
        story.append(Paragraph(f"• {item}", bullet_style))

    # ── 7. DRAINAGE ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("7. DRAINAGE", h2_style))
    story.append(Paragraph(
        "The property is located in <b>FEMA Flood Zone X (unshaded)</b> — not within the 100-year or "
        "500-year floodplain. A drainage study demonstrating zero net increase in stormwater runoff will "
        "be prepared by the project civil engineer as part of the IDP submission, per Bastrop County "
        "Subdivision Regulations and Flood Damage Prevention Order.", body_style))

    # ── 8. REGULATORY ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("8. REGULATORY COMPLIANCE", h2_style))
    for item in [
        "<b>Floodplain:</b> Zone X (unshaded) — no floodplain restrictions or fee surcharges",
        "<b>Houston Toad / LPHCP:</b> Property is NOT in the Lost Pines Habitat Conservation Plan area — "
        "no LPHCP Declination of Coverage required",
        "<b>Emergency Services:</b> BCESD #3 — ESD compliance letter to be obtained",
        "<b>Road Access:</b> County road (CR 329) — no TxDOT driveway permit required",
        "<b>Building Setback Line:</b> 25-foot building setback from Still Forest Drive ROW, as shown on recorded plat",
        "<b>Public Utility Easement:</b> 10-foot P.U.E. along Still Forest Drive frontage, as shown on recorded plat",
    ]:
        story.append(Paragraph(f"• {item}", bullet_style))

    # ── 9. TIMELINE ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("9. TIMELINE", h2_style))
    story.append(Paragraph(
        "The owner intends to begin lodging operations as soon as practicable following IDP approval. "
        "The development will proceed as follows:", body_style))
    for i, item in enumerate([
        "<b>Pre-Development Meeting</b> — Scheduled with Bastrop County Development Services (Phase A — in progress)",
        "<b>IDP Application Submission</b> — Following pre-development meeting guidance, with all required documents",
        "<b>30-Day County Review</b> — Per Texas Local Government Code §232.0025",
        "<b>Commissioners Court Approval</b> — Final approval of the IDP",
        "<b>Construction / Improvements</b> — Complete bathroom building 2nd floor (storage), install fire suppression tank, any septic upgrades",
        "<b>Final Inspections</b> — Fire suppression, septic, building compliance",
        "<b>Begin Operations</b> — Target: 2026",
    ], 1):
        story.append(Paragraph(f"{i}. {item}", numbered_style))

    # ── 10. ATTACHMENTS ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc")))
    story.append(Paragraph("10. ATTACHMENTS", h2_style))
    story.append(Paragraph(
        "The following documents are included or will be provided with the IDP application:", body_style))
    for i, item in enumerate([
        "Preliminary Site Plan (draft — PE-stamped version to follow)",
        "2021 Survey / Plat (4Ward Land Surveying, R.P.L.S. #5811)",
        "Proof of Ownership (Correction Deed, Transfer on Death Deed — Doc. No. 202005552)",
        "Location Map",
        "Water Availability Letter (pending)",
        "Electric Availability Letter (pending)",
        "ESD Compliance Letter — BCESD #3 (pending)",
        "OSSF Permit Application + Septic Plan (pending — licensed septic designer)",
        "Drainage Study (pending — civil engineer)",
        "PE-Signed/Sealed Site Plan (pending — civil engineer)",
        "Fire Suppression Plan (pending)",
        "Operator Information (included herein)",
    ], 1):
        story.append(Paragraph(f"{i}. {item}", numbered_style))

    # ── FOOTER / SIGNATURE ──
    story.append(Spacer(1, 20))
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
