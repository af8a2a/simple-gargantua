import { add, cross, normalize, scale } from './math.js';

// Right-handed, +Y up, vertical FOV in radians, top-left pixels, pixel centers.
export function orbitCamera({ distance = 30, azimuth = 0, elevation = 0.2, fov = Math.PI / 3 } = {}) {
  const position = [distance * Math.cos(elevation) * Math.sin(azimuth), distance * Math.sin(elevation), distance * Math.cos(elevation) * Math.cos(azimuth)];
  const forward = normalize(scale(position, -1));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  return { position, forward, right, up, fov };
}

export function cameraRay(camera, x, y, width, height) {
  const t = Math.tan(camera.fov / 2);
  return normalize(add(camera.forward, add(
    scale(camera.right, (2 * (x + 0.5) / width - 1) * width / height * t),
    scale(camera.up, (1 - 2 * (y + 0.5) / height) * t),
  )));
}
