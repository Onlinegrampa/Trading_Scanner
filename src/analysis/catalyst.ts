// ── Catalyst classifier ────────────────────────────────────────
// Pure function, no I/O. Tests each headline against Ross Cameron's
// catalyst hierarchy in order: strong → moderate → negative → neutral.

export type CatalystStrength = 'strong' | 'moderate' | 'negative' | 'neutral';

export interface CatalystInfo {
  type: string;
  strength: CatalystStrength;
}

// Each rule: [regex, type label, strength]
type Rule = [RegExp, string, CatalystStrength];

const RULES: Rule[] = [
  // ── STRONG (green) ─────────────────────────────────────────
  [/\bfda\b.*\b(approv|clear|grant)|approv.*\bfda\b|fast[- ]track|breakthrough\s+(therapy|designation)/i,
    'FDA', 'strong'],
  [/clinical\s+trial|phase\s+[123]\b|trial\s+results|topline\s+data|top[- ]line/i,
    'Clinical Trial', 'strong'],
  [/\bearnings\b|\bquarterly\b|\brevenue\b|\beps\b|\bbeat(s|ing)?\b|\bprofit\b|\bguidance\b/i,
    'Earnings', 'strong'],
  [/\bcontract\b.{0,60}\b(million|billion)|(\bmillion|\bbillion).{0,60}\bcontract\b/i,
    'Major Contract', 'strong'],
  [/\bipo\b|initial\s+public\s+offering|priced\s+its\s+ipo/i,
    'IPO', 'strong'],

  // ── MODERATE (yellow) ──────────────────────────────────────
  [/reverse\s+split|stock\s+split/i,
    'Reverse Split', 'moderate'],
  [/\bpartnership\b|\bcollaboration\b|\bagreement\b/i,
    'Partnership', 'moderate'],
  [/\bpatent\b|\btrademark\b|\bintellectual\s+property\b/i,
    'Patent', 'moderate'],
  [/\bacquisition\b|\bacquir(e|ed|ing)\b/i,
    'Acquisition', 'moderate'],
  [/short\s+squeeze|short\s+interest|heavily\s+shorted/i,
    'Short Squeeze', 'moderate'],

  // ── NEGATIVE (red) ─────────────────────────────────────────
  [/secondary\s+offering|direct\s+offering|public\s+offering|registered\s+direct|at[- ]the[- ]market\s+offering|atm\s+offering|bought\s+deal/i,
    '⚠ Offering', 'negative'],
  [/shelf\s+registration|\bs-3\b|\bs3\b/i,
    '⚠ Shelf Reg', 'negative'],
  [/\bdilution\b|\bdilutive\b/i,
    '⚠ Dilution', 'negative'],
  [/\bdelisting\b|non[- ]compliance\b|\bnasdaq.*deficiency|deficiency.*\bnasdaq\b/i,
    '⚠ Delisting', 'negative'],
  [/\bmerger\b.{0,60}\b(buyout|acqui)/i,
    '⚠ Buyout', 'negative'],

  // ── NEUTRAL (gray) ─────────────────────────────────────────
  [/\banalyst\b.{0,60}(price\s+target|upgrade|downgrade)|(upgrade|downgrade).{0,60}\banalyst\b/i,
    'Analyst', 'neutral'],
];

export function classifyHeadline(title: string, description = ''): CatalystInfo {
  const text = `${title} ${description}`;
  for (const [re, type, strength] of RULES) {
    if (re.test(text)) return { type, strength };
  }
  return { type: 'News', strength: 'neutral' };
}
