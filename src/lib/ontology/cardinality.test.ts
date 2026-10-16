import { describe, expect, it } from "vitest";
import { edgeEndLabels } from "./cardinality";

describe("edgeEndLabels", () => {
  it("puts the many side on the FK-holding (source) table for 1:N", () => {
    // users.organization_id -> organizations.id : one organization has many users
    expect(edgeEndLabels("1:N")).toEqual({ source: "N", target: "1" });
  });

  it("labels both ends 1 for 1:1", () => {
    expect(edgeEndLabels("1:1")).toEqual({ source: "1", target: "1" });
  });

  it("labels M:N ends as many on both sides", () => {
    expect(edgeEndLabels("M:N")).toEqual({ source: "M", target: "N" });
  });
});
