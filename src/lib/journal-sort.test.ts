import { describe, expect, it } from "vitest";

import { comparePositionValuesDescending } from "@/lib/journal-sort";

describe("comparePositionValuesDescending", () => {
  it("orders position values from highest to lowest", () => {
    const values = [125, 900, 350, 0];

    expect(values.sort(comparePositionValuesDescending)).toEqual([
      900,
      350,
      125,
      0,
    ]);
  });

  it("places unavailable values after known position values", () => {
    const positions = [
      { id: "missing-first", value: undefined },
      { id: "known-lower", value: 125 },
      { id: "missing-second", value: null },
      { id: "known-higher", value: 350 },
    ];

    expect(
      positions
        .sort((left, right) =>
          comparePositionValuesDescending(left.value, right.value),
        )
        .map(({ id }) => id),
    ).toEqual([
      "known-higher",
      "known-lower",
      "missing-first",
      "missing-second",
    ]);
  });
});
