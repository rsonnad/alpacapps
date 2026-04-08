# NRCS Web Soil Survey — Procedure + Known Data (Task B34)

**Property:** 160 Still Forest Dr, Cedar Creek, TX 78612, 1.7348 ac, approx. 30.13°N, 97.46°W
**Research date:** 2026-04-08

## ⚠️ Why this can't be fully automated

The NRCS Web Soil Survey (https://websoilsurvey.nrcs.usda.gov/app/) is an interactive Silverlight-successor browser app. The thematic reports and AOI tools cannot be invoked via HTTP fetch. Jackie or operator must run the steps below in a desktop browser to produce the parcel-specific PDF. This artifact documents the exact procedure so the output is reproducible.

## 1. Step-by-step: Generate Custom Soil Resource Report

1. **Navigate** to https://websoilsurvey.nrcs.usda.gov/app/ and click **Start WSS**.
2. **Define Area of Interest (AOI)** — "Area of Interest" tab. Options:
   - *Quick Navigation → Address:* `160 Still Forest Dr, Cedar Creek, TX 78612`, or
   - *Quick Navigation → Lat/Long:* `30.13, -97.46`, or
   - *Quick Navigation → Section/Township/Range*, or import a parcel shapefile.
   - Click the **AOI rectangle** or **AOI polygon** tool and trace the parcel boundary (use BCAD parcel as reference). AOI ≤10,000 acres.
3. **Soil Map tab** — confirm map units covering the 1.7348-acre parcel; note each map unit symbol, name, acreage.
4. **Soil Data Explorer → Suitabilities and Limitations for Use → Sanitary Facilities** (OSSF-critical). Run and add to cart:
   - *Septic Tank Absorption Fields*
   - *Sewage Lagoons*
   - *Disposal Fields — Subsurface*
5. **Soil Data Explorer → Soil Properties and Qualities**, add:
   - *Depth to Water Table*
   - *Depth to Restrictive Feature / Bedrock*
   - *Ksat (Saturated Hydraulic Conductivity)*
   - *Percent Clay, Sand, Silt by horizon*
   - *Flooding Frequency* and *Ponding Frequency*
   - *Hydrologic Soil Group*
6. **Shopping Cart (Free) tab → Check Out → Get Now** → downloads a single PDF **Custom Soil Resource Report**.

Save the PDF to this folder as `custom-soil-report.pdf` for inclusion in the IDP packet.

## 2. Known soil data for the parcel area

`[VERIFY: pull custom report]` — I will not name specific series for this parcel without the custom report. The Bastrop County soil survey is published by NRCS; the "Bastrop" series itself has an Official Series Description (fine sandy loam, Alfisol), but whether it maps onto this specific parcel must come from the WSS polygon lookup.

References for verification after the custom report is pulled:
- Bastrop series OSD: https://soilseries.sc.egov.usda.gov/OSD_Docs/B/BASTROP.html
- Official Soil Series Descriptions index: https://www.nrcs.usda.gov/resources/data-and-reports/official-soil-series-descriptions-osds
- SSURGO (underlying dataset): https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo

## 3. Sections the OSSF designer needs (per 30 TAC §285)

Under 30 TAC §285.30(b) the site evaluation requires soil analysis by a licensed Site Evaluator with at least two soil profile holes; the NRCS report supplements (does not replace) field borings. The designer uses the WSS report for:

- **Map unit name & description** (§285.30 soil classification context)
- **Depth to seasonal high water table** (§285.33 — restrictive horizon)
- **Depth to restrictive feature / bedrock** (§285.33)
- **Hydrologic soil group & Ksat** (absorptive area sizing, §285.33(b) Table III)
- **Flooding/ponding frequency** (§285.3, prohibited areas)
- **Texture (% clay/sand/silt)** (Class Ia–IV classification per §285.30 Table VIII)
- **Septic tank absorption field suitability** thematic (§285.33 system selection)

Texas OSSF rule text: https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=4&ti=30&pt=1&ch=285

## 4. Sources (retrieved 2026-04-08)

- https://websoilsurvey.sc.egov.usda.gov/App/HomePage.htm
- https://websoilsurvey.nrcs.usda.gov/app/
- https://www.nrcs.usda.gov/resources/data-and-reports/web-soil-survey
- https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo
- https://soilseries.sc.egov.usda.gov/OSD_Docs/B/BASTROP.html
- https://www.nrcs.usda.gov/state-offices/texas/soils-texas
