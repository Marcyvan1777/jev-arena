import type { BattleEvent } from '../../../shared/types.js';
const LINES: Record<BattleEvent['kind'], string[]> = {
  hit: ['{name} has filed a strongly worded glove complaint.', '{name} chooses violence. Again.', 'That warranty is absolutely void.'],
  block: ['{name} just discovered that guarding exists.', 'Customer support cannot help with that defense.'],
  dodge: ['{name} slipped that like rent was due tomorrow.', 'An impressive commitment to being somewhere else.'],
  miss: ['A devastating punch at the concept of empty space.', 'The ropes would like to press charges.'],
  move: ['A tactical step? Or pure ring panic?', 'Footwork. Probably part of a plan.'],
  counter: ['A counter with postage included.', 'That opening had a return address.'],
  knockdown: ['The canvas has entered the conversation.', 'The count is getting very interesting.'],
  referee: ['The ref restores order, briefly.', 'Back to center. No excuses.'],
  bell: ['Ding ding. Please keep your sparks to yourself.'],
  finish: ['One machine. Zero chill.'],
};
export function commentary(kind: BattleEvent['kind'], round: number, name: string) {
  const bank = LINES[kind];
  return bank[(round + name.length) % bank.length].replace('{name}', name);
}
