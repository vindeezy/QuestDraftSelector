/**
 * `1` -> "1st", `2` -> "2nd", and so on.
 *
 * Only ever called with 1..10 in this app, but written generally rather than as a
 * ten-entry lookup table. Lives here rather than inside a screen because both the
 * "what to expect" points table and the scoreboards render finishing places, and a
 * second copy would be a second thing to get wrong.
 */
export function ordinal(place: number): string {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}
