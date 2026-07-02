#!/usr/bin/env python3
"""Generate a Spartan Trailer draft lease from the active Alpaca templates."""

import html
import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
OUTPUT_DIR = os.path.join(REPO_ROOT, "output", "pdf")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "spartan-trailer-lease-draft.pdf")
SUPABASE_JS = os.path.join(REPO_ROOT, "shared", "supabase.js")

PROJECT_GREEN = colors.HexColor("#3d8b7a")
TEXT_DARK = colors.HexColor("#1f2933")
TEXT_MUTED = colors.HexColor("#5f6b66")
RULE = colors.HexColor("#d7dfd9")
NOTICE_BG = colors.HexColor("#fff6dc")
NOTICE_BORDER = colors.HexColor("#e8c76d")


def load_supabase_config():
    source = open(SUPABASE_JS, encoding="utf-8").read()
    url = re.search(r"SUPABASE_URL = '([^']+)'", source).group(1)
    key = re.search(r"SUPABASE_ANON_KEY = '([^']+)'", source).group(1)
    return url, key


def supabase_get(path):
    url, key = load_supabase_config()
    req = urllib.request.Request(
        f"{url}/rest/v1{path}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_active_templates():
    query = urllib.parse.urlencode(
        {
            "select": "id,name,type,version,is_active,content,created_at,updated_at",
            "type": "in.(lease,renter_waiver)",
            "is_active": "eq.true",
            "order": "type.asc,version.desc",
        }
    )
    rows = supabase_get(f"/lease_templates?{query}")
    lease = next((row for row in rows if row["type"] == "lease"), None)
    waiver = next((row for row in rows if row["type"] == "renter_waiver"), None)
    if not lease:
        raise RuntimeError("No active lease template found")
    return lease, waiver


def fetch_spartan_space():
    query = urllib.parse.urlencode(
        {
            "select": "id,name,type,monthly_rate,location,is_archived",
            "name": "eq.Spartan Trailer",
            "is_archived": "eq.false",
            "limit": "1",
        }
    )
    rows = supabase_get(f"/spaces?{query}")
    if not rows:
        return {
            "name": "Spartan Trailer",
            "location": "in the front yard",
            "monthly_rate": 1000,
        }
    return rows[0]


def fetch_landlord_signature():
    query = urllib.parse.urlencode({"select": "key,value", "key": "eq.landlord_signature"})
    rows = supabase_get(f"/config?{query}")
    return rows[0]["value"] if rows else {}


def signing_date():
    today = date.today()
    suffix = "th"
    if today.day % 10 == 1 and today.day != 11:
        suffix = "st"
    elif today.day % 10 == 2 and today.day != 12:
        suffix = "nd"
    elif today.day % 10 == 3 and today.day != 13:
        suffix = "rd"
    return today.strftime(f"%B {today.day}{suffix}, %Y")


def build_agreement_data(space, signature_cfg):
    rent = int(float(space.get("monthly_rate") or 1000))
    location = space.get("location") or "front yard"
    location = re.sub(r"^\s*in\s+", "", location, flags=re.IGNORECASE)
    return {
        "tenant_name": "____________________________",
        "tenant_email": "____________________________",
        "tenant_phone": "____________________________",
        "signing_date": signing_date(),
        "lease_start_date": "____________________________",
        "dwelling_description": space.get("name") or "Spartan Trailer",
        "dwelling_location": location,
        "rate_display": f"${rent:,}/month",
        "security_deposit": "$1,000",
        "lease_term_block": (
            "This Lease shall commence on: **____________________________** and continue for "
            "an initial term of **three (3) months**. At the end of the initial term, this "
            "Lease shall continue naturally on a **month-to-month basis** under the same terms "
            "until terminated by either party with at least **30 days** written notice."
        ),
        "additional_terms": "None.",
        "landlord_signature_img": "__LANDLORD_SIGNATURE__",
        "landlord_signature_name": signature_cfg.get("name") or "Rahul Sonnad",
        "landlord_signature_url": signature_cfg.get("signature_image_url") or "",
    }


USER_CONTROLLED_FIELDS = {
    "tenant_name",
    "tenant_email",
    "tenant_phone",
    "client_name",
    "client_email",
    "client_phone",
    "dwelling_description",
    "dwelling_location",
    "additional_terms",
}


def substitute(template, data):
    content = template
    additional_terms = data.get("additional_terms", "").strip()
    if additional_terms and additional_terms != "None.":
        replacement = f"The following additional terms apply:\n\n{html.escape(additional_terms)}"
    else:
        replacement = "None."
    content = content.replace("{{additional_terms}}", replacement)

    for key, value in data.items():
        if key == "additional_terms":
            continue
        rendered = html.escape(str(value)) if key in USER_CONTROLLED_FIELDS else str(value)
        content = content.replace(f"{{{{{key}}}}}", rendered)

    return re.sub(r"\{\{\w+\}\}", "", content)


def styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            name="DraftNotice",
            parent=base["Normal"],
            alignment=TA_CENTER,
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#8a5a00"),
            backColor=NOTICE_BG,
            borderColor=NOTICE_BORDER,
            borderWidth=0.5,
            borderPadding=6,
            spaceAfter=12,
        )
    )
    base.add(
        ParagraphStyle(
            name="LeaseTitle",
            parent=base["Title"],
            alignment=TA_CENTER,
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=TEXT_DARK,
            spaceAfter=7,
        )
    )
    base.add(
        ParagraphStyle(
            name="LeaseH2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11.5,
            leading=14,
            textColor=PROJECT_GREEN,
            spaceBefore=11,
            spaceAfter=5,
        )
    )
    base.add(
        ParagraphStyle(
            name="LeaseH3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=13,
            textColor=TEXT_DARK,
            spaceBefore=8,
            spaceAfter=4,
        )
    )
    base.add(
        ParagraphStyle(
            name="LeaseBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=12.2,
            textColor=colors.black,
            spaceAfter=5,
        )
    )
    base.add(
        ParagraphStyle(
            name="LeaseBullet",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=12.2,
            leftIndent=14,
            firstLineIndent=0,
            spaceAfter=2,
        )
    )
    base.add(
        ParagraphStyle(
            name="Footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=TEXT_MUTED,
        )
    )
    return base


def inline_markup(text):
    escaped = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    escaped = html.escape(escaped)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    return escaped


def download_signature(url):
    if not url:
        return None
    suffix = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".png"
    fd, path = tempfile.mkstemp(prefix="alpaca-landlord-signature-", suffix=suffix)
    os.close(fd)
    urllib.request.urlretrieve(url, path)
    return path


def signature_flowable(data):
    flowables = []
    signature_path = download_signature(data.get("landlord_signature_url", ""))
    if signature_path:
        img = Image(signature_path)
        img._restrictSize(2.7 * inch, 0.8 * inch)
        flowables.append(img)
    else:
        flowables.append(Paragraph(inline_markup(data["landlord_signature_name"]), styles()["LeaseBody"]))
    flowables.append(
        Paragraph(
            inline_markup(f"Pre-signed {data['signing_date']}"),
            styles()["Footer"],
        )
    )
    return KeepTogether(flowables)


def render_markdown(markdown, data, s):
    story = []
    lines = markdown.splitlines()
    list_items = []

    def flush_list():
        nonlocal list_items
        if list_items:
            story.append(
                ListFlowable(
                    list_items,
                    bulletType="bullet",
                    start="bulletchar",
                    leftIndent=18,
                    bulletFontName="Helvetica",
                    bulletFontSize=7,
                )
            )
            list_items = []

    for raw in lines:
        line = raw.strip()
        if not line:
            flush_list()
            story.append(Spacer(1, 3))
            continue

        if line == "__LANDLORD_SIGNATURE__":
            flush_list()
            story.append(signature_flowable(data))
            continue

        if line in {"---", "***"}:
            flush_list()
            story.append(HRFlowable(width="100%", thickness=0.6, color=RULE, spaceBefore=6, spaceAfter=6))
            continue

        if line.startswith("# "):
            flush_list()
            story.append(Paragraph(inline_markup(line[2:]), s["LeaseTitle"]))
            continue

        if line.startswith("## "):
            flush_list()
            story.append(Paragraph(inline_markup(line[3:]), s["LeaseH2"]))
            continue

        if line.startswith("### "):
            flush_list()
            story.append(Paragraph(inline_markup(line[4:]), s["LeaseH3"]))
            continue

        if line.startswith("- ") or line.startswith("* "):
            list_items.append(ListItem(Paragraph(inline_markup(line[2:]), s["LeaseBullet"])))
            continue

        flush_list()
        story.append(Paragraph(inline_markup(line), s["LeaseBody"]))

    flush_list()
    return story


def add_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(0.72 * inch, 0.45 * inch, "Spartan Trailer Lease Draft - active Alpaca template")
    canvas.drawRightString(7.78 * inch, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    lease_template, waiver_template = fetch_active_templates()
    space = fetch_spartan_space()
    signature_cfg = fetch_landlord_signature()
    data = build_agreement_data(space, signature_cfg)
    s = styles()

    lease_markdown = substitute(lease_template["content"], data)
    story = [Paragraph("DRAFT FOR REVIEW - NOT YET EXECUTED", s["DraftNotice"])]
    story.extend(render_markdown(lease_markdown, data, s))

    if waiver_template:
        waiver_data = {**data, "client_name": data["tenant_name"], "client_email": data["tenant_email"], "client_phone": data["tenant_phone"]}
        waiver_markdown = substitute(waiver_template["content"], waiver_data)
        story.append(PageBreak())
        story.extend(render_markdown(waiver_markdown, waiver_data, s))

    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=letter,
        topMargin=0.62 * inch,
        bottomMargin=0.72 * inch,
        leftMargin=0.72 * inch,
        rightMargin=0.72 * inch,
        title="Spartan Trailer Lease Draft",
        author="Alpaca Playhouse Austin",
    )
    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    print(OUTPUT_PATH)
    print(f"Lease template: {lease_template['name']} v{lease_template['version']}")
    if waiver_template:
        print(f"Waiver template: {waiver_template['name']} v{waiver_template['version']}")


if __name__ == "__main__":
    main()
