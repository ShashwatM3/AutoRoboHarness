import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { workerViewports } from "./workerViewports.ts";
import { buildRobot } from "./robot.ts";

test("camera rectangles stay within distinct tiles on narrow and wide stores", () => {
  for (const [width, height] of [[380, 1480], [1100, 740], [620, 1480]]) {
    for (const count of [1, 2, 3, 4]) {
      const views = workerViewports(width, height, count);
      assert.equal(views.length, count);
      for (const view of views) {
        assert.ok(view.x >= 0 && view.y >= 0 && view.width > 0 && view.height > 0);
        assert.ok(view.x + view.width <= width + 0.001);
        assert.ok(view.y + view.height <= height + 0.001);
      }
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const a = views[i], b = views[j];
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
      }
    }
  }
});

test("head cameras follow driving, heading and torso lift and look forward/down", () => {
  const robot = buildRobot("robot-4", 0x80ae88);
  robot.root.updateMatrixWorld(true);
  const before = robot.headCamera.getWorldPosition(new Vector3());
  const forward = robot.headCamera.getWorldDirection(new Vector3());
  assert.ok(forward.z > 0.9 && forward.y < 0);
  robot.root.position.set(3, 0, 7);
  robot.lift.position.y += 1;
  robot.root.updateMatrixWorld(true);
  const after = robot.headCamera.getWorldPosition(new Vector3());
  assert.ok(after.distanceTo(before.clone().add(new Vector3(3, 1, 7))) < 0.0001);
  robot.root.rotation.y = Math.PI / 2;
  robot.root.updateMatrixWorld(true);
  assert.ok(robot.headCamera.getWorldDirection(new Vector3()).x > 0.9);
});
