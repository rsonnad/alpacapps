#!/usr/bin/env python3
"""Generate car rental contract PDF for Juston Brommel."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.colors import HexColor, black, grey
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "juston-brommel-car-rental-2025.pdf")

# Colors
DARK = HexColor("#1a1a2e")
ACCENT = HexColor("#16213e")
LIGHT_GREY = HexColor("#f0f0f0")
MED_GREY = HexColor("#666666")

def build_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        name='ContractTitle',
        parent=styles['Title'],
        fontSize=20,
        leading=24,
        textColor=DARK,
        alignment=TA_CENTER,
        spaceAfter=4,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='ContractSubtitle',
        parent=styles['Normal'],
        fontSize=11,
        leading=14,
        textColor=MED_GREY,
        alignment=TA_CENTER,
        spaceAfter=20,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='SectionHead',
        parent=styles['Heading2'],
        fontSize=13,
        leading=16,
        textColor=DARK,
        spaceBefore=16,
        spaceAfter=6,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='SubHead',
        parent=styles['Normal'],
        fontSize=11,
        leading=14,
        textColor=ACCENT,
        spaceBefore=10,
        spaceAfter=4,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='Body',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
        textColor=black,
        alignment=TA_JUSTIFY,
        spaceAfter=6,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='BodyBold',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
        textColor=black,
        alignment=TA_LEFT,
        spaceAfter=4,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='BulletCustom',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
        textColor=black,
        leftIndent=20,
        spaceAfter=3,
        fontName='Helvetica',
    ))
    styles.add(ParagraphStyle(
        name='SmallNote',
        parent=styles['Normal'],
        fontSize=9,
        leading=12,
        textColor=MED_GREY,
        spaceAfter=4,
        fontName='Helvetica-Oblique',
    ))
    styles.add(ParagraphStyle(
        name='SignLine',
        parent=styles['Normal'],
        fontSize=10,
        leading=20,
        textColor=black,
        fontName='Helvetica',
    ))
    return styles


def hr():
    return HRFlowable(width="100%", thickness=1, color=HexColor("#cccccc"), spaceAfter=10, spaceBefore=6)


def build_contract():
    styles = build_styles()
    story = []

    # ── HEADER ──
    story.append(Paragraph("CAR RENTAL AGREEMENT", styles['ContractTitle']))
    story.append(Paragraph("Alpaca Playhouse &bull; 160 Still Forest Drive, Cedar Creek, TX 78612", styles['ContractSubtitle']))
    story.append(hr())

    # ── INTRO ──
    story.append(Paragraph(
        'This Car Rental Agreement ("Agreement") is made and entered into as of '
        '<b>May 21, 2025</b> between:', styles['Body']
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        '<b>Rahul Sonnad</b>, with an address of 160 Still Forest Drive, Cedar Creek, Texas ("Owner"),',
        styles['Body']
    ))
    story.append(Paragraph('and', styles['Body']))
    story.append(Paragraph(
        '<b>Juston Brommel</b> ("Renter").',
        styles['Body']
    ))
    story.append(Spacer(1, 4))
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
        ["Mileage", "99,050 (approx)"],
        ["VIN", "5YJ3E1EB0NF189739"],
    ]
    t = Table(vehicle_data, colWidths=[1.8 * inch, 4.0 * inch])
    t.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), black),
        ('BACKGROUND', (0, 0), (0, -1), LIGHT_GREY),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#dddddd")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(Spacer(1, 8))

    # ── RENTAL PERIOD ──
    story.append(Paragraph("2. Rental Period", styles['SectionHead']))
    story.append(Paragraph(
        "<b>Start Date:</b> May 21, 2025 at 6:00 PM", styles['Body']
    ))
    story.append(Paragraph(
        "<b>End Date:</b> June 20, 2025 at 6:00 PM", styles['Body']
    ))
    story.append(Paragraph(
        "After the initial term, this Agreement will <b>automatically renew on a monthly basis</b> "
        "unless canceled with <b>two (2) weeks written notice</b> by either party via email.",
        styles['Body']
    ))
    story.append(Paragraph(
        "The Parties agree that this Agreement terminates upon the End Date specified above. "
        "Notwithstanding anything to the contrary in this Agreement, neither Party will have rights "
        "to terminate this Agreement prior to the End Date.",
        styles['Body']
    ))
    story.append(Paragraph(
        "If this Agreement is terminated by the Renter prior to the End Date, the Owner will be "
        "entitled to one month's rent, which is equivalent to the deposit.",
        styles['Body']
    ))

    # ── RENTAL RATE ──
    story.append(Paragraph("3. Rental Rate &amp; Payment", styles['SectionHead']))

    rate_data = [
        ["Period", "Monthly Rate"],
        ["May 21, 2025 \u2013 September 30, 2025", "$495/month"],
        ["October 1, 2025 onward", "$295/month"],
    ]
    rt = Table(rate_data, colWidths=[3.2 * inch, 2.6 * inch])
    rt.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BACKGROUND', (0, 0), (-1, 0), ACCENT),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor("#ffffff")),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT_GREY),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('ALIGN', (1, 0), (1, -1), 'CENTER'),
    ]))
    story.append(rt)
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        "Rental rate does not include Full Self-Driving (FSD) subscription, which can optionally "
        "be purchased by the Renter at their own expense.",
        styles['Body']
    ))
    story.append(Paragraph(
        "<b>Payments:</b> bit.ly/alpacapay", styles['Body']
    ))

    # ── SECURITY DEPOSIT ──
    story.append(Paragraph("4. Security Deposit", styles['SectionHead']))
    story.append(Paragraph(
        "The security deposit for the Vehicle will be <b>$300</b>. Owner shall retain this deposit to be used, "
        "in the event of loss of or damage to the Vehicle after the term of this Agreement, to defray fully "
        "or partially the cost of necessary repairs or replacement not covered by insurance. If the Renter "
        "cancels before the end of the term, the full deposit amount shall be retained by the Owner. In the "
        "absence of additional miles, damage, loss, termination, or other relevant unpaid fees, said deposit "
        "shall be returned to the Renter.",
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
        "Renter must send a copy of their driver's license to <b>alpacaplayhouse@gmail.com</b> prior to "
        "taking possession of the Vehicle.",
        styles['Body']
    ))

    # ── PAGE BREAK for legal sections ──
    story.append(PageBreak())

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
        "understandings, oral or written. No alteration or modification of this Agreement shall be valid "
        "unless made in writing and signed by both Parties. The waiver by either Party of a breach of any "
        "provision shall not operate or be construed as a waiver of any subsequent breach. If any provision "
        "of this Agreement is held to be invalid or unenforceable, the remaining provisions shall continue "
        "in full force and effect. Any notice or communication required hereunder shall be given in writing "
        "to the other Party. Any terms of this Agreement which by their nature extend beyond its termination "
        "remain in effect until fulfilled.",
        styles['Body']
    ))

    # ── SIGNATURES ──
    story.append(Spacer(1, 20))
    story.append(hr())
    story.append(Paragraph("SIGNATURES", styles['SectionHead']))
    story.append(Paragraph(
        "IN WITNESS WHEREOF, the Parties have signed this Agreement as of the day and year first above written.",
        styles['Body']
    ))
    story.append(Spacer(1, 16))

    # Signature table
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
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), black),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(sig_table)

    # ── BUILD ──
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=letter,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        leftMargin=1 * inch,
        rightMargin=1 * inch,
        title="Car Rental Agreement - Juston Brommel",
        author="Alpaca Playhouse",
    )
    doc.build(story)
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_contract()
