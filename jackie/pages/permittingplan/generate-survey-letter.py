#!/usr/bin/env python3
"""Generate a professional letter to 4Ward Land Surveying requesting survey update."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import os

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "survey-update-request.pdf")

# Colors
DARK = HexColor("#1a1a2e")
ACCENT = HexColor("#4a6741")
GRAY = HexColor("#555555")
LIGHT_GRAY = HexColor("#999999")

# Styles
style_sender = ParagraphStyle(
    "Sender", fontName="Helvetica-Bold", fontSize=11, textColor=DARK,
    leading=15, alignment=TA_LEFT
)
style_sender_detail = ParagraphStyle(
    "SenderDetail", fontName="Helvetica", fontSize=9.5, textColor=GRAY,
    leading=13, alignment=TA_LEFT
)
style_date = ParagraphStyle(
    "Date", fontName="Helvetica", fontSize=10, textColor=GRAY,
    leading=14, alignment=TA_LEFT
)
style_recipient = ParagraphStyle(
    "Recipient", fontName="Helvetica-Bold", fontSize=10.5, textColor=DARK,
    leading=14, alignment=TA_LEFT
)
style_subject = ParagraphStyle(
    "Subject", fontName="Helvetica-Bold", fontSize=10.5, textColor=ACCENT,
    leading=14, alignment=TA_LEFT
)
style_body = ParagraphStyle(
    "Body", fontName="Helvetica", fontSize=10.5, textColor=DARK,
    leading=16, alignment=TA_LEFT, spaceAfter=10
)
style_bullet = ParagraphStyle(
    "Bullet", fontName="Helvetica", fontSize=10.5, textColor=DARK,
    leading=16, alignment=TA_LEFT, leftIndent=24, bulletIndent=12,
    spaceAfter=4
)
style_closing = ParagraphStyle(
    "Closing", fontName="Helvetica", fontSize=10.5, textColor=DARK,
    leading=16, alignment=TA_LEFT
)
style_signature = ParagraphStyle(
    "Signature", fontName="Helvetica-Bold", fontSize=11, textColor=DARK,
    leading=15, alignment=TA_LEFT
)
style_sig_detail = ParagraphStyle(
    "SigDetail", fontName="Helvetica", fontSize=9.5, textColor=GRAY,
    leading=13, alignment=TA_LEFT
)

def build_pdf():
    doc = SimpleDocTemplate(
        OUTPUT_PATH, pagesize=letter,
        leftMargin=1.1*inch, rightMargin=1.1*inch,
        topMargin=1*inch, bottomMargin=1*inch
    )
    story = []

    # Sender block
    story.append(Paragraph("Rahul Sonnad", style_sender))
    story.append(Paragraph("160 Still Forest Dr, Cedar Creek, TX 78612", style_sender_detail))
    story.append(Paragraph("+1 (424) 234-1750", style_sender_detail))
    story.append(Spacer(1, 6))

    # Accent line
    story.append(HRFlowable(
        width="100%", thickness=2, color=ACCENT,
        spaceAfter=16, spaceBefore=4
    ))

    # Date
    story.append(Paragraph("March 13, 2026", style_date))
    story.append(Spacer(1, 18))

    # Recipient
    story.append(Paragraph("4Ward Land Surveying Team", style_recipient))
    story.append(Spacer(1, 18))

    # Subject line
    story.append(Paragraph(
        "Re: Request to Update Existing Property Survey \u2014 160 Still Forest Dr, Cedar Creek, TX 78612",
        style_subject
    ))
    story.append(Spacer(1, 16))

    # Body
    story.append(Paragraph(
        "Dear 4Ward Land Surveying Team,",
        style_body
    ))

    story.append(Paragraph(
        "I hope you are doing well.",
        style_body
    ))

    story.append(Paragraph(
        "You previously completed a survey for our property, and we are reaching out because we have "
        "made several updates to the site since that original survey was prepared. Specifically, we have "
        "added several trailers and shipping containers to the property, and we would like to have these "
        "structures reflected on the survey.",
        style_body
    ))

    story.append(Paragraph(
        "Because your team already completed the original survey, we are hoping it may be possible to "
        "revise or update the existing drawing rather than start from scratch. Our understanding is that "
        "updating the prior survey to show the added structures as improvements or site features may "
        "require less field work and drafting time, and therefore could potentially be a more "
        "cost-effective process.",
        style_body
    ))

    story.append(Paragraph(
        "Our goal is to move forward with applying to have the property recognized for commercial use "
        "in Bastrop County. From what we understand, an updated survey showing all current site "
        "improvements will likely be needed before we can proceed with the next steps in the permitting "
        "or site development process, which may involve civil engineering review or preparation of a "
        "site plan.",
        style_body
    ))

    story.append(Paragraph("Please let us know:", style_body))

    bullets = [
        "If updating the original survey is possible",
        "What information you may need from us about the trailers and containers",
        "Whether a site visit would be required to locate these structures",
        "An estimate for the cost and timeline to revise the survey",
    ]
    for b in bullets:
        story.append(Paragraph(
            f"\u2022&nbsp;&nbsp;{b}",
            style_bullet
        ))
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        "We would really appreciate the opportunity to continue working with your team since you "
        "already have the base survey and familiarity with the property.",
        style_body
    ))

    story.append(Paragraph(
        "Thank you very much for your time, and we look forward to hearing from you.",
        style_body
    ))

    story.append(Spacer(1, 14))
    story.append(Paragraph("Best regards,", style_closing))
    story.append(Spacer(1, 24))
    story.append(Paragraph("Rahul Sonnad", style_signature))
    story.append(Paragraph("+1 (424) 234-1750", style_sig_detail))
    story.append(Paragraph("160 Still Forest Dr, Cedar Creek, TX 78612", style_sig_detail))

    doc.build(story)
    print(f"PDF created: {OUTPUT_PATH}")

if __name__ == "__main__":
    build_pdf()
