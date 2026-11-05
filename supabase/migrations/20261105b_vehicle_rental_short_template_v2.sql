-- Short-term car rental agreement v2: the renter's own insurance is primary;
-- the $1,000 deductible applies only when the Owner's insurance must be used.
-- Pickup and return at the house. The renderer takes the newest active version.

-- Only one active template per type (lease_templates_one_active_per_type).
UPDATE public.lease_templates SET is_active = false, updated_at = now()
WHERE type = 'vehicle_rental_short' AND version = 1;

INSERT INTO public.lease_templates (name, type, version, is_active, created_by, content)
SELECT 'Short-Term Car Rental Agreement', 'vehicle_rental_short', 2, true, 'claude', $tpl$
# SHORT-TERM CAR RENTAL AGREEMENT

AlpacApps Residency • 160 Still Forest Drive, Cedar Creek, TX 78612

---

This Short-Term Car Rental Agreement ("Agreement") is made and entered into as of **{{signing_date}}** between:

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
- **Odometer at signing:** {{odometer_display}}
- **VIN:** {{vehicle_vin}}

## 2. Rental Period

- **Pickup:** {{pickup_at}} at {{pickup_location}}
- **Return:** {{return_at}} at {{return_location}}
- **Length:** {{rental_days}} days

Renter must pick up and return the Vehicle in person at the address above. This is a fixed-term rental. It does not renew. Any extension must be agreed in writing (email or text message is sufficient) before the return time.

## 3. Rental Price & Payment

- **Rental, {{rental_days}} days:** {{base_total}}{{fsd_line}}
- **Total rental price:** **{{total_due}}**

The total rental price covers the full rental period. It is due in full before pickup. Owner is not obligated to release the Vehicle until it has been paid.

**Payments:** alpacaplayhouse.com/pay

## 4. Security Deposit

No security deposit is held. Any amounts owed under Sections 6 through 13 are invoiced to Renter after return and are due within seven (7) days of the invoice.

## 5. Insurance & Damage

**Renter's insurance is primary.** Renter shall keep Renter's own auto insurance in force for the entire rental period, covering Renter while driving a vehicle Renter does not own:

- **Insurer:** {{renter_insurer}}
- **Policy number:** {{renter_policy}}

Damage to or theft of the Vehicle, and claims by others, arising during the rental period are claimed first against Renter's insurance. Renter pays any deductible under Renter's own policy.

**Owner's insurance is secondary.** Only if Renter's insurance does not cover the damage and Owner's insurance must be used, Renter shall pay Owner a **damage deductible of up to {{deductible}}** per incident. Where the cost of repair is less than {{deductible}}, Renter pays the actual cost of repair instead.

The {{deductible}} cap does not apply, and Renter is responsible for the full cost of damage and loss of use, where the damage is caused by a breach of Section 15 (for example, an unauthorized driver, driving under the influence, racing, or illegal use), or where an insurer denies the claim because of Renter's conduct.

Renter must report any accident, damage or theft to Owner immediately, and to the police where required by law, and must cooperate with both insurers' claims.

## 6. Mileage

The rental includes **{{mileage_included}} miles**. Miles beyond that are charged at **{{overage_rate}} per mile**, measured against the odometer reading in Section 1 and the reading at return.

## 7. Tolls & Tickets

Renter may use toll roads. Tolls are billed to Renter at cost. Renter is responsible for all parking tickets, traffic and camera violations, and associated fees incurred during the rental period.

## 8. Charging

- Supercharger and other charging costs during the rental are billed to Renter at cost. Renter may switch Supercharger billing to Renter's own card.
- Renter shall return the Vehicle with at least the same battery charge as at pickup, or pay the charging cost to restore it.

## 9. Additional Tesla Services

Full Self-Driving (FSD) is not included unless shown in Section 3. Renter is responsible for any other paid services purchased through the Tesla app during the rental.

## 10. Late Returns

A late fee of **{{late_fee}} per hour** applies after the return time unless an extension was agreed under Section 2.

## 11. Existing Damage to Vehicle

The Parties acknowledge that the following damage to the Vehicle existed before the rental. Renter is not responsible for it:

{{damage_block}}

At pickup, the Parties will walk around the Vehicle and either Party may take photographs. Damage recorded at pickup is added to this list.

## 12. Cleaning & Smoking

Renter will return the Vehicle with the interior in a clean state similar to that received, and with no pet hair or odors. No smoking or vaping in the Vehicle. If professional cleaning is needed, its cost is charged to Renter. Renter need not clean the outside of the Vehicle.

## 13. Documents Provided

Renter has provided a photo of Renter's valid driver's license, the license number, Renter's date of birth and Renter's insurance details before signing this Agreement. Owner keeps these on file privately. Renter confirms the license is valid and will remain valid for the rental period, and shall show the physical license at pickup on request.

## 14. Owner Warranty

The Owner represents that to the best of his knowledge and belief the Vehicle is in sound and safe condition and free of any known faults or defects that would affect its safe operation under normal use.

## 15. Renter Warranties

The Renter agrees that Renter will not:

- Allow any other person to drive the Vehicle
- Drive the Vehicle under the influence of alcohol or drugs
- Operate the Vehicle in violation of any laws or for an illegal purpose; if Renter does, Renter is responsible for all associated tickets, fines and fees
- Use the Vehicle for rideshare, delivery or any other commercial purpose
- Use the Vehicle to push or tow another vehicle
- Use the Vehicle for any race or competition
- Take the Vehicle outside the United States
- Operate the Vehicle in a negligent manner

## 16. Indemnity

Renter shall indemnify the Owner for claims by third parties, fines, and legal costs, including reasonable attorneys' fees, arising from Renter's use of the Vehicle during the rental period, to the extent not paid by insurance. Damage to the Vehicle itself is governed by Section 5. This provision survives the end of this Agreement.

## 17. Arbitration

In the event that the Parties cannot amicably resolve a dispute or damage claim resulting from this Agreement, the Parties agree to resolve any such dispute or damage claim by arbitration. The arbitration proceeding shall be conducted in Austin, Texas, in accordance with the rules of the American Arbitration Association then in effect with one (1) arbitrator to be selected by mutual agreement of the Parties. If the Parties cannot agree on an arbitrator, then the American Arbitration Association shall select an arbitrator from the National Panel of Arbitrators. The laws of the State of Texas shall apply to the arbitration proceedings. The Parties agree that the arbitrator cannot award punitive damages to either Party and agree to be bound by the arbitrator's findings. Judgment upon the award rendered by the arbitrator may be entered in any court having jurisdiction.

## 18. Governing Law & General Provisions

The laws of the State of Texas without regard to any conflict of law principles govern this Agreement. This Agreement constitutes the entire agreement between the Parties in connection with the subject matter hereof and supersedes all prior agreements, proposals and understandings, oral or written. No modification is valid unless made in writing by both Parties (email or text message is sufficient). If any provision is held invalid or unenforceable, the remaining provisions continue in full force and effect. Electronic signatures on this Agreement are binding.

---

## SIGNATURES

IN WITNESS WHEREOF, the Parties have signed this Agreement as of the date first above written.

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

Phone: {{renter_phone}}

Driver's license: {{renter_dl}}

Signature: _________________________

Date: _________________________
$tpl$
WHERE NOT EXISTS (
  SELECT 1 FROM public.lease_templates WHERE type = 'vehicle_rental_short' AND version = 2
);
