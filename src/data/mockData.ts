import type { Message, Participant, SideRole } from '@/types';

/**
 * PHASE 1 NOTICE — this file is placeholder conversation history so the chat
 * UI has something real to render while it's being designed and reviewed.
 * Phase 2 replaces it with message history fetched from the backend, kept
 * in sync in realtime, and paginated as the user scrolls up.
 */

export const PARTICIPANTS: Record<SideRole, Participant> = {
  A: { role: 'A', name: 'A', initials: 'A', isOnline: true, lastSeenAt: Date.now() },
  B: {
    role: 'B',
    name: 'B',
    initials: 'B',
    isOnline: false,
    lastSeenAt: Date.now() - 1000 * 60 * 42,
  },
};

const day = 86_400_000;
const hour = 3_600_000;
const minute = 60_000;
const now = Date.now();

export function createMockMessages(): Message[] {
  const t = (offset: number) => now - offset;

  return [
    {
      id: 'm1',
      senderRole: 'B',
      text: "hey — made it in okay, the wifi here is finally cooperating",
      createdAt: t(2 * day + 3 * hour),
      status: 'read',
    },
    {
      id: 'm2',
      senderRole: 'A',
      text: 'good!! send a photo when you get a sec, I want to see the view',
      createdAt: t(2 * day + 2 * hour + 50 * minute),
      status: 'read',
    },
    {
      id: 'm3',
      senderRole: 'B',
      text: 'later I promise, unpacking chaos rn',
      createdAt: t(2 * day + 2 * hour + 40 * minute),
      status: 'read',
    },
    {
      id: 'm4',
      senderRole: 'A',
      text: 'no rush. proud of you for the trip btw',
      createdAt: t(1 * day + 5 * hour),
      status: 'read',
    },
    {
      id: 'm5',
      senderRole: 'B',
      text: 'stop it you\'re gonna make me emotional in an airport',
      createdAt: t(1 * day + 4 * hour + 58 * minute),
      status: 'read',
    },
    {
      id: 'm6',
      senderRole: 'B',
      text: 'ok landed. still love you the most',
      createdAt: t(3 * hour + 12 * minute),
      status: 'read',
    },
    {
      id: 'm7',
      senderRole: 'A',
      text: 'the most 🫶',
      createdAt: t(3 * hour + 10 * minute),
      status: 'read',
    },
    {
      id: 'm8',
      senderRole: 'A',
      text: 'call tonight?',
      createdAt: t(40 * minute),
      status: 'delivered',
    },
    {
      id: 'm9',
      senderRole: 'B',
      text: 'yes — 9?',
      createdAt: t(38 * minute),
      status: 'read',
    },
  ];
}
