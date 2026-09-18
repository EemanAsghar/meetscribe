# Fixtures

`ami-es2011a.txt` is meeting ES2011a from the [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), a real recorded product-design kickoff meeting between four people. It is used to verify the ingest pipeline against real speech instead of tidy synthetic dialogue.

- Source: the `edinburghcstr/ami` dataset (`ihm` config, `validation` split), fetched through the Hugging Face dataset viewer API.
- Licence: CC BY 4.0. Credit: AMI Consortium, University of Edinburgh.
- Changes made: utterances sorted by start time, consecutive utterances by one speaker merged when less than 2 seconds apart, upper-case text lower-cased with the first letter capitalised, corpus speaker ids replaced by "Speaker A" to "Speaker D" in order of first appearance, start times written as `[mm:ss]`. No words were added, removed or corrected, so the disfluencies and recognition-style noise of real speech are all still there.
