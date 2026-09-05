export function comparePositionValuesDescending(
  leftValue: number | null | undefined,
  rightValue: number | null | undefined,
) {
  const leftIsFinite =
    typeof leftValue === "number" && Number.isFinite(leftValue);
  const rightIsFinite =
    typeof rightValue === "number" && Number.isFinite(rightValue);

  if (!leftIsFinite) return rightIsFinite ? 1 : 0;
  if (!rightIsFinite) return -1;
  return rightValue - leftValue;
}
