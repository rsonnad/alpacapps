#!/usr/bin/env python3
"""Generate car rental contract PDF for Juston Brommel — March 2026 renewal.

Styled to match the Alpaca Playhouse email brand:
  - Dark header (#1c1618) with white text
  - Orange accent (#d4883a)
  - Warm muted backgrounds (#f2f0e8)
  - DM Sans-inspired clean layout
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, Flowable
)
from reportlab.lib.colors import HexColor, black, white, Color
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics import renderPDF
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "juston-brommel-car-rental-2026.pdf")

# Brand palette (matches email template)
BRAND_DARK = HexColor("#1c1618")
BRAND_BG = HexColor("#faf9f6")
BRAND_MUTED = HexColor("#f2f0e8")
BRAND_ACCENT = HexColor("#d4883a")
BRAND_ACCENT_HOVER = HexColor("#be7830")
BRAND_TEXT = HexColor("#2a1f23")
BRAND_TEXT_MUTED = HexColor("#7d6f74")
BRAND_BORDER = HexColor("#e6e2d9")
BRAND_SUCCESS = HexColor("#54a326")
BRAND_ERROR = HexColor("#8f3d4b")


class BrandHeader(Flowable):
    """Full-width dark header with brand name and document title."""

    def __init__(self, width, title="CAR RENTAL AGREEMENT", subtitle="Alpaca Playhouse"):
        super().__init__()
        self.width = width
        self.height = 80
        self.title = title
        self.subtitle = subtitle

    def draw(self):
        # Dark background
        self.canv.setFillColor(BRAND_DARK)
        self.canv.roundRect(0, 0, self.width, self.height, 8, fill=1, stroke=0)

        # Brand name
        self.canv.setFillColor(white)
        self.canv.setFont("Helvetica-Bold", 20)
        self.canv.drawCentredString(self.width / 2, 48, self.subtitle)

        # Document title
        self.canv.setFillColor(HexColor("#c0b0a0"))
        self.canv.setFont("Helvetica", 11)
        self.canv.drawCentredString(self.width / 2, 20, self.title)


class AccentBox(Flowable):
    """Colored callout box with rounded corners — like the payment cards in the email."""

    def __init__(self, width, content_paragraphs, bg_color=None, border_color=None, padding=12):
        super().__init__()
        self.width = width
        self.content_paragraphs = content_paragraphs  # list of (text, style) tuples
        self.bg_color = bg_color or BRAND_MUTED
        self.border_color = border_color or BRAND_BORDER
        self.padding = padding
        # Calculate height
        self._calc_height()

    def _calc_height(self):
        total = self.padding * 2
        for text, style in self.content_paragraphs:
            p = Paragraph(text, style)
            w, h = p.wrap(self.width - self.padding * 2, 1000)
            total += h + 2
        self.height = total

    def draw(self):
        # Background
        self.canv.setFillColor(self.bg_color)
        self.canv.setStrokeColor(self.border_color)
        self.canv.setLineWidth(1)
        self.canv.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=1)

        # Content
        y = self.height - self.padding
        for text, style in self.content_paragraphs:
            p = Paragraph(text, style)
            w, h = p.wrap(self.width - self.padding * 2, 1000)
            y -= h
            p.drawOn(self.canv, self.padding, y)
            y -= 2


class AccentDivider(Flowable):
    """A thin accent-colored horizontal rule."""

    def __init__(self, width, color=None, thickness=2):
        super().__init__()
        self.width = width
        self.height = thickness + 8
        self.color = color or BRAND_ACCENT
        self.thickness = thickness

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 4, self.width, 4)


def build_styles():
    styles = getSampleStyleSheet()
    available_width = letter[0] - 2 * inch  # for reference

    styles.add(ParagraphStyle(
        name='BrandTitle',
        parent=styles['Title'],
        fontSize=22,
        leading=26,
        textColor=BRAND_DARK,
        alignment=TA_CENTER,
        spaceAfter=2,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='BrandSubtitle',
        parent=styles['Normal'],
        fontSize=10,
        leading=13,
        textColor=BRAND_TEXT_MUTED,
        alignment=TA_CENTER,
        spaceAfter=16,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='SectionHead',
        parent=styles['Heading2'],
        fontSize=13,
        leading=16,
        textColor=BRAND_ACCENT,
        spaceBefore=18,
        spaceAfter=6,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='SubHead',
        parent=styles['Normal'],
        fontSize=11,
        leading=14,
        textColor=BRAND_DARK,
        spaceBefore=10,
        spaceAfter=4,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='Body',
        parent=styles['Normal'],
        fontSize=10,
        leading=15,
        textColor=BRAND_TEXT,
        alignment=TA_JUSTIFY,
        spaceAfter=6,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='BodyLeft',
        parent=styles['Normal'],
        fontSize=10,
        leading=15,
        textColor=BRAND_TEXT,
        alignment=TA_LEFT,
        spaceAfter=6,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='BodyBold',
        parent=styles['Normal'],
        fontSize=10,
        leading=15,
        textColor=BRAND_TEXT,
        alignment=TA_LEFT,
        spaceAfter=4,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='BulletCustom',
        parent=styles['Normal'],
        fontSize=10,
        leading=15,
        textColor=BRAND_TEXT,
        leftIndent=20,
        spaceAfter=3,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='SmallNote',
        parent=styles['Normal'],
        fontSize=9,
        leading=12,
        textColor=BRAND_TEXT_MUTED,
        spaceAfter=4,
        fontName='Helvetica-Oblique',
    ))
    styles.add(ParagraphStyle(
        name='CalloutText',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
        textColor=BRAND_TEXT,
        alignment=TA_LEFT,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='CalloutBold',
        parent=styles['Normal'],
        fontSize=11,
        leading=15,
        textColor=BRAND_DARK,
        alignment=TA_LEFT,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='FooterText',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=BRAND_TEXT_MUTED,
        alignment=TA_CENTER,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='SignLine',
        parent=styles['Normal'],
        fontSize=10,
        leading=20,
        textColor=BRAND_TEXT,
        fontName='Helvetica',
    ))
    return styles


def accent_hr():
    """Thin accent-colored divider."""
    return AccentDivider(letter[0] - 2 * inch)


def subtle_hr():
    """Subtle grey divider."""
    return HRFlowable(width="100%", thickness=0.5, color=BRAND_BORDER, spaceAfter=8, spaceBefore=6)


def build_contract():
    styles = build_styles()
    story = []
    content_width = letter[0] - 2 * inch

    # ── BRANDED HEADER ──
    story.append(BrandHeader(content_width))
    story.append(Spacer(1, 16))

    # ── Address line ──
    story.append(Paragraph(
        "160 Still Forest Drive, Cedar Creek, TX 78612",
        styles['BrandSubtitle']
    ))

    story.append(subtle_hr())

    # ── INTRO ──
    story.append(Paragraph(
        'This Car Rental Agreement ("Agreement") is made and entered into as of '
        '<b>March 1, 2026</b> between:', styles['Body']
    ))
    story.append(Spacer(1, 4))

    # Parties in callout boxes
    owner_box = AccentBox(content_width, [
        ('<b>Rahul Sonnad</b> — Owner', styles['CalloutBold']),
        ('160 Still Forest Drive, Cedar Creek, Texas', styles['CalloutText']),
        ('Email: rahulioson@gmail.com &bull; Phone: (424) 234-1750', styles['CalloutText']),
    ], bg_color=BRAND_MUTED, border_color=BRAND_BORDER)
    story.append(owner_box)
    story.append(Spacer(1, 6))

    story.append(Paragraph('and', ParagraphStyle('and', parent=styles['Body'], alignment=TA_CENTER)))
    story.append(Spacer(1, 4))

    renter_box = AccentBox(content_width, [
        ('<b>Juston Brommel</b> — Renter', styles['CalloutBold']),
        ('Email: j@brommel.com &bull; Phone: (415) 812-2524', styles['CalloutText']),
    ], bg_color=BRAND_MUTED, border_color=BRAND_BORDER)
    story.append(renter_box)
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        'Owner and Renter may also be referred to as "Party" in the singular and "Parties" in the plural. '
        'This Agreement is subject to the following terms and conditions:',
        styles['Body']
    ))

    # ── RENTAL VEHICLE ──
    story.append(Paragraph("1. Rental Vehicle", styles['SectionHead']))
    story.append(Paragraph(
        "Owner hereby agrees to rent to Renter the following vehicle (\"Vehicle\"):",
        styles['Body']
    ))

    vehicle_data = [
        ["Make", "Tesla"],
        ["Model", "Model 3"],
        ["Year", "2022"],
        ["Color", "White"],
        ["VIN", "5YJ3E1EB0NF189739"],
        ["Mileage", "106,225"],
    ]
    t = Table(vehicle_data, colWidths=[1.8 * inch, 4.0 * inch])
    t.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (0, -1), BRAND_DARK),
        ('TEXTCOLOR', (1, 0), (1, -1), BRAND_TEXT),
        ('BACKGROUND', (0, 0), (0, -1), BRAND_MUTED),
        ('BACKGROUND', (1, 0), (1, -1), white),
        ('GRID', (0, 0), (-1, -1), 0.5, BRAND_BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(t)
    story.append(Spacer(1, 8))

    # ── RENTAL PERIOD ──
    story.append(Paragraph("2. Rental Period", styles['SectionHead']))
    story.append(Paragraph(
        "<b>Start Date:</b> March 1, 2026", styles['Body']
    ))
    story.append(Paragraph(
        "This Agreement shall continue on a <b>month-to-month basis</b>, automatically renewing "
        "on the 1st of each calendar month.",
        styles['Body']
    ))
    story.append(Paragraph(
        "Either Party may terminate this Agreement by providing <b>thirty (30) days' written notice</b> "
        "to the other Party via email. Upon proper notice, the Agreement will terminate at the end of "
        "the next full calendar month following receipt of the notice.",
        styles['Body']
    ))

    # ── RENTAL RATE ──
    story.append(Paragraph("3. Rental Rate &amp; Payment", styles['SectionHead']))

    # Rate highlight box — like the orange accent in the email
    rate_box = AccentBox(content_width, [
        ('Monthly Rate: <b>$295/month</b>', styles['CalloutBold']),
        ('Payment via Zelle to <b>alpacaplayhouse@gmail.com</b>', styles['CalloutText']),
    ], bg_color=HexColor("#fdf8f0"), border_color=BRAND_ACCENT, padding=14)
    story.append(rate_box)
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        "Rent is due on the <b>1st of each month</b>.",
        styles['BodyLeft']
    ))
    story.append(Paragraph(
        "Rental rate does not include Full Self-Driving (FSD) subscription, which can optionally "
        "be purchased by the Renter at their own expense.",
        styles['Body']
    ))

    # ── SECURITY DEPOSIT ──
    story.append(Paragraph("4. Security Deposit", styles['SectionHead']))
    story.append(Paragraph(
        "A security deposit of <b>$300</b> is held by the Owner from the prior rental agreement and "
        "shall carry over to this Agreement under the same terms. Owner shall retain this deposit to be used, "
        "in the event of loss of or damage to the Vehicle after the term of this Agreement, to defray fully "
        "or partially the cost of necessary repairs or replacement not covered by insurance. In the "
        "absence of damage, loss, or other relevant unpaid fees, said deposit "
        "shall be returned to the Renter upon termination of this Agreement.",
        styles['Body']
    ))

    # ── INSURANCE ──
    story.append(Paragraph("5. Insurance", styles['SectionHead']))
    story.append(Paragraph(
        "Insurance is at cost, either by Tesla Insurance or a provider of Renter's choice. "
        "Renter <b>must</b> insure the Vehicle and list <b>Rahul Sonnad</b> as owner/beneficiary on the policy.",
        styles['Body']
    ))

    # ── MILEAGE ──
    story.append(Paragraph("6. Mileage", styles['SectionHead']))
    story.append(Paragraph(
        "Renter may drive anywhere local in the greater Austin area with no additional charges. "
        "For long-distance road trips exceeding an average of <b>1,000 miles per month</b>, an overage "
        "charge of <b>$0.15 per mile</b> will apply.",
        styles['Body']
    ))

    # ── TOLLS ──
    story.append(Paragraph("7. Tolls", styles['SectionHead']))
    story.append(Paragraph(
        "Renter may use toll roads. Toll charges will be billed at cost and deducted from the security deposit "
        "or invoiced separately.",
        styles['Body']
    ))

    # ── FUEL / CHARGING ──
    story.append(Paragraph("8. Fuel &amp; Charging", styles['SectionHead']))
    story.append(Paragraph(
        "\u2022 Renter may charge the Vehicle at the property at no additional fee.", styles['BulletCustom']
    ))
    story.append(Paragraph(
        "\u2022 Supercharger costs will be billed at cost. Renter should switch billing to their own card.",
        styles['BulletCustom']
    ))

    # ── ADDITIONAL TESLA SERVICES ──
    story.append(Paragraph("9. Additional Tesla Services", styles['SectionHead']))
    story.append(Paragraph(
        "Renter will be responsible for any additional services purchased through the Tesla app, "
        "such as Full Self-Driving (FSD) at $99/month.",
        styles['Body']
    ))

    # ── ACCIDENTS ──
    story.append(Paragraph("10. Accidents &amp; Liability", styles['SectionHead']))
    story.append(Paragraph(
        "Renter is liable for all insurance deductibles up to <b>$500</b>, as well as any damages to either "
        "vehicle not covered by insurance, and loss of use not covered by insurance. Renter may optionally "
        "change the insurance policy to a lower deductible and pay the additional premium.",
        styles['Body']
    ))

    # ── LATE RETURNS ──
    story.append(Paragraph("11. Late Returns", styles['SectionHead']))
    story.append(Paragraph(
        "A late fee of <b>$20 per hour</b> will apply unless alternative arrangements are agreed upon in advance.",
        styles['Body']
    ))

    # ── EXISTING DAMAGE ──
    story.append(Paragraph("12. Existing Damage to Vehicle", styles['SectionHead']))
    story.append(Paragraph(
        "The Parties acknowledge the following existing damage to the Vehicle:",
        styles['Body']
    ))
    story.append(Paragraph("\u2022 Possible scrape on passenger back floor side", styles['BulletCustom']))
    story.append(Paragraph("\u2022 Bottom right passenger side red markings", styles['BulletCustom']))
    story.append(Paragraph("\u2022 Back bumper red scraping", styles['BulletCustom']))

    # ── CLEANING ──
    story.append(Paragraph("13. Cleaning", styles['SectionHead']))
    story.append(Paragraph(
        "Renter will return the car in a clean state similar to that received, and remove any pet hairs or odors. "
        "If this is not completed by the Renter, the cost of professional cleaning will be charged to the Renter.",
        styles['Body']
    ))
    story.append(Paragraph(
        "Note: The Renter need not clean the outside of the Vehicle upon return \u2014 only the interior.",
        styles['SmallNote']
    ))

    # ── DRIVER'S LICENSE ──
    story.append(Paragraph("14. Driver's License", styles['SectionHead']))
    story.append(Paragraph(
        "Renter's driver's license is already on file with the Owner.",
        styles['Body']
    ))

    # ── PAGE BREAK for legal sections ──
    story.append(PageBreak())

    # Page 2 mini header
    story.append(Paragraph(
        '<font color="#d4883a"><b>Alpaca Playhouse</b></font> — Car Rental Agreement (continued)',
        styles['SmallNote']
    ))
    story.append(subtle_hr())

    # ── INDEMNITY ──
    story.append(Paragraph("15. Indemnity", styles['SectionHead']))
    story.append(Paragraph(
        "Regardless of insurance coverage, Renter shall fully indemnify the Owner for any loss, damage, "
        "and legal actions, including reasonable attorneys' fees that Owner suffers due to Renter's use of "
        "Vehicle during the term of this Agreement, including but not limited to damage to the Vehicle, "
        "damage to the property of others, injury to Renter, and injury to others. This provision survives "
        "the termination of this Agreement.",
        styles['Body']
    ))

    # ── OWNER WARRANTY ──
    story.append(Paragraph("16. Owner Warranty", styles['SectionHead']))
    story.append(Paragraph(
        "The Owner represents that to the best of his knowledge and belief the Vehicle is in sound and safe "
        "condition and free of any known faults or defects that would affect its safe operation under normal use.",
        styles['Body']
    ))

    # ── RENTER WARRANTIES ──
    story.append(Paragraph("17. Renter Warranties", styles['SectionHead']))
    story.append(Paragraph("The Renter agrees that Renter will not:", styles['Body']))
    story.append(Paragraph(
        "\u2022 Use the Vehicle to carry any passengers other than Renter", styles['BulletCustom']
    ))
    story.append(Paragraph(
        "\u2022 Allow any other person to operate the Vehicle", styles['BulletCustom']
    ))
    story.append(Paragraph(
        "\u2022 Operate the Vehicle in violation of any laws or for an illegal purpose; if Renter does, "
        "Renter is responsible for all associated tickets, fines, and fees", styles['BulletCustom']
    ))
    story.append(Paragraph(
        "\u2022 Use the Vehicle to push or tow another vehicle", styles['BulletCustom']
    ))
    story.append(Paragraph(
        "\u2022 Use the Vehicle for any race or competition", styles['BulletCustom']
    ))
    story.append(Paragraph(
        "\u2022 Operate the Vehicle in a negligent manner", styles['BulletCustom']
    ))

    # ── ARBITRATION ──
    story.append(Paragraph("18. Arbitration", styles['SectionHead']))
    story.append(Paragraph(
        "In the event that the Parties cannot amicably resolve a dispute or damage claim resulting from "
        "this Agreement, the Parties agree to resolve any such dispute or damage claim by arbitration. "
        "The arbitration proceeding shall be conducted in Austin, Texas, in accordance with the rules of "
        "the American Arbitration Association then in effect with one (1) arbitrator to be selected by "
        "mutual agreement of the Parties. If the Parties cannot agree on an arbitrator, then the American "
        "Arbitration Association shall select an arbitrator from the National Panel of Arbitrators. The laws "
        "of the State of Texas shall apply to the arbitration proceedings. The Parties agree that the "
        "arbitrator cannot award punitive damages to either Party and agree to be bound by the arbitrator's "
        "findings. Judgment upon the award rendered by the arbitrator may be entered in any court having "
        "jurisdiction.",
        styles['Body']
    ))

    # ── GOVERNING LAW ──
    story.append(Paragraph("19. Disputes &amp; Governing Law", styles['SectionHead']))
    story.append(Paragraph(
        "The laws of the State of Texas without regard to any conflict of law principles govern this "
        "Agreement. No action arising out of the transactions under this Agreement may be brought by "
        "either Party more than one year after the cause of action has accrued.",
        styles['Body']
    ))

    # ── GENERAL ──
    story.append(Paragraph("20. General Provisions", styles['SectionHead']))
    story.append(Paragraph(
        "This Agreement constitutes the entire agreement between the Parties in connection with the subject "
        "matter hereof and supersedes all prior agreements, proposals, representations, and other "
        "understandings, oral or written, including the prior Car Rental Agreement dated May 21, 2025. "
        "No alteration or modification of this Agreement shall be valid "
        "unless made in writing and signed by both Parties. The waiver by either Party of a breach of any "
        "provision shall not operate or be construed as a waiver of any subsequent breach. If any provision "
        "of this Agreement is held to be invalid or unenforceable, the remaining provisions shall continue "
        "in full force and effect. Any notice or communication required hereunder shall be given in writing "
        "to the other Party. Any terms of this Agreement which by their nature extend beyond its termination "
        "remain in effect until fulfilled.",
        styles['Body']
    ))

    # ── SIGNATURES ──
    story.append(Spacer(1, 16))
    story.append(accent_hr())
    story.append(Spacer(1, 4))
    story.append(Paragraph("SIGNATURES", styles['SectionHead']))
    story.append(Paragraph(
        "IN WITNESS WHEREOF, the Parties have signed this Agreement as of the day and year first above written.",
        styles['Body']
    ))
    story.append(Spacer(1, 16))

    # Signature table — styled
    sig_data = [
        ["ACCEPTED BY RENTER", "", "ACCEPTED BY OWNER"],
        ["", "", ""],
        ["Signature: _________________________", "", "Signature: _________________________"],
        ["", "", ""],
        ["Name: Juston Brommel", "", "Name: Rahul Sonnad"],
        ["", "", ""],
        ["Address: _________________________", "", "Address: 160 Still Forest Drive"],
        ["", "", "Cedar Creek, TX 78612"],
        ["", "", ""],
        ["Date: _________________________", "", "Date: _________________________"],
    ]
    sig_table = Table(sig_data, colWidths=[2.8 * inch, 0.4 * inch, 2.8 * inch])
    sig_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, 0), BRAND_ACCENT),
        ('TEXTCOLOR', (0, 1), (-1, -1), BRAND_TEXT),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(sig_table)

    # ── FOOTER ──
    story.append(Spacer(1, 24))
    story.append(subtle_hr())
    story.append(Paragraph(
        "Alpaca Playhouse &bull; 160 Still Forest Drive, Cedar Creek, TX 78612",
        styles['FooterText']
    ))

    # ── BUILD ──
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=1 * inch,
        rightMargin=1 * inch,
        title="Car Rental Agreement - Juston Brommel (March 2026)",
        author="Alpaca Playhouse",
    )
    doc.build(story)
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_contract()
