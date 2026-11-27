import * as THREE from 'three';
import * as xb from 'xrblocks';

export interface WallHitResult {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  isVerticalWall: boolean;
  source: 'plane' | 'depth';
  plane?: xb.DetectedPlane;
}

interface WallVisualEntry {
  plane: xb.DetectedPlane;
  group: THREE.Group;
  hitMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  outline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  gridMaterial: THREE.ShaderMaterial;
  worldNormal: THREE.Vector3;
  lastPolygonLen: number;
  lastChangedTime: number;
}

const _ray = new THREE.Ray();
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _raycaster = new THREE.Raycaster();

/**
 * Scans the real world (via WebXR PlaneDetection + DepthMesh) for vertical walls,
 * renders subtle architectural scan overlays, and resolves wall placement targets
 * for mouse, Meta Quest controllers, and hand rays.
 */
export class WallScanner extends xb.Script {
  static dependencies = {
    world: xb.World,
    depth: xb.Depth,
    user: xb.User,
    camera: THREE.Camera,
  };

  private world!: xb.World;
  private depth!: xb.Depth;
  private user!: xb.User;
  private camera!: THREE.Camera;

  private visuals = new Map<xb.DetectedPlane, WallVisualEntry>();
  private hitMeshes: THREE.Mesh[] = [];
  private showWallsOverlay = true;
  private elapsed = 0;

  private invisibleHitMaterial = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide,
  });

  init({
    world,
    depth,
    user,
    camera,
  }: {
    world: xb.World;
    depth: xb.Depth;
    user: xb.User;
    camera: THREE.Camera;
  }) {
    this.world = world;
    this.depth = depth;
    this.user = user;
    this.camera = camera;
  }

  get wallCount(): number {
    return this.visuals.size;
  }

  get wallsVisible(): boolean {
    return this.showWallsOverlay;
  }

  setWallsVisible(visible: boolean) {
    this.showWallsOverlay = visible;
    for (const entry of this.visuals.values()) {
      entry.gridMaterial.uniforms.uVisible.value = visible ? 1.0 : 0.0;
      entry.outline.visible = visible;
    }
  }

  toggleWallsVisible(): boolean {
    this.setWallsVisible(!this.showWallsOverlay);
    return this.showWallsOverlay;
  }

  /**
   * Triggers room capture on Meta Quest 3 if supported, or refreshes wall overlays.
   */
  async triggerRescan(): Promise<boolean> {
    const session = xb.core.renderer?.xr?.getSession?.();
    if (session && typeof session.initiateRoomCapture === 'function') {
      try {
        await session.initiateRoomCapture();
        return true;
      } catch (err) {
        console.warn('Room capture request declined or unavailable:', err);
      }
    }
    return false;
  }

  update() {
    const dt = xb.getDeltaTime();
    this.elapsed += dt;
    this.syncDetectedWalls();

    for (const entry of this.visuals.values()) {
      entry.gridMaterial.uniforms.uTime.value = this.elapsed;
    }
  }

  private syncDetectedWalls() {
    const planeDetector = this.world?.planes;
    if (!planeDetector) return;

    const allPlanes = planeDetector.get();
    const activeWallSet = new Set<xb.DetectedPlane>();

    for (const plane of allPlanes) {
      if (!this.isWallPlane(plane)) continue;
      activeWallSet.add(plane);

      const existing = this.visuals.get(plane);
      if (existing) {
        this.updateWallEntryTransform(existing);
      } else {
        this.createWallEntry(plane);
      }
    }

    // Remove planes that disappeared
    for (const [plane, entry] of this.visuals.entries()) {
      if (!activeWallSet.has(plane)) {
        this.removeWallEntry(plane, entry);
      }
    }
  }

  private isWallPlane(plane: xb.DetectedPlane): boolean {
    const label = plane.label?.toLowerCase();
    if (label === 'wall') return true;
    if (label === 'floor' || label === 'ceiling' || label === 'table' || label === 'desk' || label === 'couch' || label === 'bed') {
      return false;
    }
    // Check orientation or world normal
    const orientation = plane.orientation?.toLowerCase();
    if (orientation === 'vertical') return true;

    plane.getWorldQuaternion(_quat);
    _vecA.set(0, 1, 0).applyQuaternion(_quat).normalize();
    return Math.abs(_vecA.y) < 0.35;
  }

  private buildPlaneShapeGeometry(plane: xb.DetectedPlane): {
    geometry: THREE.BufferGeometry;
    polygonLen: number;
  } {
    let points: THREE.Vector2[] = [];
    if (plane.xrPlane?.polygon && plane.xrPlane.polygon.length >= 3) {
      for (const p of plane.xrPlane.polygon) {
        points.push(new THREE.Vector2(p.x, p.z));
      }
    } else if (plane.simulatorPlane?.polygon && plane.simulatorPlane.polygon.length >= 3) {
      points = plane.simulatorPlane.polygon.map((p) => new THREE.Vector2(p.x, p.y));
    }

    if (points.length >= 3) {
      const shape = new THREE.Shape(points);
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(Math.PI / 2);
      geom.computeBoundingBox();
      return {geometry: geom, polygonLen: points.length};
    }

    // Fallback: clone existing geometry
    const cloned = plane.geometry.clone();
    cloned.computeBoundingBox();
    return {geometry: cloned, polygonLen: 0};
  }

  private createWallEntry(plane: xb.DetectedPlane) {
    const {geometry, polygonLen} = this.buildPlaneShapeGeometry(plane);

    const group = new THREE.Group();
    group.name = 'DetectedWallVisual';
    group.xb = {pointerEvents: 'none'};

    const hitMesh = new THREE.Mesh(geometry, this.invisibleHitMaterial);
    hitMesh.xb = {pointerEvents: 'none'};

    const gridMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uTime: {value: this.elapsed},
        uVisible: {value: this.showWallsOverlay ? 1.0 : 0.0},
        uColor: {value: new THREE.Color(0x78c8ff)},
        uAccent: {value: new THREE.Color(0xf4cf7b)},
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vLocalPos;
        uniform float uTime;
        uniform float uVisible;
        uniform vec3 uColor;
        uniform vec3 uAccent;

        void main() {
          if (uVisible < 0.01) discard;
          // Subtle architectural 0.25m measurement grid in plane XZ space
          vec2 coord = vLocalPos.xz * 4.0;
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float line = 1.0 - min(min(grid.x, grid.y), 1.0);

          // Gentle scan sweep wave
          float wave = 0.5 + 0.5 * sin(vLocalPos.x * 1.4 - uTime * 1.3 + vLocalPos.z * 0.9);
          vec3 col = mix(uColor, uAccent, wave * 0.25);
          float alpha = (0.045 + line * 0.16) * uVisible;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const overlayMesh = new THREE.Mesh(geometry, gridMaterial);
    overlayMesh.xb = {pointerEvents: 'none'};
    overlayMesh.renderOrder = 2;

    const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
    const outlineMat = new THREE.LineBasicMaterial({
      color: 0x8ad0ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const outline = new THREE.LineSegments(edgesGeo, outlineMat);
    outline.visible = this.showWallsOverlay;
    outline.xb = {pointerEvents: 'none'};
    outline.renderOrder = 3;

    group.add(hitMesh, overlayMesh, outline);
    this.add(group);

    const entry: WallVisualEntry = {
      plane,
      group,
      hitMesh,
      outline,
      gridMaterial,
      worldNormal: new THREE.Vector3(),
      lastPolygonLen: polygonLen,
      lastChangedTime: plane.xrPlane?.lastChangedTime ?? 0,
    };

    this.updateWallEntryTransform(entry);
    this.visuals.set(plane, entry);
    this.hitMeshes.push(hitMesh);
  }

  private updateWallEntryTransform(entry: WallVisualEntry) {
    const currentChangedTime = entry.plane.xrPlane?.lastChangedTime ?? 0;
    if (currentChangedTime > entry.lastChangedTime) {
      entry.lastChangedTime = currentChangedTime;
      const {geometry, polygonLen} = this.buildPlaneShapeGeometry(entry.plane);
      entry.lastPolygonLen = polygonLen;
      entry.hitMesh.geometry.dispose();
      entry.hitMesh.geometry = geometry;
      // overlayMesh shares geometry with hitMesh
      const overlayMesh = entry.group.children[1] as THREE.Mesh;
      if (overlayMesh) overlayMesh.geometry = geometry;
      entry.outline.geometry.dispose();
      entry.outline.geometry = new THREE.EdgesGeometry(geometry, 15);
    }

    entry.plane.updateWorldMatrix(true, false);
    entry.plane.matrixWorld.decompose(_vecA, _quat, _vecB);
    entry.group.position.copy(_vecA);
    entry.group.quaternion.copy(_quat);
    entry.group.scale.copy(_vecB);
    entry.group.updateWorldMatrix(true, true);

    // Local +Y of planeSpace is the plane's normal
    entry.worldNormal.set(0, 1, 0).applyQuaternion(_quat).normalize();
  }

  private removeWallEntry(plane: xb.DetectedPlane, entry: WallVisualEntry) {
    entry.group.removeFromParent();
    const idx = this.hitMeshes.indexOf(entry.hitMesh);
    if (idx !== -1) this.hitMeshes.splice(idx, 1);

    entry.hitMesh.geometry.dispose();
    entry.outline.geometry.dispose();
    entry.outline.material.dispose();
    entry.gridMaterial.dispose();
    this.visuals.delete(plane);
  }

  /**
   * Resolves whether the given controller/mouse/hand ray is pointing at a wall
   * (prioritizing detected wall planes, falling back to depthMesh surfaces).
   */
  resolveWallHit(controllerId: number): WallHitResult | null {
    this.user.getRay(controllerId, _ray);
    if (_ray.direction.lengthSq() < 0.0001) return null;

    this.camera.getWorldPosition(_vecC);

    // 1. Check detected wall planes first (cleanest geometry & guaranteed wall semantic)
    if (this.hitMeshes.length > 0) {
      _raycaster.set(_ray.origin, _ray.direction);
      _raycaster.near = 0.2;
      _raycaster.far = 12;
      const hits = _raycaster.intersectObjects(this.hitMeshes, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const entry = this.findEntryByHitMesh(hit.object);
        const normal = new THREE.Vector3(0, 1, 0);
        if (entry) {
          normal.copy(entry.worldNormal);
        } else if (hit.face) {
          normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        }
        // Always orient normal toward the viewer
        _vecA.subVectors(_vecC, hit.point);
        if (normal.dot(_vecA) < 0) normal.negate();
        // Keep wall normals strictly plumb/horizontal for clean hanging
        if (Math.abs(normal.y) < 0.35) {
          normal.y = 0;
          normal.normalize();
        }

        return {
          point: hit.point.clone(),
          normal,
          distance: hit.distance,
          isVerticalWall: Math.abs(normal.y) < 0.38,
          source: 'plane',
          plane: entry?.plane,
        };
      }
    }

    // 2. Fallback to real-time DepthMesh (works even before room capture or on unmapped surfaces)
    const depthMesh = this.depth?.depthMesh;
    if (depthMesh) {
      const depthHit = this.user.getIntersectionAt(depthMesh, controllerId);
      if (depthHit) {
        const localNormal =
          (depthHit as THREE.Intersection & {normal?: THREE.Vector3}).normal ??
          depthHit.face?.normal;
        const normal = new THREE.Vector3(0, 0, 1);
        if (localNormal) {
          depthHit.object.updateWorldMatrix(true, false);
          normal.copy(localNormal).transformDirection(depthHit.object.matrixWorld).normalize();
        } else {
          // Estimate facing viewer if normal missing
          normal.subVectors(_vecC, depthHit.point).normalize();
        }

        _vecA.subVectors(_vecC, depthHit.point);
        if (normal.dot(_vecA) < 0) normal.negate();

        const isVerticalWall = Math.abs(normal.y) < 0.38;
        if (isVerticalWall) {
          // Level out minor depth-sensor vertical tilt so paintings hang plumb
          normal.y = 0;
          if (normal.lengthSq() > 0.001) normal.normalize();
        }

        return {
          point: depthHit.point.clone(),
          normal,
          distance: depthHit.distance,
          isVerticalWall,
          source: 'depth',
        };
      }
    }

    return null;
  }

  /**
   * Finds the nearest detected wall plane within `maxDistance` meters of a world position,
   * returning a snapped point & outward normal if found.
   */
  findNearestWallSnap(
    worldPosition: THREE.Vector3,
    maxDistance = 0.45
  ): {point: THREE.Vector3; normal: THREE.Vector3} | null {
    if (this.hitMeshes.length === 0) return null;

    this.camera.getWorldPosition(_vecC);
    let bestDist = maxDistance;
    let bestPoint: THREE.Vector3 | null = null;
    let bestNormal: THREE.Vector3 | null = null;

    for (const entry of this.visuals.values()) {
      const n = _vecA.copy(entry.worldNormal);
      _vecB.subVectors(_vecC, entry.group.position);
      if (n.dot(_vecB) < 0) n.negate();

      // Cast perpendicular ray toward and away from the plane
      for (const sign of [-1, 1]) {
        _vecB.copy(n).multiplyScalar(sign);
        _raycaster.set(worldPosition, _vecB);
        _raycaster.near = 0;
        _raycaster.far = bestDist;
        const hits = _raycaster.intersectObject(entry.hitMesh, false);
        if (hits.length > 0 && hits[0].distance < bestDist) {
          bestDist = hits[0].distance;
          bestPoint = hits[0].point.clone();
          bestNormal = n.clone();
          if (Math.abs(bestNormal.y) < 0.35) {
            bestNormal.y = 0;
            bestNormal.normalize();
          }
        }
      }
    }

    if (bestPoint && bestNormal) {
      return {point: bestPoint, normal: bestNormal};
    }
    return null;
  }

  private findEntryByHitMesh(mesh: THREE.Object3D): WallVisualEntry | undefined {
    for (const entry of this.visuals.values()) {
      if (entry.hitMesh === mesh) return entry;
    }
    return undefined;
  }

  /**
   * Computes a plumb wall-aligned orientation quaternion where local +Z points
   * outward along `wallNormal` and local +Y points upright.
   */
  static computeWallQuaternion(wallNormal: THREE.Vector3, target = new THREE.Quaternion()): THREE.Quaternion {
    _vecB.set(0, 1, 0);
    // Right = Up x Normal
    _vecA.crossVectors(_vecB, wallNormal);
    if (_vecA.lengthSq() < 0.0001) {
      _vecA.set(1, 0, 0);
    } else {
      _vecA.normalize();
    }
    // TrueUp = Normal x Right
    _vecC.crossVectors(wallNormal, _vecA).normalize();
    _mat4.makeBasis(_vecA, _vecC, wallNormal);
    return target.setFromRotationMatrix(_mat4);
  }

  dispose() {
    for (const [plane, entry] of Array.from(this.visuals.entries())) {
      this.removeWallEntry(plane, entry);
    }
    this.invisibleHitMaterial.dispose();
  }
}
