import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';

import {CLASSIC_PAINTINGS, PaintingSpec} from './paintings/catalog.ts';
import {FramedPainting} from './paintings/FramedPainting.ts';
import {WallPreview} from './paintings/WallPreview.ts';
import {GalleryUI} from './ui/GalleryUI.ts';
import {WallScanner} from './world/WallScanner.ts';

/**
 * Root XR Blocks script for Atelier XR:
 * scans real-world walls, previews frame placement, hangs classic paintings,
 * and supports mouse, Meta Quest controllers, and hand tracking.
 */
export class AtelierScene extends xb.Script {
  static dependencies = {
    depth: xb.Depth,
    user: xb.User,
    world: xb.World,
    camera: THREE.Camera,
  };

  private depth!: xb.Depth;
  private user!: xb.User;

  private wallScanner!: WallScanner;
  private wallPreview!: WallPreview;
  private galleryUI!: GalleryUI;

  private placedPaintings: FramedPainting[] = [];
  private selectedPainting: FramedPainting | null = null;
  private activeSpec: PaintingSpec = CLASSIC_PAINTINGS[0];
  private defaultScale = 1.0;

  private envMapTexture: THREE.Texture | null = null;
  private lastWallCount = -1;
  private lastPlacedCount = -1;
  private uiValidated = false;
  private frameCounter = 0;

  init({
    depth,
    user,
  }: {
    depth: xb.Depth;
    user: xb.User;
  }) {
    this.depth = depth;
    this.user = user;

    this.setupLightingAndEnvironment();

    this.wallScanner = new WallScanner();
    this.add(this.wallScanner);

    this.wallPreview = new WallPreview(this.wallScanner, this.activeSpec);
    this.add(this.wallPreview);

    this.galleryUI = new GalleryUI({
      onSelectCatalogPainting: (spec) => {
        this.activeSpec = spec;
        this.wallPreview.setPainting(spec, this.defaultScale);
      },
      onDefaultScaleChanged: (scale) => {
        this.defaultScale = scale;
        this.wallPreview.setScale(scale);
      },
      onToggleWalls: () => {
        const visible = this.wallScanner.toggleWallsVisible();
        this.galleryUI.setHint(
          visible
            ? 'Wall scan grid shown. Aim at any wall and click, trigger, or pinch to hang.'
            : 'Wall scan grid hidden for clean gallery viewing.'
        );
        return visible;
      },
      onRescanRoom: () => {
        void this.handleRescan();
      },
      onUndoLast: () => this.undoLastPainting(),
      onClearAll: () => this.clearAllPaintings(),
      onInspectorScaleChanged: (painting, scale) => {
        painting.setPaintingScale(scale);
      },
      onSnapToWall: (painting) => {
        const snap = this.wallScanner.findNearestWallSnap(painting.position, 1.5);
        if (snap) {
          painting.placeOnWall(snap.point, snap.normal);
          this.galleryUI.setHint(`Snapped "${painting.spec.title}" flush to wall.`);
        } else {
          this.galleryUI.setHint('No detected wall within 1.5 m to snap to.');
        }
      },
      onTogglePlaque: (painting) => {
        const next = !(painting.userData.plaqueVisible ?? true);
        painting.userData.plaqueVisible = next;
        painting.setPlaqueVisible(next);
        return next;
      },
      onRemovePainting: (painting) => this.removePainting(painting),
      onDeselectPainting: () => this.selectPlacedPainting(null),
    });
    this.add(this.galleryUI);
  }

  private setupLightingAndEnvironment() {
    const hemi = new THREE.HemisphereLight(0xfff7ea, 0x3b4454, 1.9);
    this.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    keyLight.position.set(2.5, 4.5, 2.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd9e8ff, 0.85);
    fillLight.position.set(-3.0, 2.2, -1.5);
    this.add(fillLight);

    const renderer = xb.core.renderer;
    const scene = xb.core.scene;
    if (renderer && scene && 'capabilities' in renderer) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer as THREE.WebGLRenderer);
        const roomEnv = new RoomEnvironment();
        this.envMapTexture = pmrem.fromScene(roomEnv, 0.04).texture;
        scene.environment = this.envMapTexture;
        roomEnv.dispose();
        pmrem.dispose();
      } catch (err) {
        console.warn('Could not initialize RoomEnvironment PMREM:', err);
      }
    }
  }

  private async handleRescan() {
    const started = await this.wallScanner.triggerRescan();
    if (started) {
      this.galleryUI.setHint('Room scan started — look around your walls to map surfaces.');
    } else {
      this.wallScanner.setWallsVisible(true);
      this.galleryUI.setHint(
        'Look around your room to detect vertical walls, or aim directly at any wall.'
      );
    }
  }

  update() {
    this.frameCounter++;
    const wallCount = this.wallScanner.wallCount;
    const placedCount = this.placedPaintings.length;

    if (wallCount !== this.lastWallCount || placedCount !== this.lastPlacedCount) {
      this.lastWallCount = wallCount;
      this.lastPlacedCount = placedCount;
      this.galleryUI.updateStatus(wallCount, placedCount);
    }

    if (!this.uiValidated && this.frameCounter > 20) {
      this.uiValidated = true;
      const report = xb.ui?.validate?.();
      if (report && !report.ok) {
        console.warn('Spatial UI validation issues:', report.issues);
      }
    }
  }

  onSelect(event: xb.SelectEvent) {
    // Do not place a new painting if user interacted with UI or an existing painting
    if (this.isInteractiveTarget(event.target)) {
      return;
    }

    const controllerId = event.source.controller?.userData?.id ?? 0;
    const hit =
      this.wallScanner.resolveWallHit(controllerId) ??
      this.wallPreview.getLatestValidHit();

    if (!hit) {
      this.selectPlacedPainting(null);
      return;
    }

    if (!hit.isVerticalWall) {
      this.galleryUI.setHint(
        'That looks like a floor or table. Aim at a vertical wall (green frame) to hang a painting.'
      );
      return;
    }

    this.hangPaintingAt(hit.point, hit.normal);
  }

  private isInteractiveTarget(target?: THREE.Object3D): boolean {
    if (!target) return false;
    if (target === this.depth?.depthMesh) return false;
    if (
      (target as xb.DetectedPlane).xrPlane !== undefined ||
      (target as xb.DetectedPlane).simulatorPlane !== undefined
    ) {
      return false;
    }
    return true;
  }

  private hangPaintingAt(point: THREE.Vector3, wallNormal: THREE.Vector3) {
    const painting = new FramedPainting(this.activeSpec, this.defaultScale, {
      wallScanner: this.wallScanner,
      onSelect: (p) => this.selectPlacedPainting(p),
      onScaleChanged: (p) => this.galleryUI.syncInspectorScale(p),
    });
    painting.placeOnWall(point, wallNormal);
    this.add(painting);
    this.placedPaintings.push(painting);
    this.selectPlacedPainting(painting);

    xb.core.sound?.soundSynthesizer?.playPresetTone?.('ACTIVATE');
    this.galleryUI.setHint(
      `Hung "${this.activeSpec.title}". Drag to reposition, two-hand pinch to resize, or tap another wall.`
    );
  }

  private selectPlacedPainting(painting: FramedPainting | null) {
    if (this.selectedPainting && this.selectedPainting !== painting) {
      this.selectedPainting.setSelected(false);
    }
    this.selectedPainting = painting;
    if (painting) {
      painting.setSelected(true);
    }
    this.galleryUI.showInspector(painting);
  }

  private removePainting(painting: FramedPainting) {
    const index = this.placedPaintings.indexOf(painting);
    if (index !== -1) {
      this.placedPaintings.splice(index, 1);
    }
    if (this.selectedPainting === painting) {
      this.selectPlacedPainting(null);
    }
    painting.removeFromParent();
    painting.dispose();
    this.galleryUI.setHint(`Removed "${painting.spec.title}".`);
  }

  private undoLastPainting() {
    const last = this.placedPaintings.pop();
    if (!last) return;
    if (this.selectedPainting === last) {
      this.selectPlacedPainting(null);
    }
    last.removeFromParent();
    last.dispose();
    this.galleryUI.setHint(`Removed "${last.spec.title}".`);
  }

  private clearAllPaintings() {
    this.selectPlacedPainting(null);
    for (const painting of this.placedPaintings) {
      painting.removeFromParent();
      painting.dispose();
    }
    this.placedPaintings.length = 0;
    this.galleryUI.setHint('Cleared all paintings from the room.');
  }

  onKeyDown(event: xb.KeyEvent) {
    if (event.code >= 'Digit1' && event.code <= 'Digit5') {
      const idx = Number(event.code.replace('Digit', '')) - 1;
      if (idx >= 0 && idx < CLASSIC_PAINTINGS.length) {
        this.galleryUI.selectCatalogIndex(idx);
      }
    } else if (event.code === 'KeyZ') {
      this.undoLastPainting();
    } else if (event.code === 'KeyG') {
      this.wallScanner.toggleWallsVisible();
    } else if (
      (event.code === 'Delete' || event.code === 'Backspace') &&
      this.selectedPainting
    ) {
      this.removePainting(this.selectedPainting);
    } else if (event.code === 'Escape') {
      this.selectPlacedPainting(null);
    }
  }

  dispose() {
    this.clearAllPaintings();
    if (this.envMapTexture) {
      if (xb.core.scene?.environment === this.envMapTexture) {
        xb.core.scene.environment = null;
      }
      this.envMapTexture.dispose();
      this.envMapTexture = null;
    }
  }
}
