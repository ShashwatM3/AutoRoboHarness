import { createEngine } from '../store.ts';

const engine = createEngine(1, { onStep: step => console.log(JSON.stringify(step)) });
const task = engine.createTask('robot-1', 'PICK', 'A-3-4-1');
const slot = engine.scenario.layout.slots[task.source];
engine.setBrainNodesRead('robot-1', []);
engine.navigate_to('robot-1', slot.waypoint);
engine.set_torso('robot-1', slot.level);
engine.scan_slot('robot-1', slot.id);
engine.reach('robot-1', slot.id);
engine.grasp('robot-1', 'two_hand');
engine.retract('robot-1');
engine.navigate_to('robot-1', 'tote');
engine.place('robot-1', 'tote');
if (!engine.score()[0].complete) process.exitCode = 1;
