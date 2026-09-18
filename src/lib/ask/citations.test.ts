import { describe, expect, it } from "vitest";
import { NOT_FOUND, bestSegment, validateAnswer } from "./citations";

describe("validateAnswer", () => {
  it("keeps citations that point at a retrieved source", () => {
    const r = validateAnswer("The price is 25 euros [1]. Profit aim is 50 million [2].", 3);
    expect(r.text).toBe("The price is 25 euros [1]. Profit aim is 50 million [2].");
    expect(r.cited).toEqual([1, 2]);
    expect(r.removed).toBe(0);
  });

  it("strips citations to sources that were never retrieved", () => {
    const r = validateAnswer("The launch moved to March [7]. It was April before [2].", 3);
    expect(r.text).toBe("The launch moved to March. It was April before [2].");
    expect(r.cited).toEqual([2]);
    expect(r.removed).toBe(1);
  });

  it("splits grouped citations and validates each number", () => {
    const r = validateAnswer("Both agreed [1, 9][2,3].", 3);
    expect(r.text).toBe("Both agreed [1][2][3].");
    expect(r.cited).toEqual([1, 2, 3]);
    expect(r.removed).toBe(1);
  });

  it("collapses a citation repeated back to back", () => {
    expect(validateAnswer("A light or vibration cue [3][3] and a clip [3][9][3].", 9).text).toBe("A light or vibration cue [3] and a clip [3][9].");
    expect(validateAnswer("Grouped [2, 2, 5].", 9).text).toBe("Grouped [2][5].");
  });

  it("does not leave a space before punctuation when a citation is removed", () => {
    expect(validateAnswer("It slipped [12].", 2).text).toBe("It slipped.");
    expect(validateAnswer("It slipped [12], twice [1].", 2).text).toBe("It slipped, twice [1].");
  });

  it("ignores brackets that are not citations", () => {
    const r = validateAnswer("She said [laughs] it was fine [1].", 2);
    expect(r.text).toBe("She said [laughs] it was fine [1].");
    expect(r.cited).toEqual([1]);
  });

  it("treats [0] and negative-looking numbers as invalid", () => {
    expect(validateAnswer("Zero [0] is not a source.", 3).cited).toEqual([]);
  });

  it("flags an answer with claims but no surviving citation as ungrounded", () => {
    expect(validateAnswer("The budget is 12 euros [9].", 3).grounded).toBe(false);
    expect(validateAnswer("The budget is 12 euros [1].", 3).grounded).toBe(true);
  });

  it("accepts the not-found reply without citations", () => {
    expect(validateAnswer(NOT_FOUND, 3).grounded).toBe(true);
  });
});

describe("bestSegment", () => {
  const segments = [
    { idx: 10, speaker: "A", startMs: 1000, text: "Okay so moving on" },
    { idx: 11, speaker: "A", startMs: 2000, text: "Our selling price goal is twenty five euro and profit aim is fifty million euro" },
    { idx: 12, speaker: "C", startMs: 3000, text: "Yeah" },
    { idx: 13, speaker: "B", startMs: 4000, text: "We should have a call button on the television to find the remote" },
  ];

  it("picks the line that shares the most meaningful words with the sentence", () => {
    expect(bestSegment("The selling price goal is twenty five euro.", segments)?.idx).toBe(11);
    expect(bestSegment("Someone suggested a call button on the television.", segments)?.idx).toBe(13);
  });

  it("matches digits in the answer to numbers spoken as words, and plurals to singulars", () => {
    const chunk = [
      { idx: 1, speaker: "B", startMs: 1000, text: "Um I don't really know how the legs go but anyway I will do that" },
      { idx: 2, speaker: "A", startMs: 2000, text: "Our selling price goal is twenty five euro and profit aim is fifty million euro" },
    ];
    expect(bestSegment("The meeting transcript initially stated 25 euros", chunk)?.idx).toBe(2);
    expect(bestSegment("They are aiming for 50 million in profit", chunk)?.idx).toBe(2);
  });

  it("never picks a filler line when a substantive one exists", () => {
    expect(bestSegment("Yeah they agreed about the remote.", segments)?.idx).toBe(13);
  });

  it("falls back to the first substantive line when nothing overlaps", () => {
    // idx 10 ("Okay so moving on") has one meaningful word, so it counts as filler and idx 11 is the first real line.
    expect(bestSegment("Completely unrelated wording here.", segments)?.idx).toBe(11);
  });

  it("returns null when the chunk has no segments (a Scratchpad note)", () => {
    expect(bestSegment("anything", [])).toBeNull();
  });
});
