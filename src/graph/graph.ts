// Pure graph logic for roadmaps. No framework or database code here.
// Edge semantics: a 'requires' edge source → target means "finish source before target".
// 'relates' edges are visual only and never affect the logic.

export type NodeStatus = 'todo' | 'in_progress' | 'done' | 'dropped';
export type DerivedState = 'locked' | 'available' | 'in_progress' | 'done' | 'dropped';

export interface GNode {
  id: string;
  status: NodeStatus;
  kind?: string;
  estimateHours?: number | null;
}

export interface GEdge {
  source: string;
  target: string;
  kind: 'requires' | 'relates';
}

export interface Derived {
  state: DerivedState;
  /** 0..1 completion of everything this node requires; null when it has no prerequisites. */
  progress: number | null;
}

export class Graph {
  private readonly nodes = new Map<string, GNode>();
  private readonly out = new Map<string, string[]>();
  private readonly inn = new Map<string, string[]>();

  constructor(nodes: GNode[], edges: GEdge[]) {
    for (const n of nodes) {
      this.nodes.set(n.id, n);
      this.out.set(n.id, []);
      this.inn.set(n.id, []);
    }
    for (const e of edges) {
      if (e.kind !== 'requires') continue;
      if (!this.nodes.has(e.source) || !this.nodes.has(e.target)) continue;
      this.out.get(e.source)!.push(e.target);
      this.inn.get(e.target)!.push(e.source);
    }
  }

  /**
   * If adding a 'requires' edge source → target would close a loop, returns the loop
   * as a list of ids starting and ending at source. Otherwise null.
   */
  wouldCreateCycle(source: string, target: string): string[] | null {
    if (source === target) return [source, source];
    const parent = new Map<string, string>();
    const seen = new Set<string>([target]);
    const stack = [target];
    while (stack.length) {
      const v = stack.pop()!;
      if (v === source) {
        const back = [v];
        let cur = v;
        while (cur !== target) {
          cur = parent.get(cur)!;
          back.push(cur);
        }
        return [source, ...back.reverse()];
      }
      for (const w of this.out.get(v) ?? []) {
        if (!seen.has(w)) {
          seen.add(w);
          parent.set(w, v);
          stack.push(w);
        }
      }
    }
    return null;
  }

  /** Kahn's algorithm. Throws if the graph has a cycle. */
  topologicalOrder(): string[] {
    const indeg = new Map<string, number>();
    for (const id of this.nodes.keys()) indeg.set(id, this.inn.get(id)!.length);
    const queue = [...this.nodes.keys()].filter((id) => indeg.get(id) === 0);
    const order: string[] = [];
    while (queue.length) {
      const v = queue.shift()!;
      order.push(v);
      for (const w of this.out.get(v)!) {
        indeg.set(w, indeg.get(w)! - 1);
        if (indeg.get(w) === 0) queue.push(w);
      }
    }
    if (order.length !== this.nodes.size) throw new Error('graph has a cycle');
    return order;
  }

  private satisfied(id: string): boolean {
    const s = this.nodes.get(id)?.status;
    return s === 'done' || s === 'dropped';
  }

  state(id: string): DerivedState {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    if (n.status !== 'todo') return n.status;
    return this.inn.get(id)!.every((p) => this.satisfied(p)) ? 'available' : 'locked';
  }

  /** Every node that must be finished before id (transitively). */
  ancestors(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [...(this.inn.get(id) ?? [])];
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      stack.push(...this.inn.get(v)!);
    }
    return seen;
  }

  /** Every node that id unlocks (transitively). */
  descendants(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [...(this.out.get(id) ?? [])];
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      stack.push(...this.out.get(v)!);
    }
    return seen;
  }

  /**
   * Estimate-weighted completion of everything id requires. Dropped prerequisites are ignored;
   * prerequisites without an estimate weigh 1. Returns null when id has no prerequisites.
   */
  progress(id: string): number | null {
    const anc = [...this.ancestors(id)].filter((a) => this.nodes.get(a)!.status !== 'dropped');
    if (!anc.length) return null;
    let total = 0;
    let done = 0;
    for (const a of anc) {
      const n = this.nodes.get(a)!;
      const w = n.estimateHours && n.estimateHours > 0 ? n.estimateHours : 1;
      total += w;
      if (n.status === 'done') done += w;
    }
    return total ? done / total : null;
  }

  derived(): Record<string, Derived> {
    const result: Record<string, Derived> = {};
    for (const id of this.nodes.keys()) result[id] = { state: this.state(id), progress: this.progress(id) };
    return result;
  }

  /** Nodes you can work on right now: in progress first, then available. */
  actionable(): string[] {
    const ids = [...this.nodes.keys()];
    return [
      ...ids.filter((id) => this.state(id) === 'in_progress'),
      ...ids.filter((id) => this.state(id) === 'available'),
    ];
  }
}
