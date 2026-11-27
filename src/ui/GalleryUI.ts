import * as xb from 'xrblocks';

import {CLASSIC_PAINTINGS, PaintingSpec} from '../paintings/catalog.ts';
import {FramedPainting} from '../paintings/FramedPainting.ts';

export interface GalleryUIHandlers {
  onSelectCatalogPainting: (spec: PaintingSpec) => void;
  onDefaultScaleChanged: (scale: number) => void;
  onToggleWalls: () => boolean;
  onRescanRoom: () => void;
  onUndoLast: () => void;
  onClearAll: () => void;
  onInspectorScaleChanged: (painting: FramedPainting, scale: number) => void;
  onSnapToWall: (painting: FramedPainting) => void;
  onTogglePlaque: (painting: FramedPainting) => boolean;
  onRemovePainting: (painting: FramedPainting) => void;
  onDeselectPainting: () => void;
}

/**
 * Spatial UI suite for Atelier XR:
 * - Floating Atelier Palette (UICard, movable via edge)
 * - Selected Painting Inspector (UICard, appears when a placed painting is tapped)
 * - Compact bottom view-space guidance (UIOverlay)
 */
export class GalleryUI extends xb.Script {
  private handlers: GalleryUIHandlers;

  private paletteCard!: xb.UICard;
  private statusText!: xb.UIText;
  private artworkButtons: xb.UIButton[] = [];
  private selectedTitleText!: xb.UIText;
  private selectedDescText!: xb.UIText;
  private scaleValueText!: xb.UIText;
  private defaultScaleSlider!: xb.UISlider;
  private wallsButton!: xb.UIButton;
  private undoButton!: xb.UIButton;
  private clearButton!: xb.UIButton;

  private inspectorCard!: xb.UICard;
  private inspectorTitle!: xb.UIText;
  private inspectorMeta!: xb.UIText;
  private inspectorScaleValue!: xb.UIText;
  private inspectorSlider!: xb.UISlider;
  private plaqueButton!: xb.UIButton;

  private bottomOverlay!: xb.UIOverlay;
  private hintText!: xb.UIText;

  private activeSpecIndex = 0;
  private selectedPainting: FramedPainting | null = null;
  private plaqueShownForSelected = true;

  constructor(handlers: GalleryUIHandlers) {
    super();
    this.handlers = handlers;
    this.buildPaletteCard();
    this.buildInspectorCard();
    this.buildBottomOverlay();
  }

  private buildPaletteCard() {
    this.statusText = new xb.UIText({
      text: 'Scanning walls...',
      style: {
        fontSize: 15,
        color: '#8ad0ff',
        textAlign: 'right',
      },
    });

    const header = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      },
      children: [
        new xb.UIPanel({
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          },
          children: [
            new xb.UIIcon({
              icon: 'museum',
              style: {width: 30, height: 30, color: '#f4cf7b'},
            }),
            new xb.UIText({
              text: 'ATELIER XR',
              style: {fontSize: 22, fontWeight: 'bold'},
            }),
          ],
        }),
        this.statusText,
      ],
    });

    this.artworkButtons = CLASSIC_PAINTINGS.map((painting, index) => {
      const btn = new xb.UIButton({
        ariaLabel: `Select ${painting.title}`,
        onClick: () => this.selectCatalogIndex(index),
        style: {
          flexGrow: 1,
          flexBasis: 0,
          height: 112,
          padding: 6,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          borderRadius: 14,
          backgroundColor:
            index === 0
              ? 'rgba(244, 207, 123, 0.20)'
              : 'rgba(255, 255, 255, 0.06)',
          borderColor: index === 0 ? '#f4cf7b' : 'rgba(255, 255, 255, 0.12)',
          borderWidth: index === 0 ? 2 : 1,
        },
        children: [
          new xb.UIImage({
            src: painting.imageUrl,
            ariaLabel: painting.title,
            pointerEvents: 'none',
            style: {
              width: '100%',
              height: 68,
              objectFit: 'cover',
              borderRadius: 8,
            },
          }),
          new xb.UIText({
            text: this.shortLabel(painting.title),
            pointerEvents: 'none',
            style: {
              fontSize: 12,
              fontWeight: 'bold',
              textAlign: 'center',
              width: '100%',
              overflow: 'hidden',
            },
          }),
        ],
      });
      return btn;
    });

    const galleryRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 8,
        alignItems: 'stretch',
      },
      children: this.artworkButtons,
    });

    const initial = CLASSIC_PAINTINGS[0];
    this.selectedTitleText = new xb.UIText({
      text: `${initial.title} — ${initial.artist} (${initial.year})`,
      style: {fontSize: 16, fontWeight: 'bold', color: '#f6ebd0'},
    });
    this.selectedDescText = new xb.UIText({
      text: initial.description,
      style: {
        fontSize: 13,
        lineHeight: 1.35,
        opacity: 0.78,
        whiteSpace: 'pre-line',
      },
    });

    const infoPanel = new xb.UIPanel({
      style: {
        width: '100%',
        padding: 12,
        gap: 4,
        borderRadius: 14,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
      },
      children: [this.selectedTitleText, this.selectedDescText],
    });

    this.scaleValueText = new xb.UIText({
      text: '100%',
      style: {fontSize: 15, fontWeight: 'bold', color: '#f4cf7b'},
    });

    this.defaultScaleSlider = new xb.UISlider({
      ariaLabel: 'Placement painting scale',
      min: 0.5,
      max: 1.8,
      step: 0.05,
      value: 1.0,
      style: {width: '100%', height: 36},
      onInput: (value) => {
        this.scaleValueText.text = `${Math.round(value * 100)}%`;
        this.handlers.onDefaultScaleChanged(value);
      },
    });

    const scaleHeader = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
      children: [
        new xb.UIText({
          text: 'Frame Size',
          style: {fontSize: 15, opacity: 0.85},
        }),
        this.scaleValueText,
      ],
    });

    this.wallsButton = new xb.UIButton({
      label: 'Walls On',
      icon: 'grid_on',
      style: {flexGrow: 1},
      onClick: () => {
        const visible = this.handlers.onToggleWalls();
        this.wallsButton.label = visible ? 'Walls On' : 'Walls Off';
      },
    });

    const rescanButton = new xb.UIButton({
      label: 'Scan',
      icon: 'radar',
      style: {flexGrow: 1},
      onClick: () => this.handlers.onRescanRoom(),
    });

    this.undoButton = new xb.UIButton({
      label: 'Undo',
      icon: 'undo',
      disabled: true,
      style: {flexGrow: 1},
      onClick: () => this.handlers.onUndoLast(),
    });

    this.clearButton = new xb.UIButton({
      label: 'Clear',
      icon: 'delete_sweep',
      disabled: true,
      style: {flexGrow: 1},
      onClick: () => this.handlers.onClearAll(),
    });

    const actionsRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 8,
      },
      children: [this.wallsButton, rescanButton, this.undoButton, this.clearButton],
    });

    this.paletteCard = new xb.UICard({
      size: {width: 0.72, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 18,
      },
      children: [header, galleryRow, infoPanel, scaleHeader, this.defaultScaleSlider, actionsRow],
    });
    this.paletteCard.name = 'Atelier Palette';
    this.paletteCard.position.set(-0.56, 1.32, -1.05);
    this.paletteCard.rotation.y = 0.34;
    this.add(this.paletteCard);
  }

  private buildInspectorCard() {
    this.inspectorTitle = new xb.UIText({
      text: 'Selected Artwork',
      style: {fontSize: 18, fontWeight: 'bold', color: '#f6ebd0'},
    });
    this.inspectorMeta = new xb.UIText({
      text: '',
      style: {fontSize: 13, opacity: 0.78, whiteSpace: 'pre-line', lineHeight: 1.35},
    });
    this.inspectorScaleValue = new xb.UIText({
      text: '100%',
      style: {fontSize: 15, fontWeight: 'bold', color: '#f4cf7b'},
    });
    this.inspectorSlider = new xb.UISlider({
      ariaLabel: 'Selected painting scale',
      min: 0.45,
      max: 2.2,
      step: 0.05,
      value: 1.0,
      style: {width: '100%', height: 36},
      onInput: (value) => {
        if (!this.selectedPainting) return;
        this.inspectorScaleValue.text = `${Math.round(value * 100)}%`;
        this.handlers.onInspectorScaleChanged(this.selectedPainting, value);
      },
    });

    this.plaqueButton = new xb.UIButton({
      label: 'Plaque On',
      icon: 'badge',
      style: {flexGrow: 1},
      onClick: () => {
        if (!this.selectedPainting) return;
        this.plaqueShownForSelected = this.handlers.onTogglePlaque(this.selectedPainting);
        this.plaqueButton.label = this.plaqueShownForSelected ? 'Plaque On' : 'Plaque Off';
      },
    });

    const snapButton = new xb.UIButton({
      label: 'Snap Wall',
      icon: 'vertical_align_center',
      style: {flexGrow: 1},
      onClick: () => {
        if (this.selectedPainting) this.handlers.onSnapToWall(this.selectedPainting);
      },
    });

    const removeButton = new xb.UIButton({
      label: 'Remove',
      icon: 'delete',
      style: {flexGrow: 1},
      onClick: () => {
        if (this.selectedPainting) this.handlers.onRemovePainting(this.selectedPainting);
      },
    });

    const closeButton = new xb.UIButton({
      icon: 'close',
      ariaLabel: 'Close painting inspector',
      style: {width: 40, height: 40, padding: 0},
      onClick: () => this.handlers.onDeselectPainting(),
    });

    this.inspectorCard = new xb.UICard({
      size: {width: 0.46, height: 'auto'},
      manipulation: true,
      edge: true,
      visible: false,
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 16,
      },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          children: [this.inspectorTitle, closeButton],
        }),
        this.inspectorMeta,
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          children: [
            new xb.UIText({text: 'Artwork Scale', style: {fontSize: 14, opacity: 0.85}}),
            this.inspectorScaleValue,
          ],
        }),
        this.inspectorSlider,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 8},
          children: [this.plaqueButton, snapButton, removeButton],
        }),
      ],
    });
    this.inspectorCard.name = 'Painting Inspector';
    this.inspectorCard.position.set(0.56, 1.32, -1.05);
    this.inspectorCard.rotation.y = -0.34;
    this.add(this.inspectorCard);
  }

  private buildBottomOverlay() {
    this.hintText = new xb.UIText({
      text: 'Aim at a detected wall and click, pull trigger, or pinch to hang. Drag any painting to move or resize.',
      pointerEvents: 'none',
      style: {
        fontSize: 16,
        lineHeight: 1.3,
        textAlign: 'center',
        opacity: 0.9,
      },
    });

    this.bottomOverlay = new xb.UIOverlay({
      style: {
        width: 780,
        position: 'absolute',
        left: '50%',
        bottom: 24,
        transform: {translateX: '-50%'},
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 12,
      },
      children: [new xb.UIExitButton(), this.hintText],
    });
    this.bottomOverlay.name = 'Atelier Bottom Hint';
    this.add(this.bottomOverlay);
  }

  private shortLabel(title: string): string {
    if (title.includes('Starry')) return 'Starry Night';
    if (title.includes('Mona')) return 'Mona Lisa';
    if (title.includes('Pearl')) return 'Pearl Earring';
    if (title.includes('Wave')) return 'Great Wave';
    if (title.includes('Lilies')) return 'Water Lilies';
    return title;
  }

  selectCatalogIndex(index: number) {
    this.activeSpecIndex = index;
    const spec = CLASSIC_PAINTINGS[index];
    this.artworkButtons.forEach((btn, idx) => {
      const selected = idx === index;
      btn.style.backgroundColor = selected
        ? 'rgba(244, 207, 123, 0.20)'
        : 'rgba(255, 255, 255, 0.06)';
      btn.style.borderColor = selected
        ? '#f4cf7b'
        : 'rgba(255, 255, 255, 0.12)';
      btn.style.borderWidth = selected ? 2 : 1;
    });

    this.selectedTitleText.text = `${spec.title} — ${spec.artist} (${spec.year})`;
    this.selectedDescText.text = spec.description;
    this.handlers.onSelectCatalogPainting(spec);
  }

  updateStatus(wallCount: number, placedCount: number) {
    const wallLabel =
      wallCount === 0
        ? 'Look around to scan walls'
        : `${wallCount} ${wallCount === 1 ? 'wall' : 'walls'} detected`;
    this.statusText.text =
      placedCount > 0 ? `${wallLabel} • ${placedCount} hung` : wallLabel;
    this.statusText.style.color = wallCount > 0 ? '#7ef7b8' : '#8ad0ff';

    this.undoButton.disabled = placedCount === 0;
    this.clearButton.disabled = placedCount === 0;
  }

  showInspector(painting: FramedPainting | null) {
    this.selectedPainting = painting;
    if (!painting) {
      this.inspectorCard.visible = false;
      return;
    }

    const s = painting.spec;
    this.inspectorTitle.text = s.title;
    this.inspectorMeta.text = `${s.artist} (${s.year})\n${s.movement} • ${s.medium}`;
    const currentScale = painting.getPaintingScale();
    this.inspectorSlider.value = currentScale;
    this.inspectorScaleValue.text = `${Math.round(currentScale * 100)}%`;
    this.inspectorCard.visible = true;
  }

  syncInspectorScale(painting: FramedPainting) {
    if (this.selectedPainting !== painting) return;
    const s = painting.getPaintingScale();
    this.inspectorSlider.value = s;
    this.inspectorScaleValue.text = `${Math.round(s * 100)}%`;
  }

  setHint(message: string) {
    this.hintText.text = message;
  }
}
