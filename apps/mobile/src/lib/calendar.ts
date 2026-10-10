// A recurring bill or deposit as a calendar event (Phase 15g). Pure: the
// screen hands this to the phone's own "new event" screen (expo-calendar's
// system dialog, which needs no calendar permission), so the user picks the
// calendar — Google on Android, Apple's on iOS — and can edit before saving.

type Stream = {
  name: string;
  direction: 'outflow' | 'inflow';
  frequency: 'weekly' | 'biweekly' | 'monthly';
  average_amount: number;
  next_date: string;
};

export type CalendarEventDraft = {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: true;
  notes: string;
  recurrenceRule: { frequency: 'weekly' | 'monthly'; interval: number };
};

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** The next due date on or after today: a late charge's prediction rolls forward a cadence at a time. */
export function nextOnOrAfter(nextDate: string, frequency: Stream['frequency'], today: Date): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d = parse(nextDate);
  const day = d.getDate();
  for (let i = 0; d < start && i < 120; i++) {
    if (frequency === 'monthly') {
      // Keep the day of the month, clamped to short months (the 31st becomes the 30th, then the 31st again).
      const month = d.getMonth() + 1;
      const last = new Date(d.getFullYear(), month + 1, 0).getDate();
      d.setDate(1);
      d.setMonth(month);
      d.setDate(Math.min(day, last));
    } else {
      d.setDate(d.getDate() + (frequency === 'weekly' ? 7 : 14));
    }
  }
  return d;
}

export function eventFor(stream: Stream, displayName: string, today = new Date()): CalendarEventDraft {
  const start = nextOnOrAfter(stream.next_date, stream.frequency, today);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const amount = Math.abs(stream.average_amount).toFixed(2);
  const paid = stream.direction === 'outflow';
  return {
    title: paid ? `${displayName} bill` : `${displayName} deposit`,
    startDate: start,
    endDate: end,
    allDay: true,
    notes: `About $${amount}, ${stream.frequency === 'biweekly' ? 'every 2 weeks' : stream.frequency}. Added from Tusky.`,
    recurrenceRule:
      stream.frequency === 'monthly'
        ? { frequency: 'monthly', interval: 1 }
        : { frequency: 'weekly', interval: stream.frequency === 'biweekly' ? 2 : 1 },
  };
}
