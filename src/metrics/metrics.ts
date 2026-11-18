import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Put, Query } from '@nestjs/common';
import { IsNumber } from 'class-validator';
import { Between, DataSource } from 'typeorm';
import {
  AppUser,
  DailyLog,
  MapEdge,
  MapNode,
  MetricEntry,
  MonthlyReview,
  RoadMap,
  WaveEntry,
  WeeklyReview,
  YearlyReview,
} from '../db/entities';
import { ParseIsoDatePipe, Public, isIsoDate } from '../common/util';

const KEY = /^[a-z_]{2,30}$/;

class ValueDto {
  @IsNumber() value: number;
}

@Injectable()
export class MetricsService {
  constructor(private readonly ds: DataSource) {}

  async list(key: string, from: string, to: string) {
    const rows = await this.ds.getRepository(MetricEntry).find({
      where: { key, recordedOn: Between(from, to) },
      order: { recordedOn: 'ASC' },
    });
    return rows.map((r) => ({ date: r.recordedOn, value: r.value }));
  }

  async put(key: string, date: string, value: number) {
    await this.ds.getRepository(MetricEntry).upsert({ key, recordedOn: date, value }, ['key', 'recordedOn']);
    return { key, date, value };
  }

  async remove(key: string, date: string) {
    await this.ds.getRepository(MetricEntry).delete({ key, recordedOn: date });
  }

  /** Everything, as JSON. Your data stays yours. */
  async exportAll() {
    const [user] = await this.ds.getRepository(AppUser).find({ take: 1 });
    return {
      exportedAt: new Date().toISOString(),
      version: 1,
      settings: user ? { username: user.username, settings: user.settings, createdAt: user.createdAt } : null,
      maps: await this.ds.getRepository(RoadMap).find(),
      nodes: await this.ds.getRepository(MapNode).find(),
      edges: await this.ds.getRepository(MapEdge).find(),
      dailyLogs: await this.ds.getRepository(DailyLog).find({ order: { logDate: 'ASC' } }),
      waves: await this.ds.getRepository(WaveEntry).find(),
      weeklyReviews: await this.ds.getRepository(WeeklyReview).find(),
      monthlyReviews: await this.ds.getRepository(MonthlyReview).find(),
      yearlyReviews: await this.ds.getRepository(YearlyReview).find(),
      metrics: await this.ds.getRepository(MetricEntry).find(),
    };
  }

  async ping() {
    await this.ds.query('SELECT 1');
  }
}

const checkKey = (key: string) => {
  if (!KEY.test(key)) throw new BadRequestException('metric key: lowercase letters and _ only');
  return key;
};

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get('health')
  async health() {
    try {
      await this.metrics.ping();
      return { ok: true, db: true };
    } catch {
      return { ok: true, db: false };
    }
  }

  @Get('metrics/:key')
  list(@Param('key') key: string, @Query('from') from: string, @Query('to') to: string) {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new BadRequestException('from and to must be YYYY-MM-DD');
    return this.metrics.list(checkKey(key), from, to);
  }

  @Put('metrics/:key/:date')
  put(@Param('key') key: string, @Param('date', ParseIsoDatePipe) date: string, @Body() dto: ValueDto) {
    return this.metrics.put(checkKey(key), date, dto.value);
  }

  @Delete('metrics/:key/:date')
  @HttpCode(204)
  remove(@Param('key') key: string, @Param('date', ParseIsoDatePipe) date: string) {
    return this.metrics.remove(checkKey(key), date);
  }

  @Get('export')
  exportAll() {
    return this.metrics.exportAll();
  }
}

@Module({ controllers: [MetricsController], providers: [MetricsService] })
export class MetricsModule {}
