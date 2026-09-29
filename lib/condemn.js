// condemn.js — the Condemn-o-meter.
// Scores the strength of a diplomatic reaction from its wording alone.
// It measures words, not deeds: "categorically condemn" followed by
// continued arms sales still scores 4. That gap is the point.

const LEVELS = [
  { level: 4, label: 'categorically condemns', re: /\b(categorically|unequivocally|utterly|unreservedly|in the strongest (possible )?terms)\b/i },
  { level: 3, label: 'strongly condemns', re: /\b(strongly condemn|appall|horrif|outrage|abhorren|unacceptable|intolerable|unjustifiable|indefensible)/i },
  { level: 2, label: 'condemns', re: /\bcondemn/i },
  { level: 1, label: 'is concerned', re: /\b(concern|deeply troubl|shock|sadden|regret|urge|call(s|ed)? (on|for))/i },
];

export function condemnLevel(text = '') {
  for (const l of LEVELS) if (l.re.test(text)) return { level: l.level, label: l.label };
  return { level: 0, label: 'says something' };
}

export const MAX_LEVEL = 4;
