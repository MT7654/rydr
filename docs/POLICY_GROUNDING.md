# Ryde policy grounding

Rydr now supports versioned `ryde_official` packs in addition to `rydr_demo` and separately preserved `supplied_sample` packs. Official clauses are paraphrases with HTTPS links to Ryde's own websites and retrieval dates. Rydr safeguards have their own authority label. Policy text, source metadata and safeguards are frozen with the run snapshot, supplied to the agents, returned by the citation API and displayed in the case and outcome views.

The public **Policies** navigation page explains scope, sources, evidence safeguards and original demo rules. It reads immutable policy files only. It is available before login and to every demo role. Guided intake offers policy selection, booking type and fare type.

## Public sources checked 2 October 2026

- [Cancellation and Waiting Fee](https://help.rydesharing.com/hc/en-us/articles/23534478435353-Cancellation-and-Waiting-Fee): distinct on-demand and advance conditions, S$6.61 rider cancellation charge, more than three minutes for driver no-show cancellation, separate completed-trip waiting fee.
- [Unable to contact rider](https://help.rydesharing.com/hc/en-us/articles/115001438754-I-am-unable-to-contact-my-rider-The-rider-did-not-turn-up-What-should-I-do): attempt in-app contact; absence of contact evidence is not an official automatic-refund rule.
- [Preferred route](https://help.rydesharing.com/hc/en-us/articles/4412121982745-Can-I-suggest-my-preferred-route-to-the-driver): fixed fare and route agreement.
- [ERP/toll overcharge](https://help.rydesharing.com/hc/en-us/articles/30741244296217-I-was-overcharged-for-ERP-toll): generally fixed quoted fares except RydeTAXI, possible additional tolls, receipt breakdown.
- [Destination changes](https://help.rydesharing.com/hc/en-us/articles/50798691815449-Can-I-change-my-destination): accepted in-app changes recalculate the fare; exclusions apply. Public policy page gives effective date 17 October 2025; this is supporting context, not a no-show or cleaning effective date.
- [Driver cleaning claims](https://help.rydesharing.com/hc/en-us/articles/900004381243-My-Rider-Made-a-Mess): vehicle-plate photo, professional-cleaning receipt, cleaning within 24 hours and claim within 48 hours; review, exclusions and 24-hour driver appeal.
- [Rider cleaning charges](https://help.rydesharing.com/hc/en-us/articles/900003466206-I-made-a-mess-in-my-driver-s-vehicle): verified cleaning claims with tier caps, not automatic awards.

## Applicability and limits

The source pages did not establish an effective date for the cancellation and cleaning policies. Retrieval date is not asserted as an effective date. Older trips or missing dates require review when a historical policy version cannot be established. Inconsistent booking type, supplied historical policy, wrong charge basis, completed trips and missing explicit no-show cancellation also prevent an automatic official-policy outcome.

On-demand and advance no-show evaluation uses an explicit `driver_pressed_im_here` record and `driver_cancelled_no_show` record. Exactly 180 seconds does not satisfy **more than** 180 seconds. Advance arrival before scheduled pickup is a policy ambiguity requiring review. Rydr's 50 m GPS radius, 180-second continuity limit and evidence-quality gates are safeguards, not official rules. A simulated refund is Rydr's prototype proposal; real refunds remain subject to Ryde review and discretion.

Fixed-fare policy cases always require review. A distance flag is not an official refund formula. Cleaning cases always require review: pictures cannot establish responsibility, receipt validity or claim eligibility. Tier caps are not automatic monetary outcomes. The app does not automatically adjudicate cleaning submission deadlines or enforce account sanctions; it supplies the requirements to the agents and reviewer.

## Separate examples

| Case | Basis | Expected fixture workflow |
|---|---|---|
| SYN-011 | Public on-demand no-show snapshot | Supported no-show charge, simulated uphold |
| SYN-012 | Public advance no-show snapshot | Supported wait after scheduled pickup, simulated uphold |
| SYN-013 | Public fixed-fare policy | Review quote, accepted changes and surcharge |
| SYN-014 | Public cleaning-claim policy | Human verification of evidence and costs |

All four use synthetic rides dated 2 October 2026. DISP-002 and SYN-001–010 retain their original case and policy files. Existing recorded snapshots and decisions are preserved. Fresh visitor sessions start all cases Open.

Validation: strict waiting boundary, wrong/missing scope, charge mismatch, historical applicability, absent contact, advance early arrival, route/cleaning review, preserved original rules, source host validation, agent policy input and snapshot metadata. Existing visitor isolation and full workflow tests also pass. Browser validation uses fixture agents, not paid model calls.
