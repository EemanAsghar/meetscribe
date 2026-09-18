# Fixtures

`ami-es2011a.txt` is meeting ES2011a from the [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), a real recorded product-design kickoff meeting between four people. It is used to verify the ingest pipeline against real speech instead of tidy synthetic dialogue.

- Source: the `edinburghcstr/ami` dataset (`ihm` config, `validation` split), fetched through the Hugging Face dataset viewer API.
- Licence: CC BY 4.0. Credit: AMI Consortium, University of Edinburgh.
- Changes made: utterances sorted by start time, consecutive utterances by one speaker merged when less than 2 seconds apart, upper-case text lower-cased with the first letter capitalised, corpus speaker ids replaced by "Speaker A" to "Speaker D" in order of first appearance, start times written as `[mm:ss]`. No words were added, removed or corrected, so the disfluencies and recognition-style noise of real speech are all still there.

## seed/

Seven fictional, interrelated meetings of one invented company (Northwind, launching a product called Dispatch) between 2026-08-25 and 2026-09-17. They are the demo dataset. Every name, company and figure in them is made up. They were written by hand so that questions across meetings have real answers:

- **Launch date:** October 6 (kickoff) → October 20 (engineering sync: offline sync needs rebuilding) → October 27 (readiness check: payment certification date).
- **Starter price:** $29 (kickoff) → $39 (pricing review, after three customers said $29 looked too cheap), beta customers grandfathered for 12 months. Pro $59 → $65. Annual discount 20% → 15%.
- **Harbor Logistics:** discovery call (needs offline, SSO, proof of delivery; $40 a seat is approvable) → cited in the engineering sync and pricing review → letter of intent for 120 seats at the readiness check.
- **Bulk import:** in scope (kickoff) → probably out (engineering sync) → out of v1, replaced by "paste a list" (design review).

Timestamps were multiplied by 3 after writing so that meeting lengths (12 to 16 minutes) look plausible. `manifest.json` holds titles and dates. Load with `npx tsx scripts/seed-transcripts.ts`.
