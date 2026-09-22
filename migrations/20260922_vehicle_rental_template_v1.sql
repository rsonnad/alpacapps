-- lease_templates: vehicle_rental v1
--
-- Transcribed from the Marlo Weekley car rental agreement, draft v5
-- (contracts/generate_weekley_contract.py, 2026-09-17). Rendered by
-- supabase/functions/_shared/vehicle-rental-agreement.ts, which fills every
-- {{placeholder}} and fails loudly on any it cannot fill.
--
-- Deliberate differences from the v5 PDF:
--   * the Section 1 and Section 3 tables are bullet lists (the markdown subset
--     has no tables); wording and values are unchanged;
--   * Section 6 no longer calls the odometer date "the date of execution" —
--     the reading was taken 2026-09-07 but execution is whenever the renter
--     signs, so the phrase would be a false recital.

insert into lease_templates (name, type, version, is_active, content)
select 'Vehicle Rental Agreement', 'vehicle_rental', 1, true, $template$# CAR RENTAL AGREEMENT

AlpacApps Residency • 160 Still Forest Drive, Cedar Creek, TX 78612

---

This Car Rental Agreement ("Agreement") is made and entered into effective as of **{{effective_date}}** between:

**Rahul Sonnad**, with an address of 160 Still Forest Drive, Cedar Creek, Texas ("Owner"),

and

**{{renter_name}}**, with an address of {{renter_address}} ("Renter").

Owner and Renter may also be referred to as "Party" in the singular and "Parties" in the plural. This Agreement is subject to the following terms and conditions:

## 1. Rental Vehicle

Owner hereby agrees to rent to Renter the following vehicle ("Vehicle"):

- **Make:** {{vehicle_make}}
- **Model:** {{vehicle_model}}
- **Year:** {{vehicle_year}}
- **Color:** {{vehicle_color}}
- **Name:** {{vehicle_name}}
- **Odometer:** {{odometer_display}}
- **VIN:** {{vehicle_vin}}

## 2. Rental Period

**Start Date:** {{effective_date}}

**Initial Term:** {{effective_date}} through {{initial_term_end}}

{{retroactive_period_note}}

After the initial term, this Agreement will **automatically renew on a monthly basis** unless canceled with **{{notice_words}} days written notice** by either party via email.

If this Agreement is terminated by the Renter prior to the end of the initial term, or without the required {{notice_words}} days written notice thereafter, the Owner will be entitled to one month's rent, which is equivalent to the deposit.

## 3. Rental Rate & Payment

- **{{first_month_label}} (first month):** {{rate_decimal}}, due {{effective_date}}
- **{{second_month_label}} onward (monthly):** {{rate_decimal}}, due the 1st of each month

The monthly rental rate is **{{rate}} per month**. Rent is billed on a calendar-month basis and is due on the first day of each month. Because the term begins on the first day of a calendar month, no proration applies. {{first_month_payment_note}}

Rental rate does not include Full Self-Driving (FSD) subscription, which can optionally be purchased by the Renter at their own expense.

**Payments:** bit.ly/alpacapay

## 4. Security Deposit

The security deposit for the Vehicle will be **{{deposit}}**, due upon execution of this Agreement.{{deposit_deductible_note}} Owner shall retain this deposit to be used, in the event of loss of or damage to the Vehicle after the term of this Agreement, to defray fully or partially the cost of necessary repairs or replacement not covered by insurance. If the Renter cancels before the end of the term, the full deposit amount shall be retained by the Owner. In the absence of additional miles, damage, loss, termination, or other relevant unpaid fees, said deposit shall be returned to the Renter.

## 5. Insurance

Insurance is at cost, either by Tesla Insurance or a provider of Renter's choice. Renter **must** insure the Vehicle and list **Rahul Sonnad** as owner/beneficiary on the policy.

Proof of insurance is a condition of rental. Renter must obtain the required coverage and deliver copies of the policy documents — including the declarations page showing the named insured, the covered vehicle by VIN, the coverage limits, the deductible, and the policy effective dates, together with proof that Rahul Sonnad is listed as owner/beneficiary — to **alpacaplayhouse@gmail.com**. These documents are due immediately upon execution, and the coverage evidenced must be in force continuously from **{{insurance_start}}**. Where Renter takes possession of a vehicle under this Agreement on any future date, Owner is not obligated to release the vehicle until these documents have been received and accepted.

Renter shall maintain this coverage continuously for the entire rental period and shall provide updated policy documents upon any renewal, change of carrier, or change in coverage. Lapse of coverage is a material breach of this Agreement and entitles Owner to immediate return of the Vehicle.

## 6. Mileage

Renter may drive anywhere local in the greater Austin area with no additional charges. For long-distance road trips exceeding an average of **{{mileage_limit}} miles per month**, an overage charge of **{{overage_rate}} per mile** will apply.

{{odometer_note}}

## 7. Tolls

Renter may use toll roads. Toll charges will be billed at cost and deducted from the security deposit or invoiced separately.

## 8. Fuel & Charging

- Renter may charge the Vehicle at the property at no additional fee.
- Supercharger costs will be billed at cost. Renter should switch billing to their own card.

## 9. Additional Tesla Services

Renter will be responsible for any additional services purchased through the Tesla app, such as Full Self-Driving (FSD) at $99/month.

## 10. Accidents & Liability

Renter is liable for all insurance deductibles up to **{{deductible}}**{{deductible_deposit_ref}} as well as any damages to either vehicle not covered by insurance, and loss of use not covered by insurance. Renter may optionally change the insurance policy to a lower deductible and pay the additional premium.

## 11. Late Returns

A late fee of **{{late_fee}} per hour** will apply unless alternative arrangements are agreed upon in advance.

## 12. Existing Damage to Vehicle

The Parties acknowledge that the following damage to the Vehicle existed prior to the commencement of this rental. Renter is not responsible for any of the following:

{{damage_block}}

{{damage_photos_block}}

{{damage_condition_note}}

## 13. Cleaning

Renter will return the car in a clean state similar to that received, and remove any pet hairs or odors. If this is not completed by the Renter, the cost of professional cleaning will be charged to the Renter.

<span style="color:#666;font-size:0.9em;font-style:italic;">Note: The Renter need not clean the outside of the Vehicle upon return — only the interior.</span>

## 14. Documents & Payments Required

Renter must deliver the following to **alpacaplayhouse@gmail.com** immediately upon execution of this Agreement:

- A copy of Renter's valid driver's license
- Copies of the insurance policy documents required under Section 5, including the declarations page, evidencing coverage in force from **{{insurance_start}}**
- The security deposit of {{deposit}} and the {{first_month_label}} rent of {{rate}} (total {{due_on_execution}})

## 15. Indemnity

Regardless of insurance coverage, Renter shall fully indemnify the Owner for any loss, damage, and legal actions, including reasonable attorneys' fees that Owner suffers due to Renter's use of Vehicle during the term of this Agreement, including but not limited to damage to the Vehicle, damage to the property of others, injury to Renter, and injury to others. This provision survives the termination of this Agreement.

## 16. Owner Warranty

The Owner represents that to the best of his knowledge and belief the Vehicle is in sound and safe condition and free of any known faults or defects that would affect its safe operation under normal use.

## 17. Renter Warranties

The Renter agrees that Renter will not:

- Use the Vehicle to carry any passengers other than Renter
- Allow any other person to operate the Vehicle
- Operate the Vehicle in violation of any laws or for an illegal purpose; if Renter does, Renter is responsible for all associated tickets, fines, and fees
- Use the Vehicle to push or tow another vehicle
- Use the Vehicle for any race or competition
- Operate the Vehicle in a negligent manner

## 18. Arbitration

In the event that the Parties cannot amicably resolve a dispute or damage claim resulting from this Agreement, the Parties agree to resolve any such dispute or damage claim by arbitration. The arbitration proceeding shall be conducted in Austin, Texas, in accordance with the rules of the American Arbitration Association then in effect with one (1) arbitrator to be selected by mutual agreement of the Parties. If the Parties cannot agree on an arbitrator, then the American Arbitration Association shall select an arbitrator from the National Panel of Arbitrators. The laws of the State of Texas shall apply to the arbitration proceedings. The Parties agree that the arbitrator cannot award punitive damages to either Party and agree to be bound by the arbitrator's findings. Judgment upon the award rendered by the arbitrator may be entered in any court having jurisdiction.

## 19. Disputes & Governing Law

The laws of the State of Texas without regard to any conflict of law principles govern this Agreement. No action arising out of the transactions under this Agreement may be brought by either Party more than one year after the cause of action has accrued.

## 20. General Provisions

This Agreement constitutes the entire agreement between the Parties in connection with the subject matter hereof and supersedes all prior agreements, proposals, representations, and other understandings, oral or written. No alteration or modification of this Agreement shall be valid unless made in writing and signed by both Parties. The waiver by either Party of a breach of any provision shall not operate or be construed as a waiver of any subsequent breach. If any provision of this Agreement is held to be invalid or unenforceable, the remaining provisions shall continue in full force and effect. Any notice or communication required hereunder shall be given in writing to the other Party. Any terms of this Agreement which by their nature extend beyond its termination remain in effect until fulfilled.

---

## SIGNATURES

IN WITNESS WHEREOF, the Parties have signed this Agreement as of the day and year first above written.

**ACCEPTED BY OWNER**

{{landlord_signature_img}}

Name: Rahul Sonnad

Address: 160 Still Forest Drive, Cedar Creek, TX 78612

Email: alpacaplayhouse@gmail.com

Date: **{{signing_date}}**

**ACCEPTED BY RENTER**

Name: {{renter_name}}

Address: {{renter_address}}

Email: {{renter_email}}

Signature: _________________________

Date: _________________________
$template$
where not exists (
  select 1 from lease_templates where type = 'vehicle_rental' and version = 1
);
