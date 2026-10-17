import * as THREE from "three";
import { SHELF_HEIGHTS } from "../../../engine/store.ts";

export interface RobotRig {
  root: THREE.Group;
  lift: THREE.Group;
  shoulder: THREE.Group;
  elbow: THREE.Group;
  gripper: THREE.Group;
  fingers: THREE.Mesh[];
  wheels: THREE.Mesh[];
  ring: THREE.Mesh;
  eye: THREE.Mesh;
  extension: number;
  aperture: number;
}

const material = (color: THREE.ColorRepresentation, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness });
function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildRobot(id: string, color: number): RobotRig {
  const root = new THREE.Group();
  root.name = id;
  const shell = material("#f5f3e9", 0.15),
    dark = material("#283934", 0.35),
    accent = material(color),
    rubber = material("#19251f");
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.36, 0.22, 32),
    shell,
  );
  base.position.y = 0.25;
  base.castShadow = true;
  root.add(base);
  const wheels: THREE.Mesh[] = [];
  for (const x of [-0.31, 0.31]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.065, 20),
      rubber,
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.15, 0);
    root.add(wheel);
    wheels.push(wheel);
  }
  box(root, [0.16, 1.6, 0.18], [0, 1.08, -0.12], dark);
  const lift = new THREE.Group();
  root.add(lift);
  box(lift, [0.3, 0.29, 0.28], [0, 0, 0], shell);
  box(lift, [0.19, 0.035, 0.015], [0, 0.025, 0.15], accent);
  const head = new THREE.Group();
  head.position.set(0, 0.4, 0);
  lift.add(head);
  box(head, [0.34, 0.2, 0.22], [0, 0, 0], shell);
  box(head, [0.27, 0.11, 0.025], [0, 0.005, 0.12], dark);
  const eye = box(
    head,
    [0.18, 0.025, 0.028],
    [0, 0.005, 0.135],
    new THREE.MeshBasicMaterial({ color }),
  );
  const shoulder = new THREE.Group();
  shoulder.position.set(0.17, 0.03, 0.1);
  lift.add(shoulder);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), dark);
  shoulder.add(joint);
  box(shoulder, [0.11, 0.11, 0.46], [0, 0, 0.23], shell);
  const elbow = new THREE.Group();
  elbow.position.z = 0.46;
  shoulder.add(elbow);
  elbow.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), accent));
  box(elbow, [0.09, 0.09, 0.4], [0, 0, 0.2], shell);
  const gripper = new THREE.Group();
  gripper.name = `${id}:gripper`;
  gripper.position.z = 0.45;
  elbow.add(gripper);
  box(gripper, [0.19, 0.085, 0.08], [0, 0, 0], dark);
  const fingers = [-1, 1].map((side) =>
    box(gripper, [0.035, 0.09, 0.15], [side * 0.09, 0, 0.09], dark),
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.41, 0.44, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  root.add(ring);
  const rig = {
    root,
    lift,
    shoulder,
    elbow,
    gripper,
    fingers,
    wheels,
    ring,
    eye,
    extension: 0,
    aperture: 1,
  };
  lift.position.y = SHELF_HEIGHTS[1] + 0.06;
  setExtension(rig, 0);
  setAperture(rig, 1);
  return rig;
}

export function setExtension(rig: RobotRig, amount: number) {
  rig.extension = amount;
  rig.shoulder.rotation.x = THREE.MathUtils.lerp(-1.05, -0.08, amount);
  rig.elbow.rotation.x = THREE.MathUtils.lerp(2.15, 0.16, amount);
}

export function setAperture(rig: RobotRig, amount: number) {
  rig.aperture = amount;
  rig.fingers.forEach((finger, i) => {
    finger.position.x =
      (i === 0 ? -1 : 1) * THREE.MathUtils.lerp(0.045, 0.12, amount);
  });
}
