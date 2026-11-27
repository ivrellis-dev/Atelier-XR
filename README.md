# Atelier XR

A WebXR spatial gallery built with **XR Blocks** and **Three.js** that runs on desktop (simulated room) and **Meta Quest 3** (mixed reality passthrough). Scan your real-world walls and hang framed classic masterpieces using mouse, Meta Quest Touch controllers, or hand tracking.

## Hosting on GitHub Pages (HTTPS for Meta Quest 3)

WebXR requires a secure HTTPS origin, which GitHub Pages provides automatically:

1. Push this repository to GitHub with `main` as your default branch.
2. In your repository settings, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or trigger **Deploy Atelier XR to GitHub Pages** manually in the **Actions** tab).
4. Open your published `https://<username>.github.io/<repo>/` URL on desktop or inside the **Meta Quest Browser** on Quest 3.

## Local Development

```bash
npm install
npm run dev
```

To create a production build locally:

```bash
npm run lint
npm run build
```

## Controls

- **Desktop Simulator**: Aim with the mouse and click any detected wall to hang a painting (`1`–`5` switch paintings, `G` toggles wall scan grid, `Z` undoes, `Delete` removes selected).
- **Meta Quest 3**: Point a controller ray or hand ray at a scanned wall and pull trigger or pinch to hang. Drag paintings to reposition along walls, or two-hand pinch to resize.
