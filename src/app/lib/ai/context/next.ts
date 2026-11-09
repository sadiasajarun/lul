// Suggested next questions for an answer given in the context of earlier turns. Each one is phrased
// so the resolver binds it to the same chain (scripts/audit/scenarios.mjs checks that it does).
import type { ConversationContext, TurnDelta } from './types';

export function chainFollowups(turn: TurnDelta, ctx: ConversationContext): string[] {
  const center = ctx.selected?.kind === 'center';
  const area = ctx.selected && ['district', 'upazila', 'division'].includes(ctx.selected.kind);

  if (turn.hypothesis) return ['What evidence supports that hypothesis?', 'What additional data would be needed before confirming it?'];
  if (turn.derived?.type === 'differences') return ['Which of these differences are likely operationally controllable?', 'What lessons can we replicate in other centers?'];
  if (turn.derived?.type === 'patterns') return ['Which patterns are realistically replicable?', 'Recommend how to apply them to the bottom 20 centers.'];
  if (turn.derived?.type === 'lessons') return center ? ['Recommend five priority interventions.', 'Create a 90-day improvement plan for this center.'] : ['Recommend how to apply them to the bottom 20 centers.'];
  if (turn.comparison) return ['What are the five biggest differences?', 'Recommend five priority interventions.'];
  if (turn.selected?.kind === 'center') return ['Give me a postmortem of this center.', 'Check attendance first.', 'Compare it with the worst-performing center in the same district.'];
  if (turn.selected && area) return ['Show the five centers contributing most to dropout.', 'Analyze dropout by gender.'];
  if (turn.list?.kind === 'center') return ['Select the first center.', 'What common characteristics do these centers share?'];
  if (turn.list) return [`Select the first ${turn.list.kind}.`];
  if (center) return ['Compare it with the best center in the same district.', 'Recommend five priority interventions.'];
  if (area) return ['Check attendance patterns.', 'Check baseline scores.'];
  if (ctx.cohort?.kind === 'center') return ['What common characteristics do these centers share?', 'Compare their teacher-related indicators.'];
  return [];
}
