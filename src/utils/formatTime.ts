const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

export function formatMessageTime(epochMs: number): string {
  return timeFormatter.format(new Date(epochMs));
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDateSeparator(epochMs: number, now: Date = new Date()): string {
  const date = new Date(epochMs);

  if (isSameDay(date, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  const daysAgo = Math.round((now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (daysAgo >= 0 && daysAgo < 7) return weekdayFormatter.format(date);

  return fullDateFormatter.format(date);
}

export function formatLastSeen(epochMs: number | null, now: Date = new Date()): string {
  if (epochMs === null) return 'offline';

  const diffMs = now.getTime() - epochMs;
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'last seen just now';
  if (diffMinutes < 60) return `last seen ${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `last seen ${diffHours}h ago`;

  if (isSameDay(new Date(epochMs), new Date(now.getTime() - 86_400_000))) {
    return `last seen yesterday at ${formatMessageTime(epochMs)}`;
  }

  return `last seen ${fullDateFormatter.format(new Date(epochMs))}`;
}

/** Groups messages into same-day buckets in the order provided (ascending time expected). */
export function groupByDay<T extends { createdAt: number }>(items: T[]): { dayKey: string; items: T[] }[] {
  const groups: { dayKey: string; items: T[] }[] = [];

  for (const item of items) {
    const date = new Date(item.createdAt);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const lastGroup = groups.at(-1);

    if (lastGroup && lastGroup.dayKey === dayKey) {
      lastGroup.items.push(item);
    } else {
      groups.push({ dayKey, items: [item] });
    }
  }

  return groups;
}
