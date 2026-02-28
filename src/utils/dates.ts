/**
 * Date utilities for timezone-aware calculations.
 * All "calendar day" logic uses America/Chicago (Central Time) to match
 * the MLS market area, ensuring days-on-market reflects local business days
 * rather than elapsed 24-hour UTC periods.
 */

const CHICAGO_TZ = 'America/Chicago';

/**
 * Returns a YYYY-MM-DD string for the given Date in Chicago local time.
 * Using 'en-CA' locale produces ISO-style YYYY-MM-DD output natively.
 */
function toChicagoDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: CHICAGO_TZ });
}

/**
 * Calculates days on market as whole calendar days in Chicago timezone.
 *
 * Uses calendar-day subtraction rather than elapsed milliseconds so that a
 * listing entered on Feb 26 at 11 PM CST correctly shows 2 days on Feb 28,
 * regardless of how many hours have actually elapsed.
 *
 * @param originalEntryTs - ISO timestamp string (with or without timezone offset)
 * @returns Number of calendar days since the listing entered the market, or null
 */
export function calcDaysOnMarket(originalEntryTs: string | null | undefined): number | null {
  if (!originalEntryTs) return null;

  const entryDate = new Date(originalEntryTs);
  const today = new Date();

  // Convert both to Chicago calendar dates (YYYY-MM-DD), then diff as UTC midnight values
  const entryDay = new Date(toChicagoDateString(entryDate) + 'T00:00:00Z');
  const todayDay = new Date(toChicagoDateString(today) + 'T00:00:00Z');

  return Math.round((todayDay.getTime() - entryDay.getTime()) / (1000 * 60 * 60 * 24));
}
