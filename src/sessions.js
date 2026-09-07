export const SESSION_CHOICES = [
  {
    date: '2026-10-09',
    label: '10/09（五）18:00',
    internalSessionId: 's000002148',
    publicSessionId: '7ebb6639e8b6999bff41373658ce2a5f',
  },
  {
    date: '2026-10-10',
    label: '10/10（六）18:00',
    internalSessionId: 's000002145',
    publicSessionId: 'fb27482abcd73b065203b670d5416da6',
  },
  {
    date: '2026-10-11',
    label: '10/11（日）18:00',
    internalSessionId: 's000002147',
    publicSessionId: 'ae5f1bb499ac4f27d865cd0ff92685b2',
  },
];

export const SEATING_MODES = [
  {
    id: 'adjacent-only',
    label: '一定要連號（無連號就停止）',
  },
  {
    id: 'adjacent-preferred',
    label: '連號優先（沒有連號就接受不連號）',
  },
  {
    id: 'any',
    label: '可不連號（速度優先）',
  },
];

export function findSessionByDate(date) {
  return SESSION_CHOICES.find((session) => session.date === date) || null;
}

export function parseDateArgument(args) {
  const equalsArgument = args.find((argument) => argument.startsWith('--date='));
  if (equalsArgument) return equalsArgument.slice('--date='.length);

  const index = args.indexOf('--date');
  return index >= 0 ? args[index + 1] || null : null;
}

export function normalizeSeatingMode(value, legacyAllowNonAdjacent = false) {
  if (!value) return legacyAllowNonAdjacent ? 'any' : 'adjacent-preferred';
  const normalized = value.toLowerCase();
  if (!SEATING_MODES.some((mode) => mode.id === normalized)) {
    throw new Error(`Unsupported SEATING_MODE: ${value}`);
  }
  return normalized;
}

export function updateEnvValues(contents, updates) {
  let result = contents;
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(result)) result = result.replace(pattern, `${key}=${value}`);
    else result = result
      ? `${result.trimEnd()}\n${key}=${value}\n`
      : `${key}=${value}\n`;
  }
  return result;
}

export function updateEnvSession(contents, session) {
  return updateEnvValues(contents, {
    TARGET_DATE: session.date,
    INTERNAL_SESSION_ID: session.internalSessionId,
  });
}
