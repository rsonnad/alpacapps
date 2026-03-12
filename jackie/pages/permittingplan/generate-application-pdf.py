#!/usr/bin/env python3
"""
Generate a filled-out Bastrop County Development Services Application PDF
using property data from the permitting plan pages.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import black, white, HexColor
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

OUTPUT = os.path.join(os.path.dirname(__file__), "bastrop-county-application-filled.pdf")

# Colors
GRAY_BG = HexColor("#E8E8E8")
DARK_GRAY = HexColor("#444444")
LIGHT_GRAY = HexColor("#F0F0F0")
BLUE_INK = HexColor("#00008B")
CHECK_GREEN = HexColor("#006400")

W, H = letter  # 612 x 792

def draw_checkbox(c, x, y, checked=False, size=9):
    """Draw a checkbox, filled if checked."""
    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.rect(x, y, size, size, stroke=1, fill=0)
    if checked:
        c.setStrokeColor(CHECK_GREEN)
        c.setLineWidth(1.5)
        # Draw checkmark
        c.line(x + 2, y + size/2, x + size/2 - 0.5, y + 2)
        c.line(x + size/2 - 0.5, y + 2, x + size - 2, y + size - 2)
        c.setStrokeColor(black)
        c.setLineWidth(0.5)

def draw_radio(c, x, y, selected=False, size=9):
    """Draw a radio button."""
    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.circle(x + size/2, y + size/2, size/2, stroke=1, fill=0)
    if selected:
        c.setFillColor(BLUE_INK)
        c.circle(x + size/2, y + size/2, size/2 - 2, stroke=0, fill=1)
        c.setFillColor(black)

def draw_field_value(c, x, y, value, width=None):
    """Draw a filled-in field value in blue ink."""
    c.setFillColor(BLUE_INK)
    c.setFont("Helvetica", 9)
    if width:
        # Truncate if needed
        while c.stringWidth(value, "Helvetica", 9) > width and len(value) > 1:
            value = value[:-1]
    c.drawString(x, y, value)
    c.setFillColor(black)

def draw_section_header(c, x, y, w, text):
    """Draw a bold section header with gray background."""
    c.setFillColor(GRAY_BG)
    c.rect(x, y - 2, w, 14, stroke=0, fill=1)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(x + 4, y + 1, text)

def draw_label(c, x, y, text, size=7.5):
    """Draw a form label."""
    c.setFillColor(DARK_GRAY)
    c.setFont("Helvetica", size)
    c.drawString(x, y, text)
    c.setFillColor(black)

def draw_underline(c, x, y, w):
    """Draw a form underline."""
    c.setStrokeColor(HexColor("#999999"))
    c.setLineWidth(0.3)
    c.line(x, y, x + w, y)

def build_page1(c):
    """Build page 1 of the application."""
    margin = 36  # 0.5 inch
    rmargin = W - margin
    content_w = rmargin - margin

    # ========== HEADER ==========
    # Official use only box
    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.rect(W - 180, H - 60, 144, 48, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7)
    c.drawString(W - 175, H - 22, "OFFICIAL USE ONLY")
    c.setFont("Helvetica", 7)
    c.drawString(W - 175, H - 36, "Project:")
    draw_underline(c, W - 145, H - 37, 100)

    # Title
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin, H - 30, "BASTROP COUNTY DEVELOPMENT SERVICES APPLICATION")
    c.setFont("Helvetica", 7)
    c.drawString(margin, H - 42, "211 Jackson Street, Bastrop, Texas 78602  ◆  512 / 581-7176  ◆  512 / 581-7178 (fax)  ◆  Website: www.co.bastrop.tx.us")

    # Instructions
    c.setFont("Helvetica-BoldOblique", 7)
    c.drawString(margin, H - 56, "PRINT CLEARLY AND COMPLETE ALL QUESTIONS. ENTER \"N/A\" IF ITEM DOES NOT APPLY. DO NOT LEAVE ANY ITEM BLANK.")

    y = H - 72

    # ========== APPLICATION TYPE ==========
    draw_section_header(c, margin, y, content_w, "APPLICATION TYPE – Select all that apply.")
    y -= 18
    draw_checkbox(c, margin + 10, y, checked=True)
    c.setFont("Helvetica", 8)
    c.drawString(margin + 24, y + 1, "Development/Construction")
    draw_checkbox(c, margin + 155, y, checked=False)
    c.drawString(margin + 169, y + 1, "Driveway")
    draw_checkbox(c, margin + 240, y, checked=True)
    c.drawString(margin + 254, y + 1, "911 Address")
    draw_checkbox(c, margin + 330, y, checked=False)
    c.drawString(margin + 344, y + 1, "Temporary Address")

    y -= 20

    # ========== REQUIRED DOCUMENTS ==========
    draw_section_header(c, margin, y, content_w,
        "REQUIRED DOCUMENTS – Application must include items shown below. An incomplete/illegible application will delay the process and may be returned.")
    y -= 18
    draw_checkbox(c, margin + 10, y, checked=True)
    c.setFont("Helvetica", 8)
    c.drawString(margin + 24, y + 1, "Proof of Ownership")
    y -= 14
    draw_checkbox(c, margin + 10, y, checked=True)
    c.drawString(margin + 24, y + 1, "Copy of Survey or Plat")
    y -= 14
    draw_checkbox(c, margin + 10, y, checked=True)
    c.drawString(margin + 24, y + 1, "Site Plan")
    y -= 14
    draw_checkbox(c, margin + 10, y, checked=True)
    c.drawString(margin + 24, y + 1, "Other Required Documents")
    draw_field_value(c, margin + 155, y + 1, "(IDP Development Description, Operator Information, Septic Plan)")

    y -= 22

    # ========== PROPERTY OWNER INFORMATION ==========
    draw_section_header(c, margin, y, content_w,
        "PROPERTY OWNER INFORMATION – Enter property owner information only; do not enter builder or agent information.")
    y -= 20

    # Name on Deed
    draw_label(c, margin + 10, y + 1, "Name(s) Shown on Deed:")
    draw_underline(c, margin + 135, y - 1, content_w - 145)
    draw_field_value(c, margin + 138, y + 1, "Revocable Trust of Subhash Sonnad")
    y -= 18

    # Mailing Address
    draw_label(c, margin + 10, y + 1, "Mailing Address:")
    draw_underline(c, margin + 100, y - 1, 310)
    draw_field_value(c, margin + 103, y + 1, "160 Still Forest Dr")
    draw_label(c, margin + 420, y + 1, "Apt/Unit/Ste #:")
    draw_underline(c, margin + 495, y - 1, 40)
    draw_field_value(c, margin + 498, y + 1, "N/A")
    y -= 18

    # City/State/Zip
    draw_label(c, margin + 10, y + 1, "City:")
    draw_underline(c, margin + 40, y - 1, 200)
    draw_field_value(c, margin + 43, y + 1, "Cedar Creek")
    draw_label(c, margin + 260, y + 1, "State:")
    draw_underline(c, margin + 290, y - 1, 50)
    draw_field_value(c, margin + 293, y + 1, "TX")
    draw_label(c, margin + 360, y + 1, "Zip:")
    draw_underline(c, margin + 385, y - 1, 80)
    draw_field_value(c, margin + 388, y + 1, "78612")
    y -= 18

    # Phone/Email
    draw_label(c, margin + 10, y + 1, "Daytime Phone #:")
    draw_underline(c, margin + 105, y - 1, 160)
    draw_field_value(c, margin + 108, y + 1, "+1 (424) 234-1750")
    draw_label(c, margin + 280, y + 1, "Email:")
    draw_underline(c, margin + 310, y - 1, 225)
    draw_field_value(c, margin + 313, y + 1, "rahulioson@gmail.com")

    y -= 24

    # ========== PROPERTY DESCRIPTION ==========
    draw_section_header(c, margin, y, content_w,
        "PROPERTY DESCRIPTION – Refer to Bastrop Central Appraisal District online property records at www.bastropcad.org or call 512-303-1930.")
    y -= 20

    # PID / Acres
    draw_label(c, margin + 10, y + 1, "Property ID Number(s): R")
    draw_underline(c, margin + 140, y - 1, 200)
    draw_field_value(c, margin + 143, y + 1, "44401")
    draw_label(c, margin + 360, y + 1, "Number of Acres:")
    draw_underline(c, margin + 445, y - 1, 90)
    draw_field_value(c, margin + 448, y + 1, "1.7348")
    y -= 18

    # Legal Description
    draw_label(c, margin + 10, y + 1, "Legal Description(s):")
    draw_underline(c, margin + 115, y - 1, content_w - 125)
    draw_field_value(c, margin + 118, y + 1, "Lot 14-B, Block 6, Blue Bonnet Acres Corrected Plat Section One, O.P.R.B.C.T.")
    y -= 22

    # Plat compliance
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "Does this property comply with local subdivision plat requirements or meet an exception to the plat requirements?")
    draw_radio(c, margin + 430, y - 1, selected=True)
    c.setFont("Helvetica", 8)
    c.drawString(margin + 442, y + 1, "Yes")
    draw_radio(c, margin + 475, y - 1, selected=False)
    c.drawString(margin + 487, y + 1, "No")

    y -= 24

    # ========== ENDANGERED SPECIES ACT ==========
    draw_section_header(c, margin, y, content_w,
        "ENDANGERED SPECIES ACT – Refer to the Bastrop County Lost Pines Habitat Conservation Plan Area map.")
    y -= 18
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "Is the property located in the Lost Pines Habitat Conservation Plan (LPHCP) area (e.g.: Houston toad habitat)?")
    draw_radio(c, margin + 430, y - 1, selected=False)
    c.setFont("Helvetica", 8)
    c.drawString(margin + 442, y + 1, "Yes")
    draw_radio(c, margin + 475, y - 1, selected=True)
    c.drawString(margin + 487, y + 1, "No")
    y -= 16
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "If yes, do you agree to participate in the LPHCP for incidental take authorization of the endangered Houston toad?")
    draw_radio(c, margin + 430, y - 1, selected=False)
    c.setFont("Helvetica", 8)
    c.drawString(margin + 442, y + 1, "Yes")
    draw_radio(c, margin + 475, y - 1, selected=False)
    c.drawString(margin + 487, y + 1, "No")
    draw_field_value(c, margin + 510, y + 1, "N/A")

    y -= 22

    # ========== FLOODPLAIN ==========
    draw_section_header(c, margin, y, content_w,
        "FLOODPLAIN/FLOODWAY – Refer to the FEMA flood map.")
    y -= 18
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "Is any part of the property within the Federal Emergency Management Agency (FEMA) 100-year floodplain?")
    draw_radio(c, margin + 430, y - 1, selected=False)
    c.setFont("Helvetica", 8)
    c.drawString(margin + 442, y + 1, "Yes")
    draw_radio(c, margin + 475, y - 1, selected=True)
    c.drawString(margin + 487, y + 1, "No")

    y -= 22

    # ========== DRIVEWAY ==========
    draw_section_header(c, margin, y, content_w, "DRIVEWAY")
    y -= 18
    c.setFont("Helvetica", 8)
    draw_radio(c, margin + 10, y - 1, selected=False)
    c.drawString(margin + 24, y + 1, "Gravel")
    draw_radio(c, margin + 75, y - 1, selected=False)
    c.drawString(margin + 89, y + 1, "Road Base")
    draw_radio(c, margin + 155, y - 1, selected=True)
    c.drawString(margin + 169, y + 1, "Asphalt")
    draw_radio(c, margin + 225, y - 1, selected=True)
    c.drawString(margin + 239, y + 1, "Concrete")
    draw_radio(c, margin + 305, y - 1, selected=False)
    c.drawString(margin + 319, y + 1, "Other")
    draw_underline(c, margin + 355, y - 1, 100)
    draw_field_value(c, margin + 358, y + 1, "Existing mixed surface")

    y -= 22

    # ========== WATER SOURCE ==========
    draw_section_header(c, margin, y, content_w, "WATER SOURCE")
    y -= 18
    draw_radio(c, margin + 10, y - 1, selected=True)
    c.setFont("Helvetica", 8)
    c.drawString(margin + 24, y + 1, "Private Water Well")
    draw_radio(c, margin + 155, y - 1, selected=False)
    c.drawString(margin + 169, y + 1, "Public Water System: Name:")
    draw_underline(c, margin + 325, y - 1, 210)
    draw_field_value(c, margin + 328, y + 1, "N/A")

    y -= 24

    # ========== DEVELOPMENT INFORMATION ==========
    draw_section_header(c, margin, y, content_w,
        "DEVELOPMENT INFORMATION – Provide the following information for each existing and proposed structure. Use additional sheets if necessary.")
    y -= 16

    # Existing buildings
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "List each existing building and indicate if it will be demolished/removed, and date:")
    y -= 14
    draw_underline(c, margin + 10, y, content_w - 20)
    draw_field_value(c, margin + 13, y + 2,
        "1) 2-Story Stone & Frame Residence (Main House) ~2,400 SF — Retain (owner-occupied + lodging)")
    y -= 13
    draw_underline(c, margin + 10, y, content_w - 20)
    draw_field_value(c, margin + 13, y + 2,
        "2) 1-Story Wood Building (Back House) — Retain (lodging)   3) Large Trailer 10'x42' — Retain (lodging)")
    y -= 13
    draw_underline(c, margin + 10, y, content_w - 20)
    draw_field_value(c, margin + 13, y + 2,
        "4) Small Trailer 7'5\"x20'5\" — Retain (lodging)   5) Bathroom Bldg 17'x17' — Retain (under construction, amenity)")
    y -= 13
    draw_underline(c, margin + 10, y, content_w - 20)
    draw_field_value(c, margin + 13, y + 2,
        "6) Deck 30'x24' — Retain (amenity)   7) Sauna 7'x7' — Retain (amenity)   8-10) 3 Shipping Containers 40'x8' — Retain (storage)")
    y -= 18

    # New/proposed
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "Enter the number of new/proposed structures:")
    draw_underline(c, margin + 235, y - 1, 30)
    draw_field_value(c, margin + 240, y + 1, "1")
    c.drawString(margin + 280, y + 1, "Provide the following information for each new/proposed structure:")
    y -= 16

    # Classification
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "Classification:")
    draw_radio(c, margin + 85, y - 1, selected=False)
    c.drawString(margin + 97, y + 1, "Single Family Residential")
    c.setFont("Helvetica-Oblique", 6.5)
    c.drawString(margin + 215, y + 1, "select one")
    c.setFont("Helvetica", 7.5)
    draw_radio(c, margin + 260, y - 1, selected=False)
    c.drawString(margin + 272, y + 1, "Main")
    draw_radio(c, margin + 305, y - 1, selected=False)
    c.drawString(margin + 317, y + 1, "Guest/Secondary")
    draw_radio(c, margin + 400, y - 1, selected=False)
    c.drawString(margin + 412, y + 1, "Duplex")
    draw_radio(c, margin + 455, y - 1, selected=False)
    c.drawString(margin + 467, y + 1, "Accessory Building")
    y -= 16

    draw_radio(c, margin + 85, y - 1, selected=True)
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 97, y + 1, "Non-Single-Family Residential")
    c.setFont("Helvetica-Oblique", 6.5)
    c.drawString(margin + 240, y + 1, "select one")
    c.setFont("Helvetica", 7.5)
    draw_radio(c, margin + 280, y - 1, selected=False)
    c.drawString(margin + 292, y + 1, "Multi-Family")
    draw_radio(c, margin + 365, y - 1, selected=True)
    c.drawString(margin + 377, y + 1, "Single-Unit Commercial")
    draw_radio(c, margin + 480, y - 1, selected=False)
    c.drawString(margin + 492, y + 1, "Multi-Unit")
    y -= 16

    # Commercial details
    c.setFont("Helvetica", 7.5)
    c.drawString(margin + 10, y + 1, "Commercial:")
    c.drawString(margin + 80, y + 1, "Building Sq ft:")
    draw_underline(c, margin + 150, y - 1, 70)
    draw_field_value(c, margin + 153, y + 1, "~3,700")
    c.drawString(margin + 240, y + 1, "Impervious:")
    draw_underline(c, margin + 300, y - 1, 80)
    draw_field_value(c, margin + 303, y + 1, "TBD by PE")
    c.drawString(margin + 400, y + 1, "Pervious:")
    draw_underline(c, margin + 445, y - 1, 90)
    draw_field_value(c, margin + 448, y + 1, "TBD by PE")
    y -= 16

    # Construction type
    c.drawString(margin + 10, y + 1, "Construction:")
    draw_radio(c, margin + 85, y - 1, selected=True)
    c.drawString(margin + 97, y + 1, "Site-Built")
    draw_radio(c, margin + 160, y - 1, selected=True)
    c.drawString(margin + 172, y + 1, "Mobile/Pre-manufactured")
    draw_radio(c, margin + 310, y - 1, selected=True)
    c.drawString(margin + 322, y + 1, "RV/Travel Trailer")
    draw_radio(c, margin + 420, y - 1, selected=False)
    c.drawString(margin + 432, y + 1, "Other:")
    draw_underline(c, margin + 463, y - 1, 72)
    draw_field_value(c, margin + 466, y + 1, "Mixed types")
    y -= 16

    # Foundation
    c.drawString(margin + 10, y + 1, "Foundation:")
    draw_radio(c, margin + 85, y - 1, selected=True)
    c.drawString(margin + 97, y + 1, "Slab")
    draw_radio(c, margin + 140, y - 1, selected=True)
    c.drawString(margin + 152, y + 1, "Pier and Beam")
    draw_radio(c, margin + 240, y - 1, selected=False)
    c.drawString(margin + 252, y + 1, "Road Base")
    draw_radio(c, margin + 315, y - 1, selected=False)
    c.drawString(margin + 327, y + 1, "Other:")
    draw_underline(c, margin + 358, y - 1, 100)
    draw_field_value(c, margin + 361, y + 1, "Trailer axles/blocks")
    y -= 16

    # Dimensions
    c.drawString(margin + 10, y + 1, "Dimensions:")
    c.drawString(margin + 78, y + 1, "Occupied Square Footage (heat/cool):")
    draw_underline(c, margin + 265, y - 1, 70)
    draw_field_value(c, margin + 268, y + 1, "~3,200")
    c.drawString(margin + 355, y + 1, "Total Square Footage:")
    draw_underline(c, margin + 460, y - 1, 75)
    draw_field_value(c, margin + 463, y + 1, "~5,000")
    y -= 16

    # Bathrooms/Bedrooms
    c.drawString(margin + 78, y + 1, "Bathrooms:")
    draw_underline(c, margin + 138, y - 1, 50)
    draw_field_value(c, margin + 141, y + 1, "5")
    c.drawString(margin + 205, y + 1, "Bedrooms:")
    draw_underline(c, margin + 260, y - 1, 50)
    draw_field_value(c, margin + 263, y + 1, "7")
    c.drawString(margin + 325, y + 1, "Number of Floors/Subfloors:")
    draw_underline(c, margin + 460, y - 1, 30)
    draw_field_value(c, margin + 463, y + 1, "2")
    c.drawString(margin + 500, y + 1, "Kitchens:")
    draw_underline(c, margin + 540, y - 1, 0)
    y -= 2
    draw_underline(c, margin + 10, y - 1, 20)
    draw_field_value(c, margin + 3, y + 1, "2")
    y -= 14

    # Contractor
    c.drawString(margin + 10, y + 1, "Contractor:")
    draw_underline(c, margin + 78, y - 1, content_w - 88)
    draw_field_value(c, margin + 81, y + 1, "Owner (self-performed improvements) — Licensed professionals for septic, electrical, and PE-stamped plans")
    y -= 16

    c.drawString(margin + 10, y + 1, "Daytime Phone #:")
    draw_underline(c, margin + 105, y - 1, 160)
    draw_field_value(c, margin + 108, y + 1, "+1 (424) 234-1750")
    c.drawString(margin + 280, y + 1, "Email:")
    draw_underline(c, margin + 310, y - 1, 225)
    draw_field_value(c, margin + 313, y + 1, "rahulioson@gmail.com")

    y -= 24

    # ========== ACKNOWLEDGEMENT ==========
    draw_section_header(c, margin, y, content_w, "ACKNOWLEDGEMENT – Read and acknowledge")
    y -= 12
    c.setFont("Helvetica", 6)
    ack_text = (
        "I certify that all information, statements, and documents provided are true and correct to the best of my knowledge. "
        "I understand that permit(s) may be revoked by Bastrop County, its duly appointed agents, representatives, and staff "
        "(\"the County\") at their discretion. Should development/plans be altered, I agree to submit a revised application, "
        "pay any additional fees, and immediately cease development until further notice by the County. I acknowledge that the "
        "submittal of this application and any subsequent permit(s)/correspondence(s) does not create liability on the part of "
        "the County; in addition, I agree to hold the County harmless against any actions for resulting personal injury or "
        "property damage. I hereby grant the County access to the identified property for site, development, and compliance inspections."
    )
    # Wrap the text
    from reportlab.lib.utils import simpleSplit
    lines = simpleSplit(ack_text, "Helvetica", 6, content_w - 20)
    for line in lines:
        c.drawString(margin + 10, y, line)
        y -= 8

    y -= 6

    # Signature line
    c.setFont("Helvetica", 8)
    c.drawString(margin + 10, y + 1, "Signature:")
    draw_underline(c, margin + 68, y - 1, 220)
    c.drawString(margin + 310, y + 1, "Date:")
    draw_underline(c, margin + 340, y - 1, 100)
    draw_field_value(c, margin + 343, y + 1, "[SIGN & DATE — Rahul Sonnad, Trustee]")
    y -= 16

    c.drawString(margin + 10, y + 1, "Print Name:")
    draw_underline(c, margin + 75, y - 1, 215)
    draw_field_value(c, margin + 78, y + 1, "Rahul Sonnad, Trustee — Revocable Trust of Subhash Sonnad")
    draw_radio(c, margin + 310, y - 1, selected=True)
    c.drawString(margin + 324, y + 1, "Owner")
    draw_radio(c, margin + 370, y - 1, selected=False)
    c.drawString(margin + 384, y + 1, "Owner's Agent (Owner's written approval required.)")

    # Footer
    y -= 16
    c.setFont("Helvetica", 6)
    c.setFillColor(DARK_GRAY)
    c.drawString(margin, y, "Development Application-Rev. Dec, 03, 2025")
    c.setFillColor(black)


def build_page2(c):
    """Build page 2 — additional existing structures detail (attachment sheet)."""
    margin = 36
    rmargin = W - margin
    content_w = rmargin - margin

    y = H - 40

    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W/2, y, "ATTACHMENT: EXISTING & PROPOSED STRUCTURES DETAIL")
    y -= 14
    c.setFont("Helvetica", 8)
    c.setFillColor(DARK_GRAY)
    c.drawCentredString(W/2, y, "160 Still Forest Drive, Cedar Creek, TX 78612  |  PID R44401  |  1.7348 Acres")
    c.setFillColor(black)
    y -= 6
    c.setStrokeColor(black)
    c.setLineWidth(1)
    c.line(margin, y, rmargin, y)

    y -= 20

    # Table of structures
    structures = [
        ["#", "Structure", "Size", "Proposed Use", "Capacity", "Construction", "Foundation"],
        ["1", "2-Story Stone & Frame\nResidence (Main House)", "~2,400 SF", "Owner-occupied (1 BR)\n+ Lodging (2 guest BR)", "Up to 4\nguests", "Site-Built", "Slab"],
        ["2", "1-Story Wood Building\n(Back House)", "Per survey", "Lodging\n(2 guest bedrooms)", "Up to 2\nguests", "Site-Built", "Pier & Beam"],
        ["3", "Large Trailer", "10' x 42'\n(420 SF)", "Lodging\n(studio rental unit)", "Up to 2\nguests", "Mobile/Pre-\nmanufactured", "Trailer axles"],
        ["4", "Small Trailer", "7'5\" x 20'5\"\n(~153 SF)", "Lodging\n(1-BR rental unit)", "Up to 1\nguest", "RV/Travel\nTrailer", "Blocks"],
        ["5", "Bathroom Building\n(under construction)", "17' x 17'\n(289 SF)", "Amenity — shared guest\nbathroom (2 toilets +\nshower, 1st fl); storage\n(2nd fl)", "—", "Site-Built", "Pier & Beam"],
        ["6", "Deck", "30' x 24'\n(720 SF)", "Amenity — outdoor\nguest recreation", "—", "Site-Built", "Pier & Beam"],
        ["7", "Sauna", "7' x 7'\n(49 SF)", "Amenity —\nguest wellness", "—", "Site-Built", "Slab"],
        ["8", "Shipping Container #1\n(west side)", "40' x 8'\n(320 SF)", "Storage\n(non-habitable)", "—", "Pre-mfg\n(steel)", "Road base"],
        ["9", "Shipping Container #2\n(front right)", "40' x 8'\n(320 SF)", "Storage\n(non-habitable)", "—", "Pre-mfg\n(steel)", "Road base"],
        ["10", "Shipping Container #3\n(front left)", "40' x 8'\n(320 SF)", "Storage\n(non-habitable)", "—", "Pre-mfg\n(steel)", "Road base"],
    ]

    col_widths = [22, 120, 60, 130, 50, 70, 65]
    header_height = 16
    row_heights = [header_height, 28, 28, 28, 28, 48, 28, 28, 28, 28, 28]

    # Draw header
    x = margin + 5
    c.setFillColor(GRAY_BG)
    c.rect(margin, y - header_height + 3, content_w, header_height, stroke=0, fill=1)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 7)
    for j, header in enumerate(structures[0]):
        c.drawString(x + 2, y - 10, header)
        x += col_widths[j]

    # Horizontal line under header
    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.line(margin, y - header_height + 3, rmargin, y - header_height + 3)

    y -= header_height + 1

    # Draw rows
    c.setFont("Helvetica", 6.5)
    for i in range(1, len(structures)):
        row = structures[i]
        rh = row_heights[i]
        x = margin + 5

        # Alternate row shading
        if i % 2 == 0:
            c.setFillColor(LIGHT_GRAY)
            c.rect(margin, y - rh + 3, content_w, rh, stroke=0, fill=1)
            c.setFillColor(black)

        for j, cell in enumerate(row):
            lines = cell.split("\n")
            for k, line in enumerate(lines):
                c.drawString(x + 2, y - 8 - k * 8, line)
            x += col_widths[j]

        # Row separator
        c.setStrokeColor(HexColor("#CCCCCC"))
        c.setLineWidth(0.3)
        c.line(margin, y - rh + 3, rmargin, y - rh + 3)

        y -= rh

    # Vertical lines for columns
    c.setStrokeColor(HexColor("#CCCCCC"))
    c.setLineWidth(0.3)
    col_x = margin
    table_top = H - 80
    table_bottom = y + 3
    for cw in col_widths:
        col_x += cw + 5
        # skip drawing at the end
        if col_x < rmargin - 5:
            pass  # Keep it clean without vertical lines

    y -= 14

    # Summary section
    c.setFont("Helvetica-Bold", 9)
    c.drawString(margin + 5, y, "DEVELOPMENT SUMMARY")
    y -= 4
    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.line(margin, y, rmargin, y)
    y -= 14

    summary_items = [
        ("Total rental/lodging units:", "4 structures (Main House guest rooms, Back House, Large Trailer, Small Trailer)"),
        ("Total guest bedrooms + studio:", "7 rentable rooms across 4 structures"),
        ("Maximum simultaneous occupancy:", "9 guests + 1 owner (on-site) = 10 persons"),
        ("Owner-occupied:", "1 bedroom in Main House (on-site management at all times)"),
        ("New construction:", "1 — Fire suppression water tank (2,500 gal, non-metallic)"),
        ("Bathroom Building note:", "Under construction — commenced prior to permit; will bring into compliance per IDP"),
        ("Planned improvements:", "Complete bathroom bldg 2nd floor (storage only), install fire tank, parking improvements"),
        ("Total building sq ft (all structures):", "~5,000 SF (incl. ~3,200 SF heated/cooled)"),
        ("Emergency Service District:", "BCESD #3"),
        ("Flood Zone:", "Zone X (unshaded) — NOT in 100-year floodplain"),
        ("Houston Toad / LPHCP:", "NOT in Lost Pines Habitat Conservation Plan area"),
        ("Road access:", "Still Forest Drive (CR 329) — 60' ROW, county-maintained"),
        ("Septic:", "Existing aerobic system (JET INC) — commercial OSSF evaluation pending"),
        ("Water:", "Private water well — availability letter pending"),
    ]

    c.setFont("Helvetica", 7)
    for label, value in summary_items:
        c.setFont("Helvetica-Bold", 7)
        c.drawString(margin + 10, y, label)
        lw = c.stringWidth(label, "Helvetica-Bold", 7)
        c.setFont("Helvetica", 7)
        c.setFillColor(BLUE_INK)
        c.drawString(margin + 14 + lw, y, value)
        c.setFillColor(black)
        y -= 12

    y -= 8
    c.setFont("Helvetica-Bold", 8)
    c.drawString(margin + 5, y, "ATTACHMENTS INCLUDED WITH THIS APPLICATION:")
    y -= 14
    attachments = [
        "1. Deed — Revocable Trust of Subhash Sonnad — Proof of Ownership",
        "2. Survey / Plat — 4Ward Land Surveying (Feb 4, 2021), Jason Ward R.P.L.S. #5811",
        "3. Preliminary Site Plan (draft — PE-stamped version to follow)",
        "4. Development Description (IDP narrative — structures, utilities, infrastructure, timeline)",
        "5. Operator Information (Rahul Sonnad, Trustee — Revocable Trust of Subhash Sonnad)",
        "6. OSSF Permit Application + Septic Plan (pending — licensed septic designer)",
        "7. Drainage Study (pending — civil engineer)",
        "8. PE-Signed/Sealed Site Plan (pending — civil engineer)",
        "9. Water Availability Letter (pending)",
        "10. Electric Availability Letter (pending)",
        "11. ESD Compliance Letter — BCESD #3 (pending)",
    ]
    c.setFont("Helvetica", 7)
    for att in attachments:
        c.drawString(margin + 15, y, att)
        y -= 11

    # Footer
    y -= 10
    c.setFont("Helvetica", 6)
    c.setFillColor(DARK_GRAY)
    c.drawCentredString(W/2, y, "This attachment is supplemental to the Bastrop County Development Services Application (Rev. Dec 03, 2025)")
    c.setFillColor(black)


def main():
    c = canvas.Canvas(OUTPUT, pagesize=letter)
    c.setTitle("Bastrop County Development Application — 160 Still Forest Dr")
    c.setAuthor("Rahul Sonnad, Trustee — Revocable Trust of Subhash Sonnad")
    c.setSubject("IDP Lodging Development — 160 Still Forest Dr, Cedar Creek TX 78612")

    # Page 1 — Main Application Form
    build_page1(c)
    c.showPage()

    # Page 2 — Structures Detail Attachment
    build_page2(c)
    c.showPage()

    c.save()
    print(f"Generated: {OUTPUT}")


if __name__ == "__main__":
    main()
