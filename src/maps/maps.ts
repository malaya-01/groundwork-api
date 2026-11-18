import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager, In } from 'typeorm';
import { Area, EdgeKind, MapEdge, MapNode, NodeKind, NodeStatus, RoadMap } from '../db/entities';
import { Graph, GEdge, GNode } from '../graph/graph';
import { isIsoDate } from '../common/util';

const AREAS = ['career', 'body', 'mind', 'money', 'other'] as const;
const KINDS = ['goal', 'milestone', 'skill', 'task', 'habit', 'resource', 'note'] as const;
const STATUSES = ['todo', 'in_progress', 'done', 'dropped'] as const;
const EDGE_KINDS = ['requires', 'relates'] as const;

// ---------- DTOs ----------
class CreateMapDto {
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsOptional() @IsIn(AREAS) area?: Area;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class UpdateMapDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @IsOptional() @IsIn(AREAS) area?: Area;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

class CreateNodeDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsIn(KINDS) kind?: NodeKind;
  @IsOptional() @IsIn(STATUSES) status?: NodeStatus;
  @IsNumber() x: number;
  @IsNumber() y: number;
}

class UpdateNodeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsIn(KINDS) kind?: NodeKind;
  @IsOptional() @IsIn(STATUSES) status?: NodeStatus;
  @IsOptional() @IsString() @MaxLength(20000) notes?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(100000) estimateHours?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() dueDate?: string | null;
}

class PositionDto {
  @IsUUID() id: string;
  @IsNumber() x: number;
  @IsNumber() y: number;
}

class LayoutDto {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => PositionDto) positions: PositionDto[];
}

class CreateEdgeDto {
  @IsUUID() sourceId: string;
  @IsUUID() targetId: string;
  @IsOptional() @IsIn(EDGE_KINDS) kind?: EdgeKind;
}

// ---------- mapping ----------
const toNode = (n: MapNode) => ({
  id: n.id,
  mapId: n.mapId,
  kind: n.kind,
  title: n.title,
  notes: n.notes,
  status: n.status,
  estimateHours: n.estimateHours,
  dueDate: n.dueDate,
  x: n.x,
  y: n.y,
  completedAt: n.completedAt,
});
const toEdge = (e: MapEdge) => ({ id: e.id, mapId: e.mapId, sourceId: e.sourceId, targetId: e.targetId, kind: e.kind });
const toGNode = (n: MapNode): GNode => ({ id: n.id, status: n.status, kind: n.kind, estimateHours: n.estimateHours });
const toGEdge = (e: MapEdge): GEdge => ({ source: e.sourceId, target: e.targetId, kind: e.kind });

const NOT_ACTIONS = new Set(['goal', 'note', 'resource']);

@Injectable()
export class MapsService {
  constructor(private readonly ds: DataSource) {}

  private touch(mapId: string, m: EntityManager = this.ds.manager) {
    return m
      .createQueryBuilder()
      .update(RoadMap)
      .set({ updatedAt: () => 'CURRENT_TIMESTAMP' })
      .where('id = :id', { id: mapId })
      .execute();
  }

  async list(includeArchived = false) {
    const maps = await this.ds.getRepository(RoadMap).find({
      where: includeArchived ? {} : { archived: false },
      order: { archived: 'ASC', updatedAt: 'DESC' },
    });
    const ids = maps.map((m) => m.id);
    const nodes = ids.length ? await this.ds.getRepository(MapNode).findBy({ mapId: In(ids) }) : [];
    const edges = ids.length ? await this.ds.getRepository(MapEdge).findBy({ mapId: In(ids), kind: 'requires' }) : [];
    return maps.map((m) => {
      const mn = nodes.filter((n) => n.mapId === m.id);
      const g = new Graph(mn.map(toGNode), edges.filter((e) => e.mapId === m.id).map(toGEdge));
      const counted = mn.filter((n) => n.status !== 'dropped' && n.kind !== 'note' && n.kind !== 'resource');
      const kindOf = new Map(mn.map((n) => [n.id, n.kind]));
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        area: m.area,
        archived: m.archived,
        updatedAt: m.updatedAt,
        nodeCount: mn.length,
        progress: counted.length ? counted.filter((n) => n.status === 'done').length / counted.length : 0,
        availableCount: g.actionable().filter((id) => !NOT_ACTIONS.has(kindOf.get(id)!)).length,
      };
    });
  }

  async create(dto: CreateMapDto) {
    const repo = this.ds.getRepository(RoadMap);
    const map = await repo.save(repo.create({ title: dto.title.trim(), area: dto.area ?? 'other', description: dto.description ?? '' }));
    return this.get(map.id);
  }

  async get(id: string) {
    const map = await this.ds.getRepository(RoadMap).findOneBy({ id });
    if (!map) throw new NotFoundException('Map not found');
    const nodes = await this.ds.getRepository(MapNode).find({ where: { mapId: id }, order: { createdAt: 'ASC' } });
    const edges = await this.ds.getRepository(MapEdge).find({ where: { mapId: id }, order: { createdAt: 'ASC' } });
    return {
      map: { id: map.id, title: map.title, description: map.description, area: map.area, archived: map.archived },
      nodes: nodes.map(toNode),
      edges: edges.map(toEdge),
      derived: new Graph(nodes.map(toGNode), edges.map(toGEdge)).derived(),
    };
  }

  async update(id: string, dto: UpdateMapDto) {
    const repo = this.ds.getRepository(RoadMap);
    const map = await repo.findOneBy({ id });
    if (!map) throw new NotFoundException('Map not found');
    if (dto.title !== undefined) map.title = dto.title.trim();
    if (dto.area !== undefined) map.area = dto.area;
    if (dto.description !== undefined) map.description = dto.description;
    if (dto.archived !== undefined) map.archived = dto.archived;
    await repo.save(map);
    return this.get(id);
  }

  async remove(id: string) {
    await this.ds.getRepository(RoadMap).delete({ id });
  }

  async createNode(mapId: string, dto: CreateNodeDto) {
    if (!(await this.ds.getRepository(RoadMap).existsBy({ id: mapId }))) throw new NotFoundException('Map not found');
    const repo = this.ds.getRepository(MapNode);
    const status = dto.status ?? 'todo';
    const node = await repo.save(
      repo.create({
        mapId,
        title: dto.title.trim(),
        kind: dto.kind ?? 'task',
        status,
        x: dto.x,
        y: dto.y,
        completedAt: status === 'done' ? new Date() : null,
      }),
    );
    await this.touch(mapId);
    return toNode(node);
  }

  private async lockedIds(mapId: string): Promise<Set<string>> {
    const nodes = await this.ds.getRepository(MapNode).findBy({ mapId });
    const edges = await this.ds.getRepository(MapEdge).findBy({ mapId, kind: 'requires' });
    const g = new Graph(nodes.map(toGNode), edges.map(toGEdge));
    return new Set(nodes.filter((n) => g.state(n.id) === 'locked').map((n) => n.id));
  }

  /** Updates a node. When it becomes done/dropped, reports which nodes it just unlocked. */
  async updateNode(id: string, dto: UpdateNodeDto) {
    if (dto.dueDate != null && !isIsoDate(dto.dueDate)) throw new BadRequestException('dueDate must be YYYY-MM-DD');
    const repo = this.ds.getRepository(MapNode);
    const node = await repo.findOneBy({ id });
    if (!node) throw new NotFoundException('Node not found');
    const lockedBefore = dto.status !== undefined ? await this.lockedIds(node.mapId) : new Set<string>();

    if (dto.title !== undefined) node.title = dto.title.trim();
    if (dto.kind !== undefined) node.kind = dto.kind;
    if (dto.notes !== undefined) node.notes = dto.notes;
    if (dto.estimateHours !== undefined) node.estimateHours = dto.estimateHours;
    if (dto.dueDate !== undefined) node.dueDate = dto.dueDate;
    if (dto.status !== undefined) {
      node.status = dto.status;
      node.completedAt = dto.status === 'done' ? (node.completedAt ?? new Date()) : null;
    }
    const saved = await repo.save(node);
    await this.touch(node.mapId);

    let unlocked: { id: string; title: string }[] = [];
    if (dto.status !== undefined) {
      const after = await this.lockedIds(node.mapId);
      const ids = [...lockedBefore].filter((x) => !after.has(x));
      if (ids.length) unlocked = (await repo.findBy({ id: In(ids) })).map((n) => ({ id: n.id, title: n.title }));
    }
    return { node: toNode(saved), unlocked };
  }

  async removeNode(id: string) {
    const repo = this.ds.getRepository(MapNode);
    const node = await repo.findOneBy({ id });
    if (!node) return;
    await repo.delete({ id });
    await this.touch(node.mapId);
  }

  /** Saves many node positions at once (after dragging or auto-layout). */
  async layout(mapId: string, dto: LayoutDto) {
    if (!dto.positions.length) return;
    await this.ds.transaction(async (m) => {
      for (const p of dto.positions) await m.update(MapNode, { id: p.id, mapId }, { x: p.x, y: p.y });
    });
  }

  /**
   * Adds an edge. For 'requires' edges the cycle check and the insert run in one transaction
   * with the map row locked, so two simultaneous requests can never create a loop together.
   */
  async createEdge(mapId: string, dto: CreateEdgeDto) {
    const kind = dto.kind ?? 'requires';
    if (dto.sourceId === dto.targetId) throw new BadRequestException('A node cannot depend on itself');
    return this.ds.transaction(async (m) => {
      const map = await m
        .getRepository(RoadMap)
        .createQueryBuilder('map')
        .setLock('pessimistic_write')
        .where('map.id = :id', { id: mapId })
        .getOne();
      if (!map) throw new NotFoundException('Map not found');
      const nodes = await m.findBy(MapNode, { mapId });
      const ids = new Set(nodes.map((n) => n.id));
      if (!ids.has(dto.sourceId) || !ids.has(dto.targetId)) throw new BadRequestException('Both nodes must belong to this map');
      if (kind === 'requires') {
        const edges = await m.findBy(MapEdge, { mapId, kind: 'requires' });
        const loop = new Graph(nodes.map(toGNode), edges.map(toGEdge)).wouldCreateCycle(dto.sourceId, dto.targetId);
        if (loop) {
          const title = (id: string) => nodes.find((n) => n.id === id)?.title ?? '?';
          throw new ConflictException({ message: `This would create a loop: ${loop.map(title).join(' → ')}`, cyclePath: loop });
        }
      }
      if (await m.existsBy(MapEdge, { sourceId: dto.sourceId, targetId: dto.targetId, kind })) {
        throw new ConflictException('That connection already exists');
      }
      const edge = await m.save(m.create(MapEdge, { mapId, sourceId: dto.sourceId, targetId: dto.targetId, kind }));
      await this.touch(mapId, m);
      return toEdge(edge);
    });
  }

  async removeEdge(id: string) {
    const repo = this.ds.getRepository(MapEdge);
    const edge = await repo.findOneBy({ id });
    if (!edge) return;
    await repo.delete({ id });
    await this.touch(edge.mapId);
  }

  /** What you can work on now, across all active maps. */
  async nextActions(limit = 8) {
    const maps = await this.ds.getRepository(RoadMap).findBy({ archived: false });
    if (!maps.length) return [];
    const title = new Map(maps.map((m) => [m.id, m.title]));
    const mapIds = maps.map((m) => m.id);
    const nodes = await this.ds.getRepository(MapNode).findBy({ mapId: In(mapIds) });
    const edges = await this.ds.getRepository(MapEdge).findBy({ mapId: In(mapIds), kind: 'requires' });
    const g = new Graph(nodes.map(toGNode), edges.map(toGEdge));
    const order = new Map(g.topologicalOrder().map((id, i) => [id, i]));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return g
      .actionable()
      .map((id) => byId.get(id)!)
      .filter((n) => !NOT_ACTIONS.has(n.kind))
      .sort((a, b) => {
        if ((a.status === 'in_progress') !== (b.status === 'in_progress')) return a.status === 'in_progress' ? -1 : 1;
        if (a.dueDate !== b.dueDate) return !a.dueDate ? 1 : !b.dueDate ? -1 : a.dueDate.localeCompare(b.dueDate);
        return order.get(a.id)! - order.get(b.id)!;
      })
      .slice(0, limit)
      .map((n) => ({ ...toNode(n), mapTitle: title.get(n.mapId) ?? '' }));
  }
}

@Controller()
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get('maps')
  list(@Query('archived') archived?: string) {
    return this.maps.list(archived === 'true');
  }

  @Post('maps')
  create(@Body() dto: CreateMapDto) {
    return this.maps.create(dto);
  }

  @Get('maps/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.maps.get(id);
  }

  @Patch('maps/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMapDto) {
    return this.maps.update(id, dto);
  }

  @Delete('maps/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.maps.remove(id);
  }

  @Post('maps/:id/nodes')
  createNode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateNodeDto) {
    return this.maps.createNode(id, dto);
  }

  @Patch('maps/:id/layout')
  @HttpCode(204)
  layout(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LayoutDto) {
    return this.maps.layout(id, dto);
  }

  @Post('maps/:id/edges')
  createEdge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEdgeDto) {
    return this.maps.createEdge(id, dto);
  }

  @Patch('nodes/:id')
  updateNode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNodeDto) {
    return this.maps.updateNode(id, dto);
  }

  @Delete('nodes/:id')
  @HttpCode(204)
  removeNode(@Param('id', ParseUUIDPipe) id: string) {
    return this.maps.removeNode(id);
  }

  @Delete('edges/:id')
  @HttpCode(204)
  removeEdge(@Param('id', ParseUUIDPipe) id: string) {
    return this.maps.removeEdge(id);
  }

  @Get('next-actions')
  next(@Query('limit') limit?: string) {
    return this.maps.nextActions(Math.min(50, Math.max(1, Number(limit) || 8)));
  }
}

@Module({ controllers: [MapsController], providers: [MapsService], exports: [MapsService] })
export class MapsModule {}
