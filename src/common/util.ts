import { BadRequestException, Injectable, PipeTransform, SetMetadata } from '@nestjs/common';

/** Marks a route as reachable without being logged in. */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validates a 'YYYY-MM-DD' route/query parameter. */
@Injectable()
export class ParseIsoDatePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isIsoDate(value)) throw new BadRequestException(`"${value}" is not a date (expected YYYY-MM-DD)`);
    return value;
  }
}

/** Date arithmetic on 'YYYY-MM-DD' strings, in UTC so there are no timezone surprises. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

export const clampText = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '');
