// Signed-document dates are derived only from persisted signing timestamps.
// UTC makes the displayed calendar date stable across devices and time zones.
export function agreementSignedDate(value?: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC',
  }).format(date) + ' UTC';
}
