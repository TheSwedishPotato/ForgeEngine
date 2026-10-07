/** The stage's vocabulary, shared with the director (no graphics here, so it loads anywhere). */
export const PLACE_TYPES = ['tavern', 'hall', 'chamber', 'cottage', 'church', 'workshop', 'cellar', 'dungeon', 'kitchen', 'stable', 'shop',
  'street', 'market', 'square', 'forest', 'field', 'road', 'river', 'bridge', 'castle', 'camp', 'hilltop', 'garden', 'shore', 'ship', 'cave', 'graveyard', 'gate', 'courtyard'];
export const INDOOR = new Set(['tavern', 'hall', 'chamber', 'cottage', 'church', 'workshop', 'cellar', 'dungeon', 'kitchen', 'stable', 'shop', 'cave']);
export const STYLES = ['bohemian', 'italian', 'english', 'japanese', 'generic'];
export const WALLS = ['plaster', 'stone', 'timber', 'wattle', 'wood', 'brick', 'paper'];
export const FLOORS = ['earth', 'planks', 'flagstone', 'rushes', 'tatami', 'cobbles', 'grass', 'sand', 'snow', 'mud'];
export const GESTURES = ['none', 'point', 'cross', 'heart', 'raise', 'beckon', 'shrug', 'drink', 'wave', 'bow', 'hilt', 'embrace', 'hips', 'clasp',
  'reach', 'offer', 'fist', 'cover', 'chin', 'bless', 'halt', 'wring', 'slump', 'lean', 'count', 'scratch'];
/** Work the hands can be busy with (Walker's own motions): ORRERY's occupation rule, hands busy while people talk. */
export const TASKS = ['hammer', 'dig', 'sweep', 'water', 'handwork', 'eat', 'pray', 'write', 'beg', 'guard', 'bell', 'drill'];
