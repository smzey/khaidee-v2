/**
 * Read under a stall canopy in daylight, by someone with wet hands and a wok
 * going. Light and high-contrast for the same reason v1 was: dark themes wash
 * out outdoors. Targets are large because the vendor is not looking carefully.
 */
export const theme = {
  paper: '#FBFAF7',
  ink: '#16181C',
  stool: '#1B4FD8',
  chilli: '#D6202B',
  yolk: '#F5A524',
  rule: '#D9D5CC',
  muted: '#55585F',
  white: '#FFFFFF',
} as const;

/** Status drives the colour of the card's edge and its action. */
export const statusColour = {
  placed: theme.stool,
  accepted: theme.yolk,
  ready: theme.ink,
  completed: theme.muted,
  cancelled: theme.muted,
} as const;

/** What the vendor is being asked to do next, said as a verb. */
export const nextAction = {
  placed: 'Accept',
  accepted: 'Food is ready',
  ready: 'Finish',
} as const;
