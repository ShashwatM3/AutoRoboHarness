# Version 3, Person A: The Adversarial Attack Button

- Add an engine function `applyDisturbance(scenario, kind, params)` for a fixed list of realistic disturbances: a box blocking one aisle segment, an item moved to the wrong slot, a heavy item moved to the top shelf, an item placed behind a fresh one.
- The red **Adversarial attack** button calls `POST /adversary` (Person B wires the model call if time allows; otherwise the server tries each disturbance in turn).
- The server plays each disturbed scenario headless with the current brain and keeps the ones that end with the item not at its target.
- The review screen shows "tried N, broke the brain M times" and adds those shifts to the failures list, labelled "found by adversary." Disturbed scenarios use training seeds only, never seeds 101 to 110.
