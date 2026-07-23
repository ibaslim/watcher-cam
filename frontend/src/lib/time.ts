export const PORTAL_TIME_ZONE = "Asia/Karachi";
export const PORTAL_TIME_ZONE_LABEL = "PKT";

export function formatPortalDateTime(value: string | number | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: PORTAL_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatPortalClock(value: string | number | Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: PORTAL_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function portalTodayDateInput(): string {
  return portalDateInput(new Date());
}

export function portalDateInput(value: string | number | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isPortalToday(value: string | number | Date): boolean {
  return portalDateInput(value) === portalTodayDateInput();
}

export function portalTodayApiRange(): { date_from: string; date_to: string } {
  const today = portalTodayDateInput();

  return {
    date_from: `${today}T00:00:00`,
    date_to: `${today}T23:59:59.999`,
  };
}
