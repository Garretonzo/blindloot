import { createTheme, MantineColorsTuple } from '@mantine/core';

/**
 * Site theme. Accent is teal; the dark ramp is a cool navy-tinted slate instead of Mantine's
 * neutral gray. The four tier colours (gray / blue / orange / grape) are reserved for
 * Transmog / Equip / Need / Dibs and are never used for chrome.
 */
const slate: MantineColorsTuple = [
  '#d3dae6', // 0 – text on dark
  '#a9b4c6',
  '#7f8da5',
  '#5d6b85',
  '#3a4660', // 4 – borders (hover)
  '#2b3649', // 5 – borders
  '#1f2838', // 6 – raised surfaces (cards)
  '#161d2b', // 7 – body
  '#0e1420', // 8 – deeper
  '#080c14', // 9 – deepest
];

export const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: 'md',
  fontFamily: 'Inter, Segoe UI, system-ui, -apple-system, sans-serif',
  headings: { fontWeight: '700' },
  colors: { dark: slate },
  components: {
    Card: { defaultProps: { withBorder: true, radius: 'md' } },
    Badge: { defaultProps: { radius: 'sm' } },
    Button: { defaultProps: { radius: 'md' } },
    Table: { defaultProps: { highlightOnHover: true } },
  },
});
