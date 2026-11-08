// Rebuilds the conversation context from every message, so follow-ups are not limited by the
// 10-message history window. The records are stored on the messages, so they survive a reload.
import type { DataMode } from '../../db/duckdb-source';
import type { ConversationContext, TurnDelta } from './types';

export function foldContext(messages: { turn?: TurnDelta }[], mode: DataMode): ConversationContext {
  let ctx: ConversationContext = { mode, live: false, stale: false };
  for (const m of messages) {
    const t = m.turn;
    if (!t) continue;
    if (t.mode !== mode) {
      // Ids from another dataset must never bind here.
      ctx = { mode, live: false, stale: true };
      continue;
    }
    ctx.stale = false;
    ctx.pending = t.pending;
    if (t.bound) {
      ctx.live = true;
    } else {
      // A standalone answer ends the chain. Its own list starts a new one.
      ctx.live = false;
      if (t.list) { ctx.comparison = undefined; ctx.derived = undefined; ctx.hypothesis = undefined; }
    }
    if (t.list) ctx.list = t.list;
    if (t.cohort) ctx.cohort = t.cohort;
    if (t.selected) ctx.selected = t.selected;
    if (t.metric) ctx.metric = t.metric;
    if (t.comparison) ctx.comparison = t.comparison;
    if (t.derived) ctx.derived = t.derived;
    if (t.hypothesis) ctx.hypothesis = t.hypothesis;
    ctx.facet = t.facet;
  }
  return ctx;
}
