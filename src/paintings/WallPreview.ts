import * as THREE from 'three';
import * as xb from 'xrblocks';

import {PaintingSpec} from './catalog.ts';
import {WallHitResult, WallScanner} from '../world/WallScanner.ts';

const _targetPos = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();

/**
 * Ghost placement preview frame that snaps flush onto detected walls
 * as the user aims with mouse, Meta Quest controller, or hand rays.
 */
export class WallPreview extends xb.Script {
  private wallScanner: WallScanner;
  private user!: xb.User;
  private depth!: xb.Depth;

  private frameGroup = new THREE.Group();
  private fillMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private borderLines!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private centerCross!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  private currentSpec: PaintingSpec;
  private currentScale = 1.0;
  private enabled = true;
  private hasPose = false;
  private latestHit: WallHitResult | null = null;

  constructor(wallScanner: WallScanner, initialSpec: PaintingSpec) {
    super();
    this.wallScanner = wallScanner;
    this.currentSpec = initialSpec;
    this.name = 'WallPlacementPreview';
    this.xb = {pointerEvents: 'none'};

    this.buildVisual();
    this.frameGroup.visible = false;
    this.add(this.frameGroup);
  }

  init() {
    this.user = xb.core.user;
    this.depth = xb.core.depth;
  }

  private buildVisual() {
    const fillGeo = new THREE.PlaneGeometry(1, 1);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x62e3a1,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.fillMesh = new THREE.Mesh(fillGeo, fillMat);
    this.fillMesh.position.z = 0.008;
    this.fillMesh.xb = {pointerEvents: 'none'};

    const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 0.025));
    const borderMat = new THREE.LineBasicMaterial({
      color: 0x7ef7b8,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.borderLines = new THREE.LineSegments(borderGeo, borderMat);
    this.borderLines.position.z = 0.015;
    this.borderLines.xb = {pointerEvents: 'none'};

    // Leveling crosshair in center
    const crossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.08, 0, 0),
      new THREE.Vector3(0.08, 0, 0),
      new THREE.Vector3(0, -0.08, 0),
      new THREE.Vector3(0, 0.08, 0),
    ]);
    const crossMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    this.centerCross = new THREE.LineSegments(crossGeo, crossMat);
    this.centerCross.position.z = 0.018;
    this.centerCross.xb = {pointerEvents: 'none'};

    this.frameGroup.add(this.fillMesh, this.borderLines, this.centerCross);
    this.applyDimensions();
  }

  setPainting(spec: PaintingSpec, scale: number) {
    this.currentSpec = spec;
    this.currentScale = scale;
    this.applyDimensions();
  }

  setScale(scale: number) {
    this.currentScale = scale;
    this.applyDimensions();
  }

  setPreviewEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.frameGroup.visible = false;
      this.hasPose = false;
      this.latestHit = null;
    }
  }

  private applyDimensions() {
    const matMargin = this.currentSpec.hasMatBoard ? 0.065 : 0.012;
    const frameBar = 0.068;
    const outerW = (this.currentSpec.widthMeters + (matMargin + frameBar) * 2) * this.currentScale;
    const outerH = (this.currentSpec.heightMeters + (matMargin + frameBar) * 2) * this.currentScale;

    this.fillMesh.scale.set(outerW, outerH, 1);
    this.borderLines.scale.set(outerW, outerH, 1);
  }

  getLatestValidHit(): WallHitResult | null {
    return this.latestHit?.isVerticalWall ? this.latestHit : null;
  }

  private isNonWallInteractiveHit(controllerId: number): boolean {
    const rayHit = this.user.getRayIntersection(controllerId);
    if (!rayHit) return false;
    const obj = rayHit.object;
    if (!obj) return false;

    // Ignore depthMesh and DetectedPlanes since those represent real-world surfaces
    if (obj === this.depth?.depthMesh) return false;
    if ((obj as xb.DetectedPlane).xrPlane !== undefined || (obj as xb.DetectedPlane).simulatorPlane !== undefined) {
      return false;
    }
    // Any UI card, button, or already-placed painting intercepts the ray
    return true;
  }

  update() {
    if (!this.enabled || !this.user) {
      this.frameGroup.visible = false;
      this.latestHit = null;
      return;
    }

    const dt = Math.min(xb.getDeltaTime(), 0.05);
    const activeControllerIds = this.getPreferredControllerIds();

    let bestHit: WallHitResult | null = null;
    for (const id of activeControllerIds) {
      if (this.isNonWallInteractiveHit(id)) {
        // User is pointing at UI or an existing painting
        this.frameGroup.visible = false;
        this.latestHit = null;
        return;
      }
      const hit = this.wallScanner.resolveWallHit(id);
      if (hit) {
        bestHit = hit;
        break;
      }
    }

    this.latestHit = bestHit;
    if (!bestHit) {
      this.frameGroup.visible = false;
      this.hasPose = false;
      return;
    }

    this.frameGroup.visible = true;
    _targetPos.copy(bestHit.point).addScaledVector(bestHit.normal, 0.012);
    WallScanner.computeWallQuaternion(bestHit.normal, _targetQuat);

    if (!this.hasPose) {
      this.frameGroup.position.copy(_targetPos);
      this.frameGroup.quaternion.copy(_targetQuat);
      this.hasPose = true;
    } else {
      const alpha = 1 - Math.exp(-18 * dt);
      this.frameGroup.position.lerp(_targetPos, alpha);
      this.frameGroup.quaternion.slerp(_targetQuat, alpha);
    }

    if (bestHit.isVerticalWall) {
      this.fillMesh.material.color.setHex(0x62e3a1);
      this.fillMesh.material.opacity = 0.16;
      this.borderLines.material.color.setHex(0x9ffad0);
      this.borderLines.material.opacity = 0.92;
    } else {
      // Non-vertical surface (floor/table/ceiling) — dimmed amber indicator
      this.fillMesh.material.color.setHex(0xf59e0b);
      this.fillMesh.material.opacity = 0.08;
      this.borderLines.material.color.setHex(0xfbbf24);
      this.borderLines.material.opacity = 0.5;
    }
  }

  private getPreferredControllerIds(): number[] {
    const ids: number[] = [];
    const controllers = this.user.controllers ?? [];
    // Prefer active/right controller first, then any other available controller (mouse is 0 on desktop)
    for (let i = controllers.length - 1; i >= 0; i--) {
      if (controllers[i]?.visible) ids.push(i);
    }
    if (ids.length === 0) {
      for (let i = 0; i < controllers.length; i++) ids.push(i);
    }
    if (ids.length === 0) ids.push(0);
    return ids;
  }

  dispose() {
    this.fillMesh.geometry.dispose();
    this.fillMesh.material.dispose();
    this.borderLines.geometry.dispose();
    this.borderLines.material.dispose();
    this.centerCross.geometry.dispose();
    this.centerCross.material.dispose();
  }
}
