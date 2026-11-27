import * as THREE from 'three';
import * as xb from 'xrblocks';

import {FrameFinish, PaintingSpec} from './catalog.ts';
import {WallScanner} from '../world/WallScanner.ts';

const textureCache = new Map<string, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();

let sharedShadowTexture: THREE.CanvasTexture | null = null;

function getSoftShadowTexture(): THREE.CanvasTexture {
  if (sharedShadowTexture) return sharedShadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  // Soft rectangular ambient shadow behind frame
  const grad = ctx.createRadialGradient(128, 128, 52, 128, 128, 126);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  sharedShadowTexture = new THREE.CanvasTexture(canvas);
  sharedShadowTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedShadowTexture;
}

function getPaintingTexture(url: string): THREE.Texture {
  const cached = textureCache.get(url);
  if (cached) return cached;

  const texture = textureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  const renderer = xb.core.renderer;
  const maxAniso =
    renderer && 'capabilities' in renderer && renderer.capabilities?.getMaxAnisotropy
      ? renderer.capabilities.getMaxAnisotropy()
      : 4;
  texture.anisotropy = Math.min(maxAniso, 8);
  textureCache.set(url, texture);
  return texture;
}

const FRAME_PALETTE: Record<
  FrameFinish,
  {color: number; metalness: number; roughness: number; accentColor: number}
> = {
  gilded: {
    color: 0xc89d46,
    metalness: 0.86,
    roughness: 0.28,
    accentColor: 0xe6c36c,
  },
  walnut: {
    color: 0x4c2f1d,
    metalness: 0.08,
    roughness: 0.44,
    accentColor: 0xc8a052,
  },
  ebony: {
    color: 0x1d1b1a,
    metalness: 0.14,
    roughness: 0.36,
    accentColor: 0xd4b26a,
  },
};

const _vecA = new THREE.Vector3();
const _quatA = new THREE.Quaternion();

export interface FramedPaintingCallbacks {
  onSelect?: (painting: FramedPainting) => void;
  onScaleChanged?: (painting: FramedPainting) => void;
  wallScanner?: WallScanner;
}

/**
 * Multi-part 3D museum-framed classic painting anchored flush on a wall.
 * Supports mouse click, Meta Quest controller trigger/drag, and direct hand grab/pinch.
 */
export class FramedPainting extends xb.Script {
  readonly spec: PaintingSpec;
  private callbacks: FramedPaintingCallbacks;

  private rootGroup = new THREE.Group();
  private selectionOutline!: THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >;
  private plaqueMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private plaqueTexture!: THREE.CanvasTexture;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private isSelected = false;
  private isHovered = false;
  private targetScale = 1.0;
  private spawnProgress = 0;
  private plaqueVisible = true;
  private wallOffset = 0.012;

  constructor(
    spec: PaintingSpec,
    initialScale = 1.0,
    callbacks: FramedPaintingCallbacks = {}
  ) {
    super();
    this.spec = spec;
    this.targetScale = initialScale;
    this.callbacks = callbacks;
    this.name = `Painting: ${spec.title}`;

    this.xb = {
      manipulation: {
        actions: {
          translate: {faceCamera: false},
          scale: {minScale: 0.45, maxScale: 2.2},
          rotate: false,
        },
      },
    };

    this.buildFrameAssembly();
    this.scale.setScalar(0.05);
  }

  private createHollowRectShape(
    outerW: number,
    outerH: number,
    innerW: number,
    innerH: number
  ): THREE.Shape {
    const hw = outerW / 2;
    const hh = outerH / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();

    const ihw = innerW / 2;
    const ihh = innerH / 2;
    const hole = new THREE.Path();
    hole.moveTo(-ihw, -ihh);
    hole.lineTo(-ihw, ihh);
    hole.lineTo(ihw, ihh);
    hole.lineTo(ihw, -ihh);
    hole.closePath();
    shape.holes.push(hole);
    return shape;
  }

  private buildFrameAssembly() {
    const artW = this.spec.widthMeters;
    const artH = this.spec.heightMeters;
    const matMargin = this.spec.hasMatBoard ? 0.065 : 0.012;
    const innerW = artW + matMargin * 2;
    const innerH = artH + matMargin * 2;
    const frameBar = 0.068;
    const outerW = innerW + frameBar * 2;
    const outerH = innerH + frameBar * 2;
    const frameDepth = 0.036;

    const palette = FRAME_PALETTE[this.spec.frameFinish];

    // 1. Soft Wall Contact Shadow (sits right against wall plane)
    const shadowGeo = new THREE.PlaneGeometry(outerW * 1.18, outerH * 1.18);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: getSoftShadowTexture(),
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.set(0, -0.015, 0.001);
    shadowMesh.xb = {pointerEvents: 'none'};
    this.geometries.push(shadowGeo);
    this.materials.push(shadowMat);

    // 2. Hardboard Backing Panel
    const backGeo = new THREE.BoxGeometry(outerW - 0.01, outerH - 0.01, 0.008);
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x1b1714,
      roughness: 0.9,
      metalness: 0.05,
    });
    const backMesh = new THREE.Mesh(backGeo, backMat);
    backMesh.position.set(0, 0, 0.006);
    backMesh.castShadow = true;
    backMesh.receiveShadow = true;
    this.geometries.push(backGeo);
    this.materials.push(backMat);

    // 3. Outer Molded Frame (ExtrudeGeometry with beveled profile)
    const outerShape = this.createHollowRectShape(outerW, outerH, innerW, innerH);
    const frameGeo = new THREE.ExtrudeGeometry(outerShape, {
      depth: frameDepth,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.011,
      bevelSegments: 3,
      curveSegments: 1,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: palette.color,
      metalness: palette.metalness,
      roughness: palette.roughness,
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(0, 0, 0.012);
    frameMesh.castShadow = true;
    frameMesh.receiveShadow = true;
    this.geometries.push(frameGeo);
    this.materials.push(frameMat);

    // 4. Inner Gilded Fillet Trim Lip
    const filletWidth = 0.012;
    const filletShape = this.createHollowRectShape(
      innerW + filletWidth * 2,
      innerH + filletWidth * 2,
      innerW - 0.004,
      innerH - 0.004
    );
    const filletGeo = new THREE.ExtrudeGeometry(filletShape, {
      depth: 0.016,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 2,
    });
    const filletMat = new THREE.MeshStandardMaterial({
      color: palette.accentColor,
      metalness: 0.88,
      roughness: 0.22,
    });
    const filletMesh = new THREE.Mesh(filletGeo, filletMat);
    filletMesh.position.set(0, 0, 0.022);
    this.geometries.push(filletGeo);
    this.materials.push(filletMat);

    // 5. Museum Linen Mat Board / Passe-partout
    const matGeo = new THREE.PlaneGeometry(innerW, innerH);
    const matMaterial = new THREE.MeshStandardMaterial({
      color: this.spec.hasMatBoard ? 0xf3ede0 : 0x241e18,
      roughness: 0.92,
      metalness: 0.0,
    });
    const matMesh = new THREE.Mesh(matGeo, matMaterial);
    matMesh.position.set(0, 0, 0.019);
    matMesh.receiveShadow = true;
    this.geometries.push(matGeo);
    this.materials.push(matMaterial);

    // 6. Canvas Artwork Mesh
    const artGeo = new THREE.PlaneGeometry(artW, artH);
    const artTexture = getPaintingTexture(this.spec.imageUrl);
    const artMat = new THREE.MeshStandardMaterial({
      map: artTexture,
      roughness: 0.44,
      metalness: 0.02,
    });
    const artMesh = new THREE.Mesh(artGeo, artMat);
    artMesh.position.set(0, 0, 0.023);
    artMesh.receiveShadow = true;
    this.geometries.push(artGeo);
    this.materials.push(artMat);

    // 7. Museum Brass Nameplate below frame
    const plaqueW = Math.min(outerW * 0.72, 0.42);
    const plaqueH = 0.068;
    this.plaqueTexture = this.createPlaqueTexture();
    const plaqueGeo = new THREE.PlaneGeometry(plaqueW, plaqueH);
    const plaqueMat = new THREE.MeshStandardMaterial({
      map: this.plaqueTexture,
      roughness: 0.35,
      metalness: 0.25,
    });
    this.plaqueMesh = new THREE.Mesh(plaqueGeo, plaqueMat);
    this.plaqueMesh.position.set(0, -(outerH / 2 + 0.065), 0.014);
    this.plaqueMesh.visible = this.plaqueVisible;
    this.geometries.push(plaqueGeo);
    this.materials.push(plaqueMat);

    const plaqueBackingGeo = new THREE.BoxGeometry(plaqueW + 0.012, plaqueH + 0.012, 0.008);
    const plaqueBackingMat = new THREE.MeshStandardMaterial({
      color: 0xc29c4b,
      metalness: 0.85,
      roughness: 0.28,
    });
    const plaqueBacking = new THREE.Mesh(plaqueBackingGeo, plaqueBackingMat);
    plaqueBacking.position.set(0, 0, -0.005);
    this.plaqueMesh.add(plaqueBacking);
    this.geometries.push(plaqueBackingGeo);
    this.materials.push(plaqueBackingMat);

    // 8. Selection / Hover Halo Outline
    const haloGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(outerW + 0.045, outerH + 0.045, 0.055)
    );
    const haloMat = new THREE.LineBasicMaterial({
      color: 0xf7d070,
      transparent: true,
      opacity: 0,
    });
    this.selectionOutline = new THREE.LineSegments(haloGeo, haloMat);
    this.selectionOutline.position.set(0, 0, 0.025);
    this.selectionOutline.xb = {pointerEvents: 'none'};
    this.geometries.push(haloGeo);
    this.materials.push(haloMat);

    this.rootGroup.add(
      shadowMesh,
      backMesh,
      frameMesh,
      filletMesh,
      matMesh,
      artMesh,
      this.plaqueMesh,
      this.selectionOutline
    );
    this.add(this.rootGroup);
  }

  private createPlaqueTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 112;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#181512';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#c8a24b';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    ctx.fillStyle = '#f5eedc';
    ctx.font = 'bold 28px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.spec.title, canvas.width / 2, 40, canvas.width - 48);

    ctx.fillStyle = '#d3be90';
    ctx.font = '20px Georgia, serif';
    ctx.fillText(
      `${this.spec.artist}, ${this.spec.year}`,
      canvas.width / 2,
      78,
      canvas.width - 48
    );

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Positions and orients the painting flush against a detected wall point & outward normal.
   */
  placeOnWall(point: THREE.Vector3, wallNormal: THREE.Vector3) {
    _vecA.copy(wallNormal).normalize();
    this.position.copy(point).addScaledVector(_vecA, this.wallOffset);
    WallScanner.computeWallQuaternion(_vecA, _quatA);
    this.quaternion.copy(_quatA);
  }

  setPaintingScale(scaleFactor: number) {
    this.targetScale = THREE.MathUtils.clamp(scaleFactor, 0.45, 2.2);
    this.scale.setScalar(this.targetScale);
  }

  getPaintingScale(): number {
    return this.scale.x;
  }

  setSelected(selected: boolean) {
    this.isSelected = selected;
    this.refreshOutline();
  }

  setPlaqueVisible(visible: boolean) {
    this.plaqueVisible = visible;
    this.plaqueMesh.visible = visible;
  }

  private refreshOutline() {
    const mat = this.selectionOutline.material;
    if (this.isSelected) {
      mat.color.setHex(0xf7d070);
      mat.opacity = 0.95;
    } else if (this.isHovered) {
      mat.color.setHex(0x8ad0ff);
      mat.opacity = 0.65;
    } else {
      mat.opacity = 0;
    }
  }

  update() {
    const dt = Math.min(xb.getDeltaTime(), 0.05);
    if (this.spawnProgress < 1) {
      this.spawnProgress = Math.min(1, this.spawnProgress + dt * 5.2);
      // Crisp ease-out settle
      const eased = 1 - Math.pow(1 - this.spawnProgress, 3);
      this.scale.setScalar(
        THREE.MathUtils.lerp(0.05, this.targetScale, eased)
      );
    }
  }

  onObjectHoverEnter() {
    this.isHovered = true;
    this.refreshOutline();
  }

  onObjectHoverExit() {
    this.isHovered = false;
    this.refreshOutline();
  }

  onObjectSelectStart(event: xb.SelectEvent) {
    this.callbacks.onSelect?.(this);
    event.stopPropagation();
  }

  onObjectSelectEnd(event: xb.SelectEvent) {
    event.stopPropagation();
  }

  onObjectTouchStart(event: xb.ObjectTouchStartEvent) {
    this.callbacks.onSelect?.(this);
    event.stopPropagation();
  }

  onObjectManipulate(event: xb.ManipulationEvent) {
    if (event.phase === 'start') {
      this.callbacks.onSelect?.(this);
    } else if (event.phase === 'update') {
      if (event.action === 'scale') {
        this.targetScale = this.scale.x;
        this.callbacks.onScaleChanged?.(this);
      } else if (event.action === 'translate' && this.callbacks.wallScanner) {
        // Keep painting aligned upright while gliding near a wall
        const snap = this.callbacks.wallScanner.findNearestWallSnap(
          this.position,
          0.35
        );
        if (snap) {
          this.placeOnWall(snap.point, snap.normal);
        }
      }
    } else if (event.phase === 'end') {
      if (event.action === 'scale') {
        this.targetScale = this.scale.x;
        this.callbacks.onScaleChanged?.(this);
      }
      if (this.callbacks.wallScanner) {
        const snap = this.callbacks.wallScanner.findNearestWallSnap(
          this.position,
          0.55
        );
        if (snap) {
          this.placeOnWall(snap.point, snap.normal);
        }
      }
    }
  }

  dispose() {
    this.plaqueTexture.dispose();
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
