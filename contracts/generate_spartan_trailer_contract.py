#!/usr/bin/env python3
"""Generate a draft residential lease PDF for the Spartan Trailer."""

import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
OUTPUT_DIR = os.path.join(REPO_ROOT, "output", "pdf")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "spartan-trailer-lease-draft.pdf")

DARK = colors.HexColor("#1f2933")
ACCENT = colors.HexColor("#3d8b7a")
LIGHT = colors.HexColor("#f4f7f5")
LINE = colors.HexColor("#d7dfd9")
MUTED = colors.HexColor("#5f6b66")


def styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            name="TitleMain",
            parent=base["Title"],
            alignment=TA_CENTER,
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=DARK,
            spaceAfter=4,
        )
    )
    base.add(
        ParagraphStyle(
            name="Subtitle",
            parent=base["Normal"],
            alignment=TA_CENTER,
            fontName="Helvetica",
            fontSize=10,
            leading=13,
            textColor=MUTED,
            spaceAfter=12,
        )
    )
    base.add(
        ParagraphStyle(
            name="Notice",
            parent=base["Normal"],
            alignment=TA_CENTER,
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#8a5a00"),
            backColor=colors.HexColor("#fff6dc"),
            borderColor=colors.HexColor("#e8c76d"),
            borderWidth=0.5,
            borderPadding=6,
            spaceAfter=12,
        )
    )
    base.add(
        ParagraphStyle(
            name="Section",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=DARK,
            spaceBefore=12,
            spaceAfter=6,
        )
    )
    base.add(
        ParagraphStyle(
            name="LeaseBody",
            parent=base["BodyText"],
            alignment=TA_JUSTIFY,
            fontName="Helvetica",
            fontSize=9.6,
            leading=13,
            textColor=colors.black,
            spaceAfter=6,
        )
    )
    base.add(
        ParagraphStyle(
            name="BulletText",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.6,
            leading=13,
            leftIndent=16,
            firstLineIndent=-8,
            spaceAfter=3,
        )
    )
    base.add(
        ParagraphStyle(
            name="Signature",
            parent=base["BodyText"],
            alignment=TA_LEFT,
            fontName="Helvetica",
            fontSize=9.6,
            leading=16,
            spaceAfter=4,
        )
    )
    return base


def para(text, style):
    return Paragraph(text, style)


def rule():
    return HRFlowable(width="100%", thickness=0.8, color=LINE, spaceBefore=4, spaceAfter=8)


def terms_table(s):
    data = [
        ["Premises", "Spartan Trailer at 160 Still Forest Drive, Cedar Creek, TX 78612"],
        ["Tenant", "____________________________"],
        ["Landlord", "AlpacApps Residency"],
        ["Rent", "$1,000 per month"],
        ["Deposit", "$1,000, equal to one month's rent"],
        ["Initial Term", "Three months from the lease start date"],
        ["Continuation", "Month-to-month after the initial term unless terminated with written notice"],
    ]
    table = Table(data, colWidths=[1.45 * inch, 4.65 * inch], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), LIGHT),
                ("TEXTCOLOR", (0, 0), (0, -1), DARK),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.2),
                ("LEADING", (0, 0), (-1, -1), 12),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def build_story():
    s = styles()
    story = []

    story.append(para("RESIDENTIAL LEASE AGREEMENT", s["TitleMain"]))
    story.append(para("AlpacApps Residency | 160 Still Forest Drive, Cedar Creek, TX 78612", s["Subtitle"]))
    story.append(para("DRAFT FOR REVIEW - NOT YET EXECUTED", s["Notice"]))
    story.append(rule())

    story.append(
        para(
            'This Residential Lease Agreement ("Agreement") is entered into on '
            "____________________________ between <b>AlpacApps Residency</b> "
            '("Landlord") and <b>____________________________</b> ("Tenant").',
            s["LeaseBody"],
        )
    )
    story.append(terms_table(s))

    story.append(para("1. Premises", s["Section"]))
    story.append(
        para(
            'Landlord agrees to rent to Tenant the dwelling space known as the <b>Spartan Trailer</b>, '
            'located at 160 Still Forest Drive, Cedar Creek, Texas 78612 (the "Premises"). '
            "The Premises are provided for residential occupancy only.",
            s["LeaseBody"],
        )
    )

    story.append(para("2. Term", s["Section"]))
    story.append(
        para(
            "The initial lease term shall commence on <b>____________________________</b> "
            "and continue for <b>three (3) months</b>, ending on "
            "<b>____________________________</b> unless otherwise agreed in writing.",
            s["LeaseBody"],
        )
    )
    story.append(
        para(
            "After the initial three-month term, this Agreement shall continue naturally on a "
            "<b>month-to-month basis</b> under the same terms unless terminated by either party "
            "with at least <b>30 days written notice</b>. Written notice may be given on any date.",
            s["LeaseBody"],
        )
    )

    story.append(para("3. Rent", s["Section"]))
    story.append(
        para(
            "Tenant agrees to pay rent of <b>$1,000 per month</b>. Rent is due on the "
            "1st day of each month unless the parties agree in writing to a different payment schedule.",
            s["LeaseBody"],
        )
    )
    story.append(para("- Late payments are subject to a $50 late fee after the 5th day.", s["BulletText"]))
    story.append(
        para(
            "- Accepted payment methods include Venmo, Zelle, PayPal, bank transfer, or another method approved by Landlord.",
            s["BulletText"],
        )
    )

    story.append(para("4. Deposit and Move-In Payments", s["Section"]))
    story.append(
        para(
            "Tenant shall pay a <b>$1,000 deposit</b>, equal to one month's rent. "
            "The deposit secures Tenant's obligations under this Agreement and may be applied to unpaid rent, "
            "damage beyond ordinary wear and tear, missing property, cleaning required after move-out, "
            "or other unpaid amounts allowed by this Agreement.",
            s["LeaseBody"],
        )
    )
    story.append(
        para(
            "Unless applied to amounts owed, the remaining deposit shall be returned within 30 days after "
            "Tenant vacates the Premises and returns possession to Landlord.",
            s["LeaseBody"],
        )
    )

    story.append(para("5. Early Termination", s["Section"]))
    story.append(
        para(
            "During the initial three-month term, Tenant is expected to remain responsible for rent through "
            "the end of the initial term unless Landlord agrees in writing to an earlier release. "
            "After the initial term, either party may end the month-to-month tenancy with at least 30 days written notice.",
            s["LeaseBody"],
        )
    )

    story.append(para("6. House Rules", s["Section"]))
    for item in [
        "Respect quiet hours from 10 PM to 8 AM.",
        "Keep the Premises clean, sanitary, and free of hazards.",
        "Do not disturb other residents or neighbors.",
        "Promptly report maintenance issues, leaks, damage, or safety concerns.",
        "Do not conduct illegal activity on the Premises or property.",
        "Do not sublease or assign this Agreement without Landlord's written consent.",
    ]:
        story.append(para(f"- {item}", s["BulletText"]))

    story.append(para("7. Utilities and Shared Areas", s["Section"]))
    story.append(
        para(
            "Unless otherwise agreed in writing, Tenant is responsible for a reasonable share of utilities "
            "and for respectful use of any shared areas, amenities, parking areas, paths, bathrooms, kitchens, "
            "laundry, internet, and outdoor spaces made available by Landlord.",
            s["LeaseBody"],
        )
    )

    story.append(para("8. Maintenance, Damage, and Alterations", s["Section"]))
    story.append(
        para(
            "Tenant shall keep the Premises in good condition and shall not make alterations, install fixtures, "
            "paint, modify electrical or plumbing systems, or attach items in a way that damages the Premises "
            "without Landlord's prior written consent. Tenant is responsible for damage caused by Tenant or Tenant's guests.",
            s["LeaseBody"],
        )
    )

    story.append(para("9. Liability and Indemnity", s["Section"]))
    story.append(
        para(
            "Tenant is responsible for Tenant's personal property and conduct. To the fullest extent allowed by law, "
            "Tenant agrees to indemnify Landlord from claims, losses, damages, costs, or expenses arising from "
            "Tenant's use of the Premises, Tenant's breach of this Agreement, or acts of Tenant's guests.",
            s["LeaseBody"],
        )
    )

    story.append(para("10. Governing Law", s["Section"]))
    story.append(
        para(
            "This Agreement shall be governed by the laws of the State of Texas. If any provision is held invalid "
            "or unenforceable, the remaining provisions shall continue in effect.",
            s["LeaseBody"],
        )
    )

    story.append(para("11. Additional Terms", s["Section"]))
    story.append(para("Additional terms: ________________________________________________________________", s["LeaseBody"]))
    story.append(para("________________________________________________________________________________", s["LeaseBody"]))
    story.append(para("________________________________________________________________________________", s["LeaseBody"]))

    story.append(PageBreak())
    story.append(para("SIGNATURES", s["Section"]))
    story.append(
        para(
            "By signing below, both parties agree to the terms of this Residential Lease Agreement.",
            s["LeaseBody"],
        )
    )
    story.append(Spacer(1, 12))

    sig_data = [
        ["LANDLORD", "", "TENANT"],
        ["Signature: _________________________", "", "Signature: _________________________"],
        ["Name: AlpacApps Residency", "", "Name: _________________________"],
        ["Date: _________________________", "", "Date: _________________________"],
    ]
    sig_table = Table(sig_data, colWidths=[2.85 * inch, 0.35 * inch, 2.85 * inch])
    sig_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(sig_table)
    return story


def add_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(inch, 0.45 * inch, "Spartan Trailer Lease Draft")
    canvas.drawRightString(7.5 * inch, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=letter,
        topMargin=0.65 * inch,
        bottomMargin=0.75 * inch,
        leftMargin=0.8 * inch,
        rightMargin=0.8 * inch,
        title="Spartan Trailer Lease Draft",
        author="AlpacApps Residency",
    )
    doc.build(build_story(), onFirstPage=add_footer, onLaterPages=add_footer)
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
