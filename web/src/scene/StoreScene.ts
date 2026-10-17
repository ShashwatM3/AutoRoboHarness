import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHELF_HEIGHTS, type Scenario, type TrajectoryStep } from '../../../engine/store.ts';
import { buildRobot, setAperture, setExtension, type RobotRig } from './robot.ts';

const COLORS = [0xe58a48, 0x7899c4, 0xa188c2, 0x80ae88];
const ASSET_NAMES: Record<string, string> = { milk: 'carton', cereal: 'bowl-cereal', juice: 'carton-small', coffee: 'cup-coffee' };
type Motion = { started: number; duration: number; update: (progress: number) => void; complete: () => void };
type View = 'perspective' | 'overhead';

export class StoreScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  readonly renderer: THREE.WebGLRenderer;
  readonly robots = new Map<string, RobotRig>();
  readonly items = new Map<string, THREE.Object3D>();
  readonly ready: Promise<void>;
  readonly initial: Scenario;
  loadedAssets = 0;
  private controls: OrbitControls;
  private observer: ResizeObserver;
  private frame = 0;
  private motions = new Map<string, Motion>();
  private disposed = false;
  private grid: THREE.GridHelper;
  private labels: THREE.Sprite[] = [];
  private assetSources: THREE.Object3D[] = [];

  constructor(host: HTMLElement, initial: Scenario) {
    this.initial = structuredClone(initial);
    this.scene.background = new THREE.Color('#eaece2');
    this.scene.fog = new THREE.Fog('#eaece2', 35, 70);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D convenience store with two mobile robots');
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8; this.controls.maxDistance = 34;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.setView('perspective');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8b987e', 2.5));
    const sun = new THREE.DirectionalLight('#fff6dc', 3.5); sun.position.set(-8, 15, 9);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 0.1, far: 50 });
    sun.shadow.normalBias = 0.04; this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(15, 0.25, 17), new THREE.MeshStandardMaterial({ color: '#d9ddcf', roughness: 1 }));
    ground.position.set(0, -0.2, 2.7); ground.receiveShadow = true; this.scene.add(ground);
    this.grid = new THREE.GridHelper(40, 40, '#cad0c0', '#d9ddcf'); this.grid.position.y = -0.32; this.scene.add(this.grid);
    this.addMarkings();
    Object.values(initial.robots).forEach((robot, i) => {
      const rig = buildRobot(robot.id, COLORS[i]);
      rig.root.position.set(robot.x, 0, robot.y);
      this.scene.add(rig.root); this.robots.set(robot.id, rig);
      this.addLabel(`R0${i + 1}`, new THREE.Vector3(0, 2.65, 0), '#244a3a', rig.root, 0.6);
    });
    this.observer = new ResizeObserver(() => {
      const width = host.clientWidth, height = host.clientHeight;
      if (width && height) { this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }
    });
    this.observer.observe(host);
    this.ready = this.loadAssets();
    this.tick();
  }

  setView(view: View) {
    this.camera.position.set(...(view === 'overhead' ? [0.01, 24, 3] : [13, 15, 17]) as [number, number, number]);
    this.controls.target.set(0, 0.3, 2.8); this.controls.update();
  }
  setGrid(visible: boolean) { this.grid.visible = visible; }
  focusRobot(id: string) {
    const rig = this.robots.get(id);
    if (rig) { this.controls.target.copy(rig.root.position).add(new THREE.Vector3(0, 0.8, 0)); this.camera.position.copy(rig.root.position).add(new THREE.Vector3(5, 4, 6)); this.controls.update(); }
  }

  async playStep(step: TrajectoryStep, speed = 1): Promise<void> {
    await this.ready;
    if (this.disposed) return;
    const rig = this.robots.get(step.robot);
    if (!rig) throw new Error(`Unknown robot in animation: ${step.robot}`);
    const startPosition = rig.root.position.clone();
    const fromTorso = rig.lift.position.y, fromExtension = rig.extension, fromAperture = rig.aperture;
    const slotId = typeof step.args.slot === 'string' ? step.args.slot : step.robot_state?.reaching;
    const slot = slotId ? this.initial.layout.slots[slotId] : null;
    const startHeading = rig.root.rotation.y;
    const reachHeading = slot ? Math.atan2(slot.x - startPosition.x, slot.y - startPosition.z) : startHeading;
    let moved: THREE.Object3D | undefined;
    let placementStart: THREE.Vector3 | undefined;
    let placementTarget: THREE.Vector3 | undefined;
    if (step.ok && step.action === 'place' && step.item_id) {
      moved = this.items.get(step.item_id);
      if (moved) { this.scene.attach(moved); placementStart = moved.position.clone(); placementTarget = this.locationPosition(String(step.args.target), step.item_id); }
    }
    const points = step.path?.length ? step.path.map(p => new THREE.Vector3(p.x, 0, p.y)) : [startPosition, new THREE.Vector3(step.position.x, 0, step.position.y)];
    const duration = (step.action === 'navigate_to' ? Math.max(800, Math.min(2600, step.duration * 170)) : 650) / speed;
    await new Promise<void>(resolve => {
      this.motions.get(step.robot)?.complete();
      this.motions.set(step.robot, {
        started: performance.now(), duration,
        update: p => {
          const ease = p * p * (3 - 2 * p);
          if (!step.ok) {
            rig.root.position.x = startPosition.x + Math.sin(p * Math.PI * 6) * (1 - p) * 0.04;
            (rig.eye.material as THREE.MeshBasicMaterial).color.set('#e65e42');
            return;
          }
          switch (step.action) {
            case 'navigate_to': {
              const sample = this.samplePath(points, ease);
              rig.root.position.copy(sample.position);
              rig.root.rotation.y = sample.heading;
              rig.wheels.forEach(w => { w.rotation.x = p * step.duration * 2; });
              break;
            }
            case 'set_torso': rig.lift.position.y = THREE.MathUtils.lerp(fromTorso, SHELF_HEIGHTS[step.torso_level] + 0.06, ease); break;
            case 'reach':
              rig.root.rotation.y = THREE.MathUtils.lerp(startHeading, reachHeading, Math.min(1, p * 3));
              setExtension(rig, THREE.MathUtils.lerp(fromExtension, 1, ease)); break;
            case 'retract': setExtension(rig, THREE.MathUtils.lerp(fromExtension, 0, ease)); break;
            case 'grasp': setAperture(rig, THREE.MathUtils.lerp(fromAperture, 0, ease)); break;
            case 'place':
              setAperture(rig, THREE.MathUtils.lerp(fromAperture, 1, ease));
              if (moved && placementStart && placementTarget) moved.position.lerpVectors(placementStart, placementTarget, ease);
              break;
            case 'scan_slot': rig.eye.scale.x = 1 + Math.sin(p * Math.PI * 3) * 0.35; break;
            case 'report_issue': rig.ring.scale.setScalar(1 + Math.sin(p * Math.PI) * 0.2); break;
          }
        },
        complete: () => {
          if (step.ok) {
            rig.root.position.set(step.position.x, 0, step.position.y);
            rig.lift.position.y = SHELF_HEIGHTS[step.torso_level] + 0.06;
            if (step.action === 'grasp' && step.holding) {
              const item = this.items.get(step.holding);
              if (item) { rig.gripper.add(item); item.position.set(0, -0.06, 0.1); item.rotation.set(0, 0, 0); }
            }
            if (moved && placementTarget) moved.position.copy(placementTarget);
          } else rig.root.position.copy(startPosition);
          rig.eye.scale.x = 1; rig.ring.scale.setScalar(1);
          (rig.eye.material as THREE.MeshBasicMaterial).color.set(COLORS[[...this.robots.keys()].indexOf(step.robot)]);
          resolve();
        },
      });
    });
  }

  private samplePath(points: THREE.Vector3[], progress: number) {
    const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
    let remaining = lengths.reduce((a, b) => a + b, 0) * progress;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] || i === lengths.length - 1) return { position: points[i].clone().lerp(points[i + 1], lengths[i] ? remaining / lengths[i] : 1), heading: Math.atan2(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z) };
      remaining -= lengths[i];
    }
    return { position: points.at(-1)!.clone(), heading: 0 };
  }
  private locationPosition(location: string, id: string) {
    if (location === 'tote') return new THREE.Vector3(-0.4 + (id.length % 4) * 0.2, 0.35, 9.4);
    const slot = this.initial.layout.slots[location];
    return slot ? new THREE.Vector3(slot.x, slot.height + 0.02, slot.y) : new THREE.Vector3(0, 0.45, -3.65);
  }

  private async loadAssets() {
    const loader = new GLTFLoader();
    const load = async (pack: string, name: string) => {
      const result = await loader.loadAsync(`/assets/${pack}/${name}.glb`);
      if (this.disposed) return new THREE.Group();
      result.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.assetSources.push(result.scene); this.loadedAssets++;
      return result.scene;
    };
    const [floor, wall, boxes, bags, basket, ...foods] = await Promise.all([
      ...['floor', 'wall', 'shelf-boxes', 'shelf-bags', 'shopping-basket'].map(name => load('mini-market', name)),
      ...['carton', 'apple', 'bowl-cereal', 'orange', 'carton-small', 'bread', 'tomato', 'cup-coffee'].map(name => load('food-kit', name)),
    ]);
    if (this.disposed) return;
    const foodMap = new Map(['carton', 'apple', 'bowl-cereal', 'orange', 'carton-small', 'bread', 'tomato', 'cup-coffee'].map((key, i) => [key, foods[i]]));
    const unitFloor = this.fit(floor, new THREE.Vector3(1, 0.08, 1));
    // Repeated floor tiles share draw calls, leaving rendering time for moving robots.
    unitFloor.updateMatrixWorld(true);
    unitFloor.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const tiles = new THREE.InstancedMesh(node.geometry, node.material, 13 * 15);
      let index = 0;
      for (let x = -6; x <= 6; x++) for (let z = -4; z <= 10; z++) {
        tiles.setMatrixAt(index++, new THREE.Matrix4().makeTranslation(x, -0.035, z).multiply(node.matrixWorld));
      }
      tiles.receiveShadow = true;
      this.scene.add(tiles);
    });
    const unitWall = this.fit(wall, new THREE.Vector3(1, 0.75, 0.15));
    for (let x = -6; x <= 6; x++) { const part = unitWall.clone(); part.position.set(x, 0, -4.65); this.scene.add(part); }
    for (let z = -4; z <= 10; z++) { const part = unitWall.clone(); part.rotation.y = Math.PI / 2; part.position.set(-6.65, 0, z); this.scene.add(part); }
    // The supplied shelf meshes carry stock. Remove those named children, then place the engine's inventory.
    for (const shelf of [boxes, bags]) {
      const decorative: THREE.Object3D[] = [];
      shelf.traverse(o => { if (/^(carton|box|bag)(\.\d+)?$/i.test(o.name)) decorative.push(o); });
      decorative.forEach(o => o.removeFromParent());
    }
    for (const aisle of ['A', 'B'] as const) for (let bay = 1; bay <= 8; bay++) {
      const slot = this.initial.layout.slots[`${aisle}-${bay}-1-1`];
      const group = new THREE.Group(); group.position.set(slot.x, 0, (bay - 1) % 4 * 2 + 0.3);
      const shelf = this.fit((bay % 2 ? boxes : bags).clone(), new THREE.Vector3(1.55, 2.05, 0.65));
      shelf.rotation.y = Math.PI / 2; group.add(shelf);
      // Four exact shelf surfaces keep the engine's heights legible in the view.
      for (let level = 1; level <= 4; level++) {
        const surface = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.055, 1.57), new THREE.MeshStandardMaterial({ color: '#edeedc', roughness: 0.8 }));
        surface.position.y = SHELF_HEIGHTS[level] - 0.04; surface.receiveShadow = true; group.add(surface);
      }
      this.scene.add(group);
    }
    const tote = this.fit(basket, new THREE.Vector3(1.5, 0.5, 0.85)); tote.position.set(0, 0.04, 9.4); this.scene.add(tote);
    // Show one backroom stock bin per task; reserve inventory stays in its labelled storage area.
    const backroomItems = new Set(Object.values(this.initial.tasks).filter(t => t.type === 'RESTOCK').map(t => t.item_id));
    for (const item of Object.values(this.initial.items)) {
      if (item.slot.startsWith('backroom:') && !backroomItems.has(item.id)) continue;
      if (item.slot.startsWith('reserve:')) continue;
      const source = foodMap.get(ASSET_NAMES[item.asset] ?? item.asset)!;
      const mesh = this.fit(source.clone(), new THREE.Vector3(0.3, 0.32, 0.3), true);
      mesh.name = item.id; mesh.position.copy(this.locationPosition(item.slot, item.id));
      this.items.set(item.id, mesh); this.scene.add(mesh);
    }
    this.renderer.domElement.dataset.assetsLoaded = String(this.loadedAssets);
    this.renderer.domElement.dataset.shelfCount = '16';
  }
  private fit(source: THREE.Object3D, desired: THREE.Vector3, uniform = false) {
    const bounds = new THREE.Box3().setFromObject(source);
    const size = bounds.getSize(new THREE.Vector3());
    const ratio = new THREE.Vector3(desired.x / (size.x || 1), desired.y / (size.y || 1), desired.z / (size.z || 1));
    const group = new THREE.Group();
    source.scale.multiply(uniform ? new THREE.Vector3().setScalar(Math.min(ratio.x, ratio.y, ratio.z)) : ratio);
    const scaled = new THREE.Box3().setFromObject(source);
    const center = scaled.getCenter(new THREE.Vector3());
    source.position.sub(new THREE.Vector3(center.x, scaled.min.y, center.z));
    group.add(source); return group;
  }
  private addMarkings() {
    for (const [name, x] of [['AISLE A', -3.2], ['AISLE B', 3.2]] as const) {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 9.3), new THREE.MeshStandardMaterial({ color: '#e0e5d1', roughness: 1 }));
      lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.008, 3.2); this.scene.add(lane);
      this.addLabel(name, new THREE.Vector3(x, 0.07, 7.65), '#526545', this.scene, 1.7, true);
      for (let row = 1; row <= 4; row++) {
        this.addLabel(`0${row}`, new THREE.Vector3(x, 0.06, (row - 1) * 2 + 0.3), '#8d9b7f', this.scene, 0.65, true);
      }
    }
    this.addLabel('BACKROOM', new THREE.Vector3(0, 0.06, -3.8), '#687962', this.scene, 2.3, true);
    this.addLabel('ORDER TOTE', new THREE.Vector3(0, 0.07, 10.2), '#687962', this.scene, 2, true);
    for (const x of [-5.4, -1.2, 1.2, 5.4]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, 0.6), new THREE.MeshStandardMaterial({ color: '#bfac82', roughness: 1 }));
      box.position.set(x, 0.23, -3.4); box.castShadow = true; this.scene.add(box);
    }
  }
  private addLabel(text: string, position: THREE.Vector3, color: string, parent: THREE.Object3D, width: number, floor = false) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color; ctx.font = '600 48px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    if (floor) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
      label.rotation.x = -Math.PI / 2; label.position.copy(position); parent.add(label);
    } else {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
      sprite.scale.set(width, width / 4, 1); sprite.position.copy(position); parent.add(sprite); this.labels.push(sprite);
    }
  }
  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    for (const [id, motion] of this.motions) {
      const p = Math.min(1, (now - motion.started) / motion.duration);
      motion.update(p);
      if (p === 1) { this.motions.delete(id); motion.complete(); }
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.controls.dispose();
    for (const motion of this.motions.values()) motion.complete(); this.motions.clear();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    const collect = (o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        if (o instanceof THREE.Mesh) geometries.add(o.geometry);
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(mat);
          for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    };
    this.scene.traverse(collect); this.assetSources.forEach(source => source.traverse(collect));
    geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
