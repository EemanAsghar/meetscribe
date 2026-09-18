import { describe, expect, it } from "vitest";
import { fuse } from "./fuse";

const c = (id: string, meetingId = "m1") => ({ id, meetingId });

describe("fuse (reciprocal rank fusion)", () => {
  it("ranks a chunk found by both searches above one found by a single search", () => {
    const out = fuse([c("a"), c("b"), c("c")], [c("c"), c("d")], { limit: 10, perMeeting: 10 });
    expect(out[0].id).toBe("c");
  });

  it("keeps each chunk once", () => {
    const out = fuse([c("a"), c("b")], [c("b"), c("a")], { limit: 10, perMeeting: 10 });
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("caps chunks per meeting so one long call cannot crowd out the others", () => {
    const vector = [c("a1", "A"), c("a2", "A"), c("a3", "A"), c("a4", "A"), c("a5", "A"), c("b1", "B")];
    const out = fuse(vector, [], { limit: 10, perMeeting: 4 });
    expect(out.filter((x) => x.meetingId === "A")).toHaveLength(4);
    expect(out.map((x) => x.id)).toContain("b1");
  });

  it("respects the overall limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => c(`x${i}`, `m${i}`));
    expect(fuse(many, [], { limit: 8, perMeeting: 4 })).toHaveLength(8);
  });

  it("works with only keyword results (embeddings unavailable)", () => {
    expect(fuse([], [c("k1"), c("k2")], { limit: 10, perMeeting: 4 }).map((x) => x.id)).toEqual(["k1", "k2"]);
  });

  it("returns nothing for nothing", () => {
    expect(fuse([], [], { limit: 10, perMeeting: 4 })).toEqual([]);
  });
});
