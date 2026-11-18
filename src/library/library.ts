// Reading books: volumes of Markdown novels on disk, served READ-ONLY.
//
// LIBRARY_DIR points at one or more library roots (comma-separated). Each root has
//   seed/books.json                         → the series (title, author, folders, accent colour, cover)
//   <seedDir>/arcs.json                     → volumes: { id, number, title, chapterStart, chapterEnd }
//   <contentDir>/ch-0001.md …               → chapters: YAML front matter + Markdown prose
// Files stay Markdown; nothing here ever writes to the library. Only files named by the
// registry are opened (ids from the URL are looked up, never joined into paths).
import { Controller, Get, Header, Injectable, Module, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

export interface SeriesInfo {
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  accent: string;
  hasCover: boolean;
  /** the series blurb (for the back cover) */
  description: string;
}
export interface ChapterInfo {
  n: number;
  title: string;
  words: number;
}
export interface VolumeInfo {
  /** `${seriesSlug}~${volumeId}`, e.g. "the-hollow-canopy~vol-01" */
  id: string;
  series: SeriesInfo;
  number: number;
  title: string;
  chapterStart: number;
  chapterEnd: number;
  chapters: ChapterInfo[];
  words: number;
}
export interface Chapter extends ChapterInfo {
  epigraph: string;
  epigraphAttribution: string;
  /** Markdown body, front matter removed */
  body: string;
}

interface SeriesEntry {
  info: SeriesInfo;
  root: string;
  contentDir: string;
  coverFile: string | null;
  volumes: { id: string; number: number; title: string; chapterStart: number; chapterEnd: number }[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,80}~[a-z0-9][a-z0-9-]{0,30}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Resolves `rel` under `root`, refusing anything that escapes it. */
function inside(root: string, rel: string): string | null {
  const p = path.resolve(root, rel);
  const r = path.resolve(root);
  return p === r || p.startsWith(r + path.sep) ? p : null;
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1_000_000 ? v : null);

/** Top-level `key: value` lines of YAML front matter (nested blocks are skipped). */
export function parseChapter(raw: string, n: number): Chapter {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const meta: Record<string, string> = {};
  let body = text;
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
      if (!kv) continue;
      let v = kv[2].trim();
      if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
        try {
          v = JSON.parse(v);
        } catch {
          v = v.slice(1, -1);
        }
      } else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1).replace(/''/g, "'");
      meta[kv[1]] = v;
    }
  }
  body = body.trim();
  return {
    n,
    title: meta.title || `Chapter ${n}`,
    epigraph: meta.epigraph ?? '',
    epigraphAttribution: meta.epigraph_attribution ?? '',
    body,
    words: body ? body.split(/\s+/).length : 0,
  };
}

@Injectable()
export class LibraryService {
  private cache = new Map<string, { mtime: number; chapter: Chapter }>();

  private roots(): string[] {
    return (process.env.LIBRARY_DIR ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private async readJson(file: string): Promise<unknown> {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''));
  }

  /** The series registry, re-read each call (it's two small JSON files per series). */
  private async series(): Promise<SeriesEntry[]> {
    const out: SeriesEntry[] = [];
    for (const root of this.roots()) {
      let reg: { books?: unknown[] };
      try {
        reg = (await this.readJson(path.join(root, 'seed', 'books.json'))) as { books?: unknown[] };
      } catch {
        continue; // not a library root (or unreadable): skip it
      }
      for (const b of reg.books ?? []) {
        const o = (b ?? {}) as Record<string, unknown>;
        const slug = str(o.slug, 80);
        const seedDir = inside(root, str(o.seedDir, 300));
        const contentDir = inside(root, str(o.contentDir, 300));
        if (!SLUG.test(slug) || !seedDir || !contentDir || out.some((s) => s.info.slug === slug)) continue;
        let arcs: { volumes?: unknown[] };
        try {
          arcs = (await this.readJson(path.join(seedDir, 'arcs.json'))) as { volumes?: unknown[] };
        } catch {
          continue;
        }
        const volumes = (arcs.volumes ?? [])
          .map((v) => {
            const x = (v ?? {}) as Record<string, unknown>;
            const id = str(x.id, 30);
            const number = int(x.number);
            const chapterStart = int(x.chapterStart);
            const chapterEnd = int(x.chapterEnd);
            if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !number || !chapterStart || !chapterEnd || chapterEnd < chapterStart) return null;
            return { id, number, title: str(x.title, 200) || `Volume ${number}`, chapterStart, chapterEnd };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);
        // cover: "/assets/covers/x.svg" lives in <root>/public
        const coverRel = str(o.coverImage, 300);
        const coverFile = coverRel.endsWith('.svg') ? inside(path.join(root, 'public'), coverRel.replace(/^\/+/, '')) : null;
        let hasCover = false;
        if (coverFile) hasCover = await fs.stat(coverFile).then((s) => s.isFile(), () => false);
        out.push({
          info: {
            slug,
            title: str(o.title, 200) || slug,
            subtitle: str(o.subtitle, 200),
            author: str(o.author, 120),
            accent: /^#[0-9a-fA-F]{6}$/.test(str(o.accentColor, 7)) ? str(o.accentColor, 7) : '#6b5b3e',
            hasCover,
            description: str(o.description, 1200),
          },
          root,
          contentDir,
          coverFile: hasCover ? coverFile : null,
          volumes,
        });
      }
    }
    return out;
  }

  private async chapter(s: SeriesEntry, n: number): Promise<Chapter | null> {
    const file = path.join(s.contentDir, `ch-${String(n).padStart(4, '0')}.md`);
    let st;
    try {
      st = await fs.stat(file);
    } catch {
      return null; // not written yet
    }
    if (!st.isFile() || st.size > 5_000_000) return null;
    const hit = this.cache.get(file);
    if (hit && hit.mtime === st.mtimeMs) return hit.chapter;
    const chapter = parseChapter(await fs.readFile(file, 'utf8'), n);
    this.cache.set(file, { mtime: st.mtimeMs, chapter });
    return chapter;
  }

  private async volumeChapters(s: SeriesEntry, v: SeriesEntry['volumes'][number]): Promise<Chapter[]> {
    const out: Chapter[] = [];
    // cap: no volume needs more than 2000 chapters, and it bounds the work per request
    for (let n = v.chapterStart; n <= Math.min(v.chapterEnd, v.chapterStart + 2000); n++) {
      const c = await this.chapter(s, n);
      if (c) out.push(c);
    }
    return out;
  }

  /** Every volume that has at least one written chapter. */
  async list(): Promise<VolumeInfo[]> {
    const out: VolumeInfo[] = [];
    for (const s of await this.series()) {
      for (const v of s.volumes) {
        const chapters = await this.volumeChapters(s, v);
        if (!chapters.length) continue;
        out.push({
          id: `${s.info.slug}~${v.id}`,
          series: s.info,
          number: v.number,
          title: v.title,
          chapterStart: v.chapterStart,
          chapterEnd: v.chapterEnd,
          chapters: chapters.map(({ n, title, words }) => ({ n, title, words })),
          words: chapters.reduce((a, c) => a + c.words, 0),
        });
      }
    }
    return out;
  }

  async volume(id: string): Promise<VolumeInfo & { chapters: Chapter[] }> {
    if (!ID.test(id)) throw new NotFoundException('No such book');
    const [slug, volId] = id.split('~');
    const s = (await this.series()).find((x) => x.info.slug === slug);
    const v = s?.volumes.find((x) => x.id === volId);
    if (!s || !v) throw new NotFoundException('No such book');
    const chapters = await this.volumeChapters(s, v);
    if (!chapters.length) throw new NotFoundException('This volume has no chapters yet');
    return {
      id,
      series: s.info,
      number: v.number,
      title: v.title,
      chapterStart: v.chapterStart,
      chapterEnd: v.chapterEnd,
      chapters,
      words: chapters.reduce((a, c) => a + c.words, 0),
    };
  }

  async cover(slug: string): Promise<Buffer> {
    if (!SLUG.test(slug)) throw new NotFoundException();
    const s = (await this.series()).find((x) => x.info.slug === slug);
    if (!s?.coverFile) throw new NotFoundException();
    const st = await fs.stat(s.coverFile);
    if (st.size > 2_000_000) throw new NotFoundException();
    return fs.readFile(s.coverFile);
  }
}

@Controller('library')
export class LibraryController {
  constructor(private readonly lib: LibraryService) {}

  @Get()
  list() {
    return this.lib.list();
  }

  @Get('covers/:slug')
  @Header('Content-Type', 'image/svg+xml')
  // an SVG is a document: never let it run script, even if opened directly
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
  @Header('Cache-Control', 'private, max-age=300')
  async cover(@Param('slug') slug: string, @Res() res: Response) {
    res.send(await this.lib.cover(slug.replace(/\.svg$/, '')));
  }

  @Get(':id')
  volume(@Param('id') id: string) {
    return this.lib.volume(id);
  }
}

@Module({ controllers: [LibraryController], providers: [LibraryService] })
export class LibraryModule {}
