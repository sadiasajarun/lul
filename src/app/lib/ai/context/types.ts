/**
 * WHAT THE CONVERSATION IS CURRENTLY ABOUT.
 *
 * "Select the second center", "among these", "compare it with the worst one in the same district":
 * each of those points at the actual result of an earlier turn. Chat history alone cannot carry that
 * (it stops at 10 messages and 20 rows, and has no notion of a chosen center), so every answered turn
 * stores a small record of what it produced, and the records are folded back into one context.
 */
import type { DataMode } from '../../db/duckdb-source';

export type EntityKind = 'center' | 'district' | 'upazila' | 'division' | 'teacher' | 'student';

export interface EntityRef {
  kind: EntityKind;
  id: string;
  label?: string;
  division?: string;
  district?: string;
  upazila?: string;
}

/** What actually ranked a list, so "worst" and "same metric" mean what the user saw. */
export interface MetricDef {
  column: string;
  label: string;
  betterWhen: 'higher' | 'lower';
}

export interface ListItem { id: string; label?: string; value?: number }

export interface ListRef {
  kind: EntityKind;
  items: ListItem[];
  total: number;
  metric?: MetricDef;
}

export interface CohortRef {
  kind: EntityKind;
  ids: string[];
  total: number;
  /** Only stored when ids were truncated, so the full cohort can be re-derived. */
  sql?: string;
}

export interface DerivedItem {
  key: string;
  label: string;
  detail: string;
  controllable?: boolean;
}

export interface DerivedList {
  type: 'differences' | 'patterns' | 'lessons';
  items: DerivedItem[];
}

/** One answered turn's contribution to the conversation. */
export interface TurnDelta {
  v: 1;
  mode: DataMode;
  /** True for a turn that was answered in the context of earlier ones. */
  bound?: boolean;
  list?: ListRef;
  cohort?: CohortRef;
  selected?: EntityRef;
  metric?: MetricDef;
  comparison?: { a: EntityRef; b: EntityRef };
  derived?: DerivedList;
  hypothesis?: { factor: string; text: string };
  /** The analysis this turn ran, so "now analyze it by income" knows what "it" is. */
  facet?: string;
  /** Options offered in a clarifying question, so a reply of "2" can pick one. */
  pending?: EntityRef[];
}

export interface ConversationContext {
  mode: DataMode;
  /** True while turns are building on each other. A standalone answer ends the chain. */
  live: boolean;
  /** True when the dataset changed since the last turn, so earlier ids no longer apply. */
  stale: boolean;
  list?: ListRef;
  cohort?: CohortRef;
  selected?: EntityRef;
  metric?: MetricDef;
  comparison?: { a: EntityRef; b: EntityRef };
  derived?: DerivedList;
  hypothesis?: { factor: string; text: string };
  facet?: string;
  pending?: EntityRef[];
}
