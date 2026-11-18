// The database schema, defined as TypeORM entities.
// Migrations are GENERATED from these classes:  npm run migration:generate -- src/migrations/<Name>
// and applied with:                              npm run migration:run   (also runs on API start)
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  ValueTransformer,
} from 'typeorm';

/** Postgres NUMERIC arrives as a string; expose it as a number. */
const numeric: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null || v === undefined ? null : Number(v)),
};

export type Area = 'career' | 'body' | 'mind' | 'money' | 'other';
export type NodeKind = 'goal' | 'milestone' | 'skill' | 'task' | 'habit' | 'resource' | 'note';
export type NodeStatus = 'todo' | 'in_progress' | 'done' | 'dropped';
export type EdgeKind = 'requires' | 'relates';

export interface UserSettings {
  codeA: string; // private letter for the first wave type (default K)
  codeB: string; // private letter for the second wave type (default N)
  startDate: string; // Day 1 of the system, YYYY-MM-DD
  font: string; // handwriting font for the book
  books?: number[]; // year-books created in the universe view (years with pages are always included)
  /** Per book (journal "j-2026" or library "series~vol-01"): where you stopped reading, and your bookmarks. */
  reading?: Record<string, ReadingState>;
}

export interface ReadingState {
  /** Page location: a journal page id ("d-2026-11-15") or a library location ("c12.40" = chapter 12, block 40). */
  last?: string;
  marks?: string[];
  at?: string; // ISO time of the last change
}

// ---------------------------------------------------------------- account
@Entity('app_user')
export class AppUser {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text', unique: true }) username: string;
  @Column({ type: 'text' }) passwordHash: string;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) settings: Partial<UserSettings>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

// ---------------------------------------------------------------- roadmaps (graphs)
@Entity('map')
@Check(`"area" IN ('career','body','mind','money','other')`)
export class RoadMap {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'text', default: 'other' }) area: Area;
  @Column({ type: 'boolean', default: false }) archived: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @OneToMany(() => MapNode, (n) => n.map) nodes: MapNode[];
  @OneToMany(() => MapEdge, (e) => e.map) edges: MapEdge[];
}

@Entity('node')
@Index(['mapId'])
@Check(`"kind" IN ('goal','milestone','skill','task','habit','resource','note')`)
@Check(`"status" IN ('todo','in_progress','done','dropped')`)
@Check(`"estimate_hours" >= 0`)
export class MapNode {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) mapId: string;
  @ManyToOne(() => RoadMap, (m) => m.nodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'map_id' })
  map: RoadMap;
  @Column({ type: 'text', default: 'task' }) kind: NodeKind;
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text', default: '' }) notes: string;
  @Column({ type: 'text', default: 'todo' }) status: NodeStatus;
  @Column({ type: 'numeric', precision: 7, scale: 2, nullable: true, transformer: numeric }) estimateHours: number | null;
  @Column({ type: 'date', nullable: true }) dueDate: string | null;
  @Column({ type: 'double precision', default: 0 }) x: number;
  @Column({ type: 'double precision', default: 0 }) y: number;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

/** source = prerequisite, target = dependent ("do source, then target"). */
@Entity('edge')
@Index(['mapId'])
@Index(['targetId'])
@Unique('edge_source_target_kind', ['sourceId', 'targetId', 'kind'])
@Check(`"source_id" <> "target_id"`)
@Check(`"kind" IN ('requires','relates')`)
export class MapEdge {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) mapId: string;
  @ManyToOne(() => RoadMap, (m) => m.edges, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'map_id' })
  map: RoadMap;
  @Column({ type: 'uuid' }) sourceId: string;
  @ManyToOne(() => MapNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id' })
  source: MapNode;
  @Column({ type: 'uuid' }) targetId: string;
  @ManyToOne(() => MapNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_id' })
  target: MapNode;
  @Column({ type: 'text', default: 'requires' }) kind: EdgeKind;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

// ---------------------------------------------------------------- the book: daily pages
export interface Problem {
  name: string;
  solo: boolean;
}
export interface Meal {
  time: string;
  what: string;
  onPlan: boolean | null;
}
export type Meals = Record<'breakfast' | 'lunch' | 'snack' | 'dinner', Meal>;
export interface Meds {
  am: boolean;
  pm: boolean;
  night: boolean;
}

@Entity('daily_log')
@Check(`"slept_hours" >= 0 AND "slept_hours" <= 24`)
@Check(`"study_minutes" >= 0`)
@Check(`"walk_minutes" >= 0`)
@Check(`"pain" BETWEEN 0 AND 10`)
@Check(`"mood" BETWEEN 1 AND 5`)
export class DailyLog {
  @PrimaryColumn({ type: 'date' }) logDate: string;
  // front of the page
  @Column({ type: 'boolean', default: false }) floorCode: boolean;
  @Column({ type: 'boolean', default: false }) floorWalk: boolean;
  @Column({ type: 'boolean', default: false }) floorPage: boolean;
  @Column({ type: 'text', default: '' }) woke: string;
  @Column({ type: 'numeric', precision: 3, scale: 1, nullable: true, transformer: numeric }) sleptHours: number | null;
  @Column({ type: 'text', default: '' }) oneThing: string;
  @Column({ type: 'text', default: '' }) studyTopic: string;
  @Column({ type: 'integer', nullable: true }) studyMinutes: number | null;
  @Column({ type: 'boolean', nullable: true }) aiUsed: boolean | null;
  @Column({ type: 'text', default: '' }) learned: string;
  @Column({ type: 'text', default: '' }) stuck: string;
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` }) problems: Problem[];
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) meals: Partial<Meals>;
  @Column({ type: 'integer', nullable: true }) walkMinutes: number | null;
  @Column({ type: 'boolean', default: false }) physio: boolean;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) meds: Partial<Meds>;
  @Column({ type: 'smallint', nullable: true }) pain: number | null;
  @Column({ type: 'boolean', nullable: true }) breathless: boolean | null;
  @Column({ type: 'text', default: '' }) breathlessNote: string;
  @Column({ type: 'text', default: '' }) win: string;
  @Column({ type: 'text', default: '' }) tomorrowFirst: string;
  @Column({ type: 'smallint', nullable: true }) mood: number | null;
  // back of the page: rich-text HTML
  @Column({ type: 'text', default: '' }) notes: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @OneToMany(() => WaveEntry, (w) => w.log, { cascade: ['insert'] }) waves: WaveEntry[];
}

/** An urge ("wave"). code 'a' / 'b' map to the user's private letters (default K / N). */
@Entity('wave')
@Index(['logDate'])
@Check(`"code" IN ('a','b')`)
@Check(`"outcome" IN ('rode','wiped')`)
export class WaveEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'date' }) logDate: string;
  @ManyToOne(() => DailyLog, (l) => l.waves, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'log_date', referencedColumnName: 'logDate' })
  log: DailyLog;
  @Column({ type: 'smallint', default: 0 }) position: number;
  @Column({ type: 'text' }) code: 'a' | 'b';
  @Column({ type: 'text', default: '' }) atTime: string;
  @Column({ type: 'text', array: true, default: () => `'{}'` }) triggers: string[];
  @Column({ type: 'text', default: '' }) action: string;
  @Column({ type: 'text' }) outcome: 'rode' | 'wiped';
}

// ---------------------------------------------------------------- the book: review pages
@Entity('weekly_review')
@Check(`"confidence_reps" >= 0`)
export class WeeklyReview {
  @PrimaryColumn({ type: 'date' }) weekStart: string; // Monday
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) answers: Record<string, unknown>;
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numeric }) spent: number | null;
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numeric }) sentSaved: number | null;
  @Column({ type: 'integer', nullable: true }) confidenceReps: number | null;
  @Column({ type: 'text', default: '' }) notes: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('monthly_review')
export class MonthlyReview {
  @PrimaryColumn({ type: 'date' }) month: string; // first day of the month
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) answers: Record<string, unknown>;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) scorecard: Record<string, unknown>;
  @Column({ type: 'text', default: '' }) notes: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('yearly_review')
@Check(`"year" BETWEEN 2000 AND 2200`)
export class YearlyReview {
  @PrimaryColumn({ type: 'integer' }) year: number;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) answers: Record<string, unknown>;
  @Column({ type: 'text', default: '' }) notes: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

/** Measurements over time: weight_kg, waist_cm, bp_sys, bp_dia, … */
@Entity('metric_entry')
@Check(`"key" ~ '^[a-z_]{2,30}$'`)
export class MetricEntry {
  @PrimaryColumn({ type: 'text' }) key: string;
  @PrimaryColumn({ type: 'date' }) recordedOn: string;
  @Column({ type: 'numeric', transformer: numeric }) value: number;
}

export const ENTITIES = [AppUser, RoadMap, MapNode, MapEdge, DailyLog, WaveEntry, WeeklyReview, MonthlyReview, YearlyReview, MetricEntry];
