/**
 * Operation and action type ids used inside an .aoe2record file.
 * Source: mgz/fast/enums.py (aoc-mgz, MIT) and parse_rec.ts (aoe2-record-viewer, MIT).
 */
export const Operation = {
  ACTION: 1,
  SYNC: 2,
  VIEWLOCK: 3,
  CHAT: 4,
  START: 5,
  POSTGAME: 6,
  SAVE: 7,
} as const;

export const Action = {
  ORDER: 0, STOP: 1, WORK: 2, MOVE: 3, CREATE: 4, ADD_ATTRIBUTE: 5,
  GIVE_ATTRIBUTE: 6, AI_ORDER: 10, RESIGN: 11, SPECTATE: 15, ADD_WAYPOINT: 16,
  STANCE: 18, GUARD: 19, FOLLOW: 20, PATROL: 21, FORMATION: 23, SAVE: 27,
  GROUP_MULTI_WAYPOINTS: 31, CHAPTER: 32, DE_ATTACK_MOVE: 33, HD_UNKNOWN_34: 34,
  DE_RETREAT: 35, DE_UNKNOWN_37: 37, DE_AUTOSCOUT: 38, DE_UNKNOWN_39: 39,
  DE_UNKNOWN_40: 40, DE_TRANSFORM: 41, RATHA_ABILITY: 43, DE_107_A: 44,
  DE_MULTI_GATHERPOINT: 45, DE_UNKNOWN_46: 46, AI_COMMAND: 53, DE_UNKNOWN_80: 80,
  MAKE: 100, RESEARCH: 101, BUILD: 102, GAME: 103, WALL: 105, DELETE: 106,
  ATTACK_GROUND: 107, TRIBUTE: 108, DE_UNKNOWN_109: 109, REPAIR: 110,
  UNGARRISON: 111, MULTIQUEUE: 112, GATE: 114, FLARE: 115, SPECIAL: 117,
  QUEUE: 119, GATHER_POINT: 120, SELL: 122, BUY: 123, DROP_RELIC: 126,
  TOWN_BELL: 127, BACK_TO_WORK: 128, DE_QUEUE: 129, DE_UNKNOWN_130: 130,
  DE_UNKNOWN_131: 131, DE_UNKNOWN_134: 134, DE_UNKNOWN_135: 135,
  DE_UNKNOWN_136: 136, DE_UNKNOWN_137: 137, DE_UNKNOWN_138: 138, DE_107_B: 140,
  DE_UNKNOWN_141: 141, DE_TRIBUTE: 196, POSTGAME: 255,
} as const;

export const ACTION_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Action).map(([name, id]) => [id, name]),
);

export function actionName(id: number): string {
  return ACTION_NAMES[id] ?? `UNKNOWN_${id}`;
}

/**
 * Actions that do not count as an effective action: game settings, saving,
 * chapter marker, spectating, AI commands and the end of the game.
 */
export const DEFAULT_EXCLUDED_ACTIONS: number[] = [
  Action.GAME,
  Action.SAVE,
  Action.CHAPTER,
  Action.SPECTATE,
  Action.AI_ORDER,
  Action.AI_COMMAND,
  Action.POSTGAME,
];
