import { describe, expect, it } from "vitest";
import { buildSearchResultLink } from "../../ui/searchNavigation";

describe("search navigation", () => {
  it("A2_builds_heading_aware_targets", () => {
    expect(
      buildSearchResultLink({
        notePath: "notes/semantic.md",
        heading: "Search heading"
      })
    ).toBe("notes/semantic.md#Search heading");

    expect(
      buildSearchResultLink({
        notePath: "notes/semantic.md",
        heading: "   Trimmed heading   "
      })
    ).toBe("notes/semantic.md#Trimmed heading");

    expect(
      buildSearchResultLink({
        notePath: "notes/semantic.md",
        heading: "   "
      })
    ).toBe("notes/semantic.md");
  });
});
