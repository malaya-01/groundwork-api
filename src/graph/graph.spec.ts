import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph, GEdge, GNode, NodeStatus } from './graph';

const n = (id: string, status: NodeStatus = 'todo', estimateHours?: number): GNode => ({ id, status, estimateHours });
const req = (source: string, target: string): GEdge => ({ source, target, kind: 'requires' });

test('empty graph', () => {
  const g = new Graph([], []);
  assert.deepEqual(g.topologicalOrder(), []);
  assert.deepEqual(g.derived(), {});
});

test('node without prerequisites is available', () => {
  const g = new Graph([n('a')], []);
  assert.equal(g.state('a'), 'available');
  assert.equal(g.progress('a'), null);
});

test('locked until every prerequisite is done or dropped', () => {
  const g = new Graph([n('a', 'done'), n('b'), n('c')], [req('a', 'c'), req('b', 'c')]);
  assert.equal(g.state('c'), 'locked');
  const g2 = new Graph([n('a', 'done'), n('b', 'dropped'), n('c')], [req('a', 'c'), req('b', 'c')]);
  assert.equal(g2.state('c'), 'available');
});

test('relates edges never lock anything', () => {
  const g = new Graph([n('a'), n('b')], [{ source: 'a', target: 'b', kind: 'relates' }]);
  assert.equal(g.state('b'), 'available');
  assert.equal(g.wouldCreateCycle('b', 'a'), null);
});

test('cycle detection returns the loop path', () => {
  const g = new Graph([n('a'), n('b'), n('c')], [req('a', 'b'), req('b', 'c')]);
  assert.deepEqual(g.wouldCreateCycle('c', 'a'), ['c', 'a', 'b', 'c']);
  assert.deepEqual(g.wouldCreateCycle('a', 'a'), ['a', 'a']);
  assert.equal(g.wouldCreateCycle('a', 'c'), null);
});

test('diamond is not a cycle', () => {
  const g = new Graph([n('a'), n('b'), n('c'), n('d')], [req('a', 'b'), req('a', 'c'), req('b', 'd'), req('c', 'd')]);
  assert.equal(g.wouldCreateCycle('a', 'd'), null);
  const order = g.topologicalOrder();
  assert.ok(order.indexOf('a') < order.indexOf('b'));
  assert.ok(order.indexOf('b') < order.indexOf('d'));
  assert.ok(order.indexOf('c') < order.indexOf('d'));
});

test('progress is estimate-weighted over all prerequisites', () => {
  const g = new Graph([n('m1', 'done', 8), n('m2', 'todo', 2), n('goal')], [req('m1', 'goal'), req('m2', 'goal')]);
  assert.equal(g.progress('goal'), 0.8);
});

test('progress follows prerequisites transitively and ignores dropped ones', () => {
  const g = new Graph(
    [n('a', 'done'), n('b', 'dropped'), n('c'), n('goal')],
    [req('a', 'c'), req('b', 'c'), req('c', 'goal')],
  );
  assert.equal(g.progress('goal'), 0.5);
});

test('actionable lists in-progress first, then available', () => {
  const g = new Graph([n('a', 'done'), n('b'), n('c', 'in_progress'), n('d')], [req('a', 'b'), req('b', 'd')]);
  assert.deepEqual(g.actionable(), ['c', 'b']);
});

test('2,000-node random DAG stays fast', () => {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  for (let i = 0; i < 2000; i++) nodes.push(n(`n${i}`, i % 3 === 0 ? 'done' : 'todo'));
  for (let i = 1; i < 2000; i++) edges.push(req(`n${Math.floor(Math.random() * i)}`, `n${i}`));
  const t = performance.now();
  const g = new Graph(nodes, edges);
  g.topologicalOrder();
  g.wouldCreateCycle('n1999', 'n0');
  for (const id of ['n10', 'n500', 'n1999']) g.progress(id);
  assert.ok(performance.now() - t < 500);
});
