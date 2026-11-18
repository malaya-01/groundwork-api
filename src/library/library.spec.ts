import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { LibraryService, parseChapter } from './library';

test('front matter: quoted values, nested blocks skipped, body trimmed', () => {
  const c = parseChapter(
    '---\nchapter: 3\ntitle: "The \\"Last\\" Morning"\nepigraph: \'It\'\'s late\'\nopening:\n  title: nested\n---\n\nHello *world*.\n\n---\n\nAfter the break.\n',
    3,
  );
  assert.equal(c.title, 'The "Last" Morning');
  assert.equal(c.epigraph, "It's late");
  assert.equal(c.epigraphAttribution, '');
  assert.equal(c.body, 'Hello *world*.\n\n---\n\nAfter the break.');
  assert.equal(c.words, 6);
});

test('no front matter → whole file is the body, title falls back', () => {
  const c = parseChapter('Just prose.\r\n', 7);
  assert.equal(c.title, 'Chapter 7');
  assert.equal(c.body, 'Just prose.');
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'gw-lib-'));
  mkdirSync(path.join(root, 'seed'));
  mkdirSync(path.join(root, 'books/s1/seed'), { recursive: true });
  mkdirSync(path.join(root, 'books/s1/content/chapters'), { recursive: true });
  writeFileSync(
    path.join(root, 'seed/books.json'),
    JSON.stringify({
      books: [
        { slug: 's1', title: 'Series One', seedDir: 'books/s1/seed', contentDir: 'books/s1/content/chapters', accentColor: '#112233' },
        { slug: 'evil', title: 'Escape', seedDir: '../../outside', contentDir: '../../outside' },
      ],
    }),
  );
  writeFileSync(
    path.join(root, 'books/s1/seed/arcs.json'),
    JSON.stringify({
      volumes: [
        { id: 'vol-01', number: 1, title: 'First', chapterStart: 1, chapterEnd: 3 },
        { id: 'vol-02', number: 2, title: 'Unwritten', chapterStart: 4, chapterEnd: 6 },
      ],
    }),
  );
  writeFileSync(path.join(root, 'books/s1/content/chapters/ch-0001.md'), '---\ntitle: "One"\n---\nAlpha beta.');
  writeFileSync(path.join(root, 'books/s1/content/chapters/ch-0003.md'), 'Gamma.');
  return root;
}

test('lists only volumes with written chapters; skips paths outside the root', async () => {
  process.env.LIBRARY_DIR = fixture();
  const lib = new LibraryService();
  const list = await lib.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 's1~vol-01');
  assert.deepEqual(
    list[0].chapters.map((c) => [c.n, c.title]),
    [
      [1, 'One'],
      [3, 'Chapter 3'],
    ],
  );
  assert.equal(list[0].series.accent, '#112233');
  const vol = await lib.volume('s1~vol-01');
  assert.equal(vol.chapters[0].body, 'Alpha beta.');
});

test('unknown or malformed ids are 404s, not file paths', async () => {
  process.env.LIBRARY_DIR = fixture();
  const lib = new LibraryService();
  for (const id of ['s1~vol-02', 's1~vol-09', '..~..', 's1~../../x', 'nope']) {
    await assert.rejects(() => lib.volume(id), /No such book|no chapters/);
  }
});
