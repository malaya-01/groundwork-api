import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Put, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Between, DataSource } from 'typeorm';
import { DailyLog, Meal, Meals, Meds, Problem, WaveEntry } from '../db/entities';
import { MapsModule, MapsService } from '../maps/maps';
import { AuthModule, AuthService } from '../auth/auth';
import { ParseIsoDatePipe, addDays, clampText, isIsoDate } from '../common/util';

export const TRIGGERS = ['A', 'L', 'B', 'S', 'T', 'Sc', 'P', 'W', 'O'] as const;
const MEAL_KEYS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

// Every field optional: the client sends only what changed (null clears a value).
export class LogDto {
  @IsOptional() @IsBoolean() floorCode?: boolean;
  @IsOptional() @IsBoolean() floorWalk?: boolean;
  @IsOptional() @IsBoolean() floorPage?: boolean;
  @IsOptional() @IsString() @MaxLength(20) woke?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(24) sleptHours?: number | null;
  @IsOptional() @IsString() @MaxLength(500) oneThing?: string;
  @IsOptional() @IsString() @MaxLength(300) studyTopic?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(1440) studyMinutes?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean() aiUsed?: boolean | null;
  @IsOptional() @IsString() @MaxLength(10000) learned?: string;
  @IsOptional() @IsString() @MaxLength(5000) stuck?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) problems?: unknown[];
  @IsOptional() @IsObject() meals?: Record<string, unknown>;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(1440) walkMinutes?: number | null;
  @IsOptional() @IsBoolean() physio?: boolean;
  @IsOptional() @IsObject() meds?: Record<string, unknown>;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(10) pain?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean() breathless?: boolean | null;
  @IsOptional() @IsString() @MaxLength(1000) breathlessNote?: string;
  @IsOptional() @IsString() @MaxLength(1000) win?: string;
  @IsOptional() @IsString() @MaxLength(1000) tomorrowFirst?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(5) mood?: number | null;
  @IsOptional() @IsString() @MaxLength(500000) notes?: string; // back of the page: rich-text HTML
  @IsOptional() @IsArray() @ArrayMaxSize(30) waves?: unknown[];
}

// Plain fields copied straight from the DTO onto the entity.
const SIMPLE_FIELDS = [
  'floorCode', 'floorWalk', 'floorPage', 'woke', 'sleptHours', 'oneThing', 'studyTopic', 'studyMinutes',
  'aiUsed', 'learned', 'stuck', 'walkMinutes', 'physio', 'pain', 'breathless', 'breathlessNote', 'win',
  'tomorrowFirst', 'mood', 'notes',
] as const;

export interface Wave {
  code: 'a' | 'b';
  time: string;
  triggers: string[];
  action: string;
  outcome: 'rode' | 'wiped';
}

// Normalise the free-form JSON parts so only known shapes reach the database.
const cleanProblems = (v: unknown[]): Problem[] =>
  v
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({ name: clampText(p.name, 200), solo: p.solo === true }));

const cleanMeals = (v: Record<string, unknown> = {}): Meals => {
  const out = {} as Meals;
  for (const k of MEAL_KEYS) {
    const m = (v[k] ?? {}) as Record<string, unknown>;
    out[k] = { time: clampText(m.time, 10), what: clampText(m.what, 300), onPlan: typeof m.onPlan === 'boolean' ? m.onPlan : null } as Meal;
  }
  return out;
};

const cleanMeds = (v: Record<string, unknown> = {}): Meds => ({ am: v.am === true, pm: v.pm === true, night: v.night === true });

const cleanWaves = (v: unknown[]): Wave[] =>
  v
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map((w) => ({
      code: w.code === 'b' ? 'b' : 'a',
      time: clampText(w.time, 10),
      triggers: Array.isArray(w.triggers)
        ? w.triggers.filter((t): t is string => (TRIGGERS as readonly string[]).includes(t as string))
        : [],
      action: clampText(w.action, 300),
      outcome: w.outcome === 'wiped' ? 'wiped' : 'rode',
    }));

/** The shape the API returns for one day (front + back of the page). */
function emptyView(date: string) {
  return {
    date,
    exists: false,
    floorCode: false,
    floorWalk: false,
    floorPage: false,
    woke: '',
    sleptHours: null as number | null,
    oneThing: '',
    studyTopic: '',
    studyMinutes: null as number | null,
    aiUsed: null as boolean | null,
    learned: '',
    stuck: '',
    problems: [] as Problem[],
    meals: cleanMeals(),
    walkMinutes: null as number | null,
    physio: false,
    meds: cleanMeds(),
    pain: null as number | null,
    breathless: null as boolean | null,
    breathlessNote: '',
    win: '',
    tomorrowFirst: '',
    mood: null as number | null,
    notes: '',
    waves: [] as Wave[],
  };
}
export type LogView = ReturnType<typeof emptyView>;

function toView(e: DailyLog): LogView {
  const v = emptyView(e.logDate);
  v.exists = true;
  for (const f of SIMPLE_FIELDS) (v as any)[f] = (e as any)[f];
  v.problems = e.problems ?? [];
  v.meals = cleanMeals(e.meals as Record<string, unknown>);
  v.meds = cleanMeds(e.meds as Record<string, unknown>);
  v.waves = [...(e.waves ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((w) => ({ code: w.code, time: w.atTime, triggers: w.triggers, action: w.action, outcome: w.outcome }));
  return v;
}

export const floorDone = (l: Pick<LogView, 'floorCode' | 'floorWalk' | 'floorPage'>) => l.floorCode && l.floorWalk && l.floorPage;

@Injectable()
export class LogsService {
  constructor(private readonly ds: DataSource) {}

  private get repo() {
    return this.ds.getRepository(DailyLog);
  }

  async get(date: string): Promise<LogView> {
    const e = await this.repo.findOne({ where: { logDate: date }, relations: { waves: true } });
    return e ? toView(e) : emptyView(date);
  }

  async list(from: string, to: string): Promise<LogView[]> {
    const rows = await this.repo.find({ where: { logDate: Between(from, to) }, relations: { waves: true }, order: { logDate: 'ASC' } });
    return rows.map(toView);
  }

  /** Saves only the fields present in dto; waves are replaced when provided. */
  async put(date: string, dto: LogDto): Promise<LogView> {
    await this.ds.transaction(async (m) => {
      const log = (await m.findOneBy(DailyLog, { logDate: date })) ?? m.create(DailyLog, { logDate: date });
      for (const f of SIMPLE_FIELDS) {
        const value = dto[f];
        if (value !== undefined) (log as any)[f] = value;
      }
      if (dto.problems !== undefined) log.problems = cleanProblems(dto.problems);
      if (dto.meals !== undefined) log.meals = cleanMeals(dto.meals);
      if (dto.meds !== undefined) log.meds = cleanMeds(dto.meds);
      await m.save(DailyLog, log);
      if (dto.waves !== undefined) {
        await m.delete(WaveEntry, { logDate: date });
        const waves = cleanWaves(dto.waves).map((w, i) =>
          m.create(WaveEntry, { logDate: date, position: i, code: w.code, atTime: w.time, triggers: w.triggers, action: w.action, outcome: w.outcome }),
        );
        if (waves.length) await m.save(WaveEntry, waves);
      }
    });
    return this.get(date);
  }

  /** Consecutive Floor days ending today (or yesterday, if today isn't complete yet). */
  async streak(date: string) {
    const rows = await this.repo.find({
      select: { logDate: true, floorCode: true, floorWalk: true, floorPage: true },
      where: { logDate: Between(addDays(date, -730), date) },
    });
    const done = new Set(rows.filter(floorDone).map((r) => r.logDate));
    let cursor = done.has(date) ? date : addDays(date, -1);
    let streak = 0;
    while (done.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    const yesterday = addDays(date, -1);
    return { streak, missedYesterday: !done.has(yesterday), yesterdayLogged: rows.some((r) => r.logDate === yesterday) };
  }
}

@Controller()
export class LogsController {
  constructor(
    private readonly logs: LogsService,
    private readonly maps: MapsService,
    private readonly auth: AuthService,
  ) {}

  @Get('logs')
  list(@Query('from') from: string, @Query('to') to: string) {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new BadRequestException('from and to must be YYYY-MM-DD');
    return this.logs.list(from, to);
  }

  @Get('logs/:date')
  get(@Param('date', ParseIsoDatePipe) date: string) {
    return this.logs.get(date);
  }

  @Put('logs/:date')
  put(@Param('date', ParseIsoDatePipe) date: string, @Body() dto: LogDto) {
    return this.logs.put(date, dto);
  }

  /** Everything the top of today's page needs, for the client's local date. */
  @Get('today')
  async today(@Query('date', ParseIsoDatePipe) date: string) {
    const [log, yesterday, streak, next, settings] = await Promise.all([
      this.logs.get(date),
      this.logs.get(addDays(date, -1)),
      this.logs.streak(date),
      this.maps.nextActions(6),
      this.auth.getSettings(),
    ]);
    const day = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${settings.startDate}T00:00:00Z`)) / 86_400_000) + 1;
    return {
      date,
      dayNumber: day > 0 ? day : null,
      log,
      floorComplete: floorDone(log),
      ...streak,
      startWith: yesterday.tomorrowFirst,
      nextActions: next,
    };
  }
}

@Module({ imports: [MapsModule, AuthModule], controllers: [LogsController], providers: [LogsService], exports: [LogsService] })
export class LogsModule {}
