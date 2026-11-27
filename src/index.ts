import * as xb from 'xrblocks';

import {AtelierScene} from './AtelierScene.ts';

const options = new xb.Options();

// Unified reticles & depth sensing (works in Desktop Simulator and Meta Quest 3)
options.enableReticles();
options.reticles.projectOnDepthMesh = true;

options.depth = new xb.DepthOptions(xb.xrDepthMeshOptions);
options.depth.depthMesh.updateFullResolutionGeometry = true;
options.depth.depthMesh.updateVertexNormals = true;
options.depth.depthMesh.renderShadow = true;
options.depth.depthTexture.enabled = true;
options.depth.occlusion.enabled = true;
options.depth.matchDepthView = false;

// Real-world wall & room plane detection (WebXR plane-detection + Quest 3 Room Capture)
options.enablePlaneDetection();
options.world.planes.showDebugVisualizations = false;
options.world.initiateRoomCapture = true;

// Hand tracking + hand rays alongside Meta Quest Touch controllers & desktop mouse
options.enableHands();
options.hands.visualization = true;
options.enableHandRays();

// Spatial UI theme & App metadata
options.setAppTitle('Atelier XR');
options.setAppDescription(
  'Scan your room, detect walls, and hang classic museum paintings with mouse, Meta Quest controllers, or hand tracking.'
);

options.simulator.instructions.customInstructions = [
  {
    header: 'Hang Classic Paintings',
    description:
      'Aim at any detected wall and click, pull trigger, or pinch to hang the selected masterpiece. Drag paintings to move or two-hand pinch to resize.',
  },
];

document.addEventListener('DOMContentLoaded', async () => {
  xb.ui.theme = 'grayGlass';
  xb.add(new AtelierScene());
  await xb.init(options);
});
