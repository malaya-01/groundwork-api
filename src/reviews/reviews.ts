import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Put } from '@nestjs/common';
import { IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Between, DataSource } from 'typeorm';
import { AppUser, DailyLog, MetricEntry, MonthlyReview, WeeklyReview, YearlyReview } from '../db/entities';
import { LogView, LogsModule, LogsService, floorDone } from '../logs/logs';
import { ParseIsoDatePipe, addDays, mondayOf } from '../common/util';

// ---------- stats computed from the daily pages ----------
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
const count = (l: LogView, code: 'a' | 'b', outcome: 'rode' | 'wiped') =>
  l.waves.filter((w) => w.code === code && w.outcome === outcome).length;
const meals = (l: LogView) => Object.values(l.meals);

export function periodStats(logs: LogView[]) {
  return {
    loggedDays: logs.length,
    floorDays: logs.filter(floorDone).length,
    studyMinutes: sum(logs.map((l) => l.studyMinutes)),
    soloSolved: sum(logs.map((l) => l.problems.filter((p) => p.solo).length)),
    aiUsedDays: logs.filter((l) => l.aiUsed === true).length,
    walkMinutes: sum(logs.map((l) => l.walkMinutes)),
    physioDays: logs.filter((l) => l.physio).length,
    avgPain: avg(logs.map((l) => l.pain)),
    avgSleep: avg(logs.map((l) => l.sleptHours)),
    avgMood: avg(logs.map((l) => l.mood)),
    mealsOnPlan: sum(logs.map((l) => meals(l).filter((m) => m.onPlan === true).length)),
    mealsLogged: sum(logs.map((l) => meals(l).filter((m) => m.what || m.time).length)),
    medsDoses: sum(logs.map((l) => [l.meds.am, l.meds.pm, l.meds.night].filter(Boolean).length)),
    breathlessDays: logs.filter((l) => l.breathless === true).length,
    wavesA: { rode: sum(logs.map((l) => count(l, 'a', 'rode'))), wiped: sum(logs.map((l) => count(l, 'a', 'wiped'))) },
    wavesB: { rode: sum(logs.map((l) => count(l, 'b', 'rode'))), wiped: sum(logs.map((l) => count(l, 'b', 'wiped'))) },
    aClearDays: logs.filter((l) => count(l, 'a', 'wiped') === 0).length,
    bClearDays: logs.filter((l) => count(l, 'b', 'wiped') === 0).length,
  };
}

/** One column of the monthly habit grid. */
function habitsOf(l: LogView) {
  const logged = meals(l).filter((x) => x.what || x.time);
  return {
    date: l.date,
    floorCode: l.floorCode,
    floorWalk: l.floorWalk,
    floorPage: l.floorPage,
    physio: l.physio,
    meds: l.meds.am || l.meds.pm || l.meds.night,
    mealsOnPlan: logged.length > 0 && logged.every((x) => x.onPlan === true),
    study60: (l.studyMinutes ?? 0) >= 60,
    aClear: count(l, 'a', 'wiped') === 0,
    bClear: count(l, 'b', 'wiped') === 0,
  };
}

// ---------- DTOs ----------
const MAX_JSON = 100_000;
function checkJson(v: unknown, field: string) {
  if (v !== undefined && JSON.stringify(v).length > MAX_JSON) throw new BadRequestException(`${field} is too large`);
}

class WeekDto {
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) spent?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) sentSaved?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(1000) confidenceReps?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(20) @Max(400) weightKg?: number | null;
  @IsOptional() @IsString() @MaxLength(500000) notes?: string;
}

class MonthDto {
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
  @IsOptional() @IsObject() scorecard?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500000) notes?: string;
}

class YearDto {
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500000) notes?: string;
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const isEmptyHtml = (html: string) => !html || html.replace(/<p>\s*<\/p>/g, '').trim() === '';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly ds: DataSource,
    private readonly logs: LogsService,
  ) {}

  private weights(from: string, to: string) {
    return this.ds.getRepository(MetricEntry).find({
      where: { key: 'weight_kg', recordedOn: Between(from, to) },
      order: { recordedOn: 'ASC' },
    });
  }

  // ----- week -----
  async week(anyDate: string) {
    const start = mondayOf(anyDate);
    const end = addDays(start, 6);
    const [logs, row, weight] = await Promise.all([
      this.logs.list(start, end),
      this.ds.getRepository(WeeklyReview).findOneBy({ weekStart: start }),
      this.ds.getRepository(MetricEntry).findOneBy({ key: 'weight_kg', recordedOn: end }),
    ]);
    return {
      weekStart: start,
      weekEnd: end,
      stats: periodStats(logs),
      weightKg: weight?.value ?? null,
      exists: !!row,
      answers: row?.answers ?? {},
      spent: row?.spent ?? null,
      sentSaved: row?.sentSaved ?? null,
      confidenceReps: row?.confidenceReps ?? null,
      notes: row?.notes ?? '',
    };
  }

  async putWeek(anyDate: string, dto: WeekDto) {
    checkJson(dto.answers, 'answers');
    const start = mondayOf(anyDate);
    await this.ds.transaction(async (m) => {
      const row = (await m.findOneBy(WeeklyReview, { weekStart: start })) ?? m.create(WeeklyReview, { weekStart: start });
      if (dto.answers !== undefined) row.answers = dto.answers;
      if (dto.spent !== undefined) row.spent = dto.spent;
      if (dto.sentSaved !== undefined) row.sentSaved = dto.sentSaved;
      if (dto.confidenceReps !== undefined) row.confidenceReps = dto.confidenceReps;
      if (dto.notes !== undefined) row.notes = dto.notes;
      await m.save(WeeklyReview, row);
      // The weekly weigh-in is stored as a measurement on the Sunday that ends the week.
      if (dto.weightKg !== undefined) {
        const sunday = addDays(start, 6);
        if (dto.weightKg === null) await m.delete(MetricEntry, { key: 'weight_kg', recordedOn: sunday });
        else await m.upsert(MetricEntry, { key: 'weight_kg', recordedOn: sunday, value: dto.weightKg }, ['key', 'recordedOn']);
      }
    });
    return this.week(start);
  }

  // ----- month -----
  async month(month: string) {
    if (!YM.test(month)) throw new BadRequestException('month must be YYYY-MM');
    const from = `${month}-01`;
    const to = lastDayOf(month);
    const [logs, row, weights] = await Promise.all([
      this.logs.list(from, to),
      this.ds.getRepository(MonthlyReview).findOneBy({ month: from }),
      this.weights(from, to),
    ]);
    return {
      month,
      from,
      to,
      stats: periodStats(logs),
      habits: logs.map(habitsOf),
      weights: weights.map((w) => ({ date: w.recordedOn, value: w.value })),
      exists: !!row,
      answers: row?.answers ?? {},
      scorecard: row?.scorecard ?? {},
      notes: row?.notes ?? '',
    };
  }

  async putMonth(month: string, dto: MonthDto) {
    if (!YM.test(month)) throw new BadRequestException('month must be YYYY-MM');
    checkJson(dto.answers, 'answers');
    checkJson(dto.scorecard, 'scorecard');
    const repo = this.ds.getRepository(MonthlyReview);
    const from = `${month}-01`;
    const row = (await repo.findOneBy({ month: from })) ?? repo.create({ month: from });
    if (dto.answers !== undefined) row.answers = dto.answers;
    if (dto.scorecard !== undefined) row.scorecard = dto.scorecard;
    if (dto.notes !== undefined) row.notes = dto.notes;
    await repo.save(row);
    return this.month(month);
  }

  // ----- year -----
  async year(year: number) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [logs, row, weights] = await Promise.all([
      this.logs.list(from, to),
      this.ds.getRepository(YearlyReview).findOneBy({ year }),
      this.weights(from, to),
    ]);
    const months = Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
      const mw = weights.filter((w) => w.recordedOn.startsWith(ym));
      return { month: ym, ...periodStats(logs.filter((l) => l.date.startsWith(ym))), weightEnd: mw.length ? mw[mw.length - 1].value : null };
    });
    return {
      year,
      stats: periodStats(logs),
      months,
      weightStart: weights[0]?.value ?? null,
      weightEnd: weights.length ? weights[weights.length - 1].value : null,
      exists: !!row,
      answers: row?.answers ?? {},
      notes: row?.notes ?? '',
    };
  }

  async putYear(year: number, dto: YearDto) {
    checkJson(dto.answers, 'answers');
    const repo = this.ds.getRepository(YearlyReview);
    const row = (await repo.findOneBy({ year })) ?? repo.create({ year });
    if (dto.answers !== undefined) row.answers = dto.answers;
    if (dto.notes !== undefined) row.notes = dto.notes;
    await repo.save(row);
    return this.year(year);
  }

  /**
   * Every year-book: start year → this year, any year with pages, and books the user created.
   * Used by the 3D universe (one orbiting book per entry).
   */
  async books() {
    const table = this.ds.getRepository(DailyLog).metadata.tablePath;
    const rows: { year: number; pages: number; floor_days: number; notes: number }[] = await this.ds.query(
      `SELECT EXTRACT(YEAR FROM log_date)::int AS year,
              count(*)::int AS pages,
              count(*) FILTER (WHERE floor_code AND floor_walk AND floor_page)::int AS floor_days,
              count(*) FILTER (WHERE notes <> '' AND notes <> '<p></p>')::int AS notes
       FROM ${table} GROUP BY 1 ORDER BY 1`,
    );
    const [user] = await this.ds.getRepository(AppUser).find({ take: 1 });
    const created = user?.settings?.books ?? [];
    const startYear = Number((user?.settings?.startDate ?? '2026-11-16').slice(0, 4));
    const thisYear = new Date().getUTCFullYear();
    const years = new Set<number>([...created, ...rows.map((r) => r.year)]);
    for (let y = Math.min(startYear, thisYear); y <= thisYear; y++) years.add(y);
    return [...years]
      .sort((a, b) => a - b)
      .map((year) => {
        const r = rows.find((x) => x.year === year);
        return { year, pages: r?.pages ?? 0, floorDays: r?.floor_days ?? 0, notes: r?.notes ?? 0 };
      });
  }

  /** Table of contents for one year's book: which pages have something written on them. */
  async book(year: number) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [days, weeks, months, yr] = await Promise.all([
      this.ds.getRepository(DailyLog).find({
        select: { logDate: true, floorCode: true, floorWalk: true, floorPage: true, notes: true },
        where: { logDate: Between(from, to) },
      }),
      this.ds.getRepository(WeeklyReview).find({ select: { weekStart: true }, where: { weekStart: Between(addDays(from, -6), to) } }),
      this.ds.getRepository(MonthlyReview).find({ select: { month: true }, where: { month: Between(from, to) } }),
      this.ds.getRepository(YearlyReview).existsBy({ year }),
    ]);
    return {
      year,
      days: Object.fromEntries(
        days.map((d) => [d.logDate, { floor: Number(d.floorCode) + Number(d.floorWalk) + Number(d.floorPage), hasNotes: !isEmptyHtml(d.notes) }]),
      ),
      weeks: weeks.map((w) => w.weekStart),
      months: months.map((m) => m.month.slice(0, 7)),
      yearReviewed: yr,
    };
  }
}

const parseYear = new ParseIntPipe();
const checkYear = (y: number) => {
  if (y < 2000 || y > 2200) throw new BadRequestException('year out of range');
  return y;
};

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('reviews/week/:date')
  week(@Param('date', ParseIsoDatePipe) date: string) {
    return this.reviews.week(date);
  }

  @Put('reviews/week/:date')
  putWeek(@Param('date', ParseIsoDatePipe) date: string, @Body() dto: WeekDto) {
    return this.reviews.putWeek(date, dto);
  }

  @Get('reviews/month/:month')
  month(@Param('month') month: string) {
    return this.reviews.month(month);
  }

  @Put('reviews/month/:month')
  putMonth(@Param('month') month: string, @Body() dto: MonthDto) {
    return this.reviews.putMonth(month, dto);
  }

  @Get('reviews/year/:year')
  year(@Param('year', parseYear) year: number) {
    return this.reviews.year(checkYear(year));
  }

  @Put('reviews/year/:year')
  putYear(@Param('year', parseYear) year: number, @Body() dto: YearDto) {
    return this.reviews.putYear(checkYear(year), dto);
  }

  @Get('books')
  books() {
    return this.reviews.books();
  }

  @Get('book/:year')
  book(@Param('year', parseYear) year: number) {
    return this.reviews.book(checkYear(year));
  }
}

@Module({ imports: [LogsModule], controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
