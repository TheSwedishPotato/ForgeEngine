# Story: the branching story runner

A story is JSON. `StoryRunner` plays it. `StorySystem` connects it to the engine: its timers run in game time, and it reads keys
for quick-time events and choices. The UI is yours. The runner hands it a *view* of the current node, and the UI calls
`choose(i)`.

```js
import { StoryRunner, StorySystem, validateStory } from 'medengine';

const data = await engine.assets.json('assets/story/ford.story.json');
const story = StoryRunner.from(data, { seed: 7 });         // throws one error that lists every problem in a broken story
engine.add(new StorySystem(story));                        // or call story.update(dt) yourself
story.on('enter', (view) => ui.show(view));                // view: lines, choices, and the timer, QTE or meter of the node
story.on('end', ({ ending }) => ui.ending(ending));
story.start();
// a click on view.choices[i]:
story.choose(view.choices[i].index);

const save = story.save();                                 // plain JSON: node, variables, items, visits, random state
story.load(save);
```

`validateStory(data)` returns `{ errors, warnings }` without throwing, so a test can check a 400-node story for dangling links,
dead ends, bad expressions and variables that are read but never set. `fuzzStory(data, { runs: 1500 })` plays it with random
choices and reports endings reached, nodes never visited, softlocks and endless loops. The demo's story is fuzzed in the tests.

## The file

```json
{
  "title": "The Ford at Dawn",
  "start": "camp",
  "vars": { "gold": 8, "trust": 0 },
  "items": { "letter": 1 },
  "nodes": {
    "camp": {
      "speaker": "Narrator",
      "text": ["Grey light creeps over the river.", "You have {gold} coins."],
      "choices": [
        { "text": "Go down to the ford", "goto": "ford" },
        { "text": "Pay the ferryman", "if": "gold >= 2", "show": "disabled", "hint": "You need 2 gold.", "do": ["gold -= 2"], "goto": "ferry" },
        { "text": "Study the letter's seal", "once": true, "do": ["read_seal = true"], "say": "A second mark you do not know." }
      ]
    }
  }
}
```

`vars` holds variables and their starting values. `items` holds what the player carries: a list, or names with counts.

## Text

`text` is a string or a list of lines. Each line is a string or an object `{ "text", "speaker", "if" }`. `{expression}` inside
text is filled in: `"You have {gold} coins."`. A node's `speaker` is the default for its lines.

## Node types

The type is given by `"type"`, or guessed from the fields.

| Type | Fields | |
| --- | --- | --- |
| `scene` (default) | `text`, `choices`, or `goto` | Text and choices. A scene with only `goto` gets one "Continue" choice (`continueText`). |
| `timed` | `seconds`, `choices`, `timeout` | A scene with a clock. `timeout` is a node, or the index of the choice taken when time runs out. |
| `qte` | `keys` + `window` + `allowMisses`, **or** `mash: { key, count, seconds }`; `success`, `fail` | A key sequence, each key within `window` seconds, or a button mash against the clock. Key names are `KeyboardEvent.code`. |
| `negotiation` | `meter: { name, min, max, start }`, `win`, `lose`, `rounds`, `options`, `onWin`, `onLose`, `onTimeout` | Each option moves the meter by `delta`. With `risk` (a probability) it may move it by `riskDelta` instead, and show `failText` rather than `reply`. |
| `explore` | `spots` (like choices) | A place with things to look at and ways out. Spots without `goto` stay in the node. |
| `branch` | `cases: [{ if, goto, do }]`, `else` | No text: the first case whose condition holds wins |
| `random` | `options: [{ weight, goto, if, do }]` | A weighted pick, using the runner's seeded random numbers |
| `end` | `ending`, `text` | An ending. Endings reached are remembered across playthroughs (`ended('drowned')`). |

Every node can have `on`: statements run each time it is entered.

**Choices** (and spots and negotiation options):

- `text` and `goto`;
- `if`: a condition. A choice that fails it is hidden, or with `"show": "disabled"` greyed out with a `hint`;
- `do`: a list of statements;
- `say`: a line added to the transcript;
- `once`: it can be taken only one time;
- `check` with `success` and `fail`: a condition that decides where the choice leads (`passText` and `failText`);
- `id`: a name for `used('id')`.

## Expressions

Conditions and effects use a small, safe expression language. There is no `eval`: a story file or a save cannot run code.

```
conditions   gold >= 5 and not has('key')        trust > 2 || visited('temple')        d(20) + strength >= 12
statements   gold -= 5      met_king = true      trust = clamp(trust + 2, -10, 10)     give key      take coin 3
```

**Operators:** `?:`, `or`/`||`, `and`/`&&`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, `%` and `not`/`!`.

**Functions:**

- `has(item)`, `count(item)`;
- `visited(node)`, `visits(node)`, `used(id)`, `ended(name)`;
- `chance(p)`, `d(sides)`, `rand()`;
- `min`, `max`, `abs`, `floor`, `ceil`, `round` and `clamp`.

An unknown variable reads as 0. The validator warns about variables that are read but never set.

## The flowchart

`storyGraph(data)`, `toMermaid(data)` and `toDOT(data)` draw the whole story. `story.flowchart()` marks where this playthrough
has been, for an in-game map.
