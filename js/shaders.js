export const blackholeVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const blackholeFragmentShader = /* glsl */ `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform float uFov;
uniform float uSpin;           // dimensionless a* = a/M ∈ [0, 0.998]
uniform float uDiskBrightness;
uniform float uExposure;
uniform float uSteps;
uniform float uGlow;
uniform float uStarDensity;

// Units: rs = 2M = 1  →  M = 0.5. Spin axis = +Y, equatorial disk = XZ.
const float M = 0.5;
const float RS = 1.0;
const float PI = 3.14159265359;
const int MAX_STEPS = 768;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise3(p);
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}

float horizonR(float aStar) {
  return M * (1.0 + sqrt(max(1.0 - aStar * aStar, 0.0)));
}

// Bardeen–Press–Teukolsky prograde ISCO, returned in same length units as r
float iscoR(float aStar) {
  aStar = clamp(abs(aStar), 0.0, 0.998);
  float aa = aStar * aStar;
  float z1 = 1.0 + pow(max(1.0 - aa, 0.0), 1.0 / 3.0) *
                    (pow(1.0 + aStar, 1.0 / 3.0) + pow(max(1.0 - aStar, 0.0), 1.0 / 3.0));
  float z2 = sqrt(3.0 * aa + z1 * z1);
  float term = max((3.0 - z1) * (3.0 + z1 + 2.0 * z2), 0.0);
  float rM = 3.0 + z2 - sqrt(term); // in units of M
  return max(rM * M, horizonR(aStar) + 0.08);
}

// Prograde equatorial photon-orbit radius
float photonOrbitR(float aStar) {
  float aS = clamp(aStar, 0.0, 0.998);
  return 2.0 * M * (1.0 + cos((2.0 / 3.0) * acos(clamp(-aS, -1.0, 1.0))));
}

vec3 diskChroma(float kelvin) {
  float t = clamp(kelvin, 1800.0, 28000.0);
  float heat = clamp((log(t) - log(2200.0)) / (log(15000.0) - log(2200.0)), 0.0, 1.0);
  vec3 deepRed = vec3(0.48, 0.05, 0.01);
  vec3 orange = vec3(1.00, 0.28, 0.04);
  vec3 amber = vec3(1.00, 0.55, 0.12);
  vec3 warmWhite = vec3(1.00, 0.82, 0.48);
  vec3 blueWhite = vec3(0.72, 0.82, 1.00);
  vec3 col;
  if (heat < 0.25) col = mix(deepRed, orange, heat / 0.25);
  else if (heat < 0.5) col = mix(orange, amber, (heat - 0.25) / 0.25);
  else if (heat < 0.78) col = mix(amber, warmWhite, (heat - 0.5) / 0.28);
  else col = mix(warmWhite, blueWhite, (heat - 0.78) / 0.22);

  float t100 = t / 100.0;
  vec3 bb;
  if (t100 <= 66.0) {
    bb.r = 1.0;
    bb.g = clamp(0.3900815787 * log(t100) - 0.63184144378, 0.0, 1.0);
    bb.b = t100 <= 19.0 ? 0.0 : clamp(0.5432067895 * log(t100 - 10.0) - 1.19625408914, 0.0, 1.0);
  } else {
    bb.r = clamp(1.292936186 * pow(t100 - 60.0, -0.1332047592), 0.0, 1.0);
    bb.g = clamp(1.129890861 * pow(t100 - 60.0, -0.0755148492), 0.0, 1.0);
    bb.b = 1.0;
  }
  return max(mix(col, bb, 0.22), vec3(0.0));
}

vec3 starfield(vec3 dir) {
  vec3 d = normalize(dir);
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 4; layer++) {
    float fl = float(layer);
    float scale = 55.0 * pow(2.0, fl);
    vec3 p = d * scale;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(id + fl * 17.3);
    float thresh = mix(0.975, 0.992, fl * 0.28);
    if (h > thresh) {
      vec3 offset = (vec3(hash13(id + 3.17 + fl), hash13(id + 7.31 + fl), hash13(id + 11.7)) - 0.5) * 0.65;
      float dist = length(f - offset);
      float mag = pow(fract(h * 91.7), 2.4);
      float tw = 0.8 + 0.2 * sin(uTime * (1.2 + h * 3.5) + h * 40.0);
      float star = smoothstep(0.075, 0.0, dist) * mag * tw;
      float ct = fract(h * 37.0);
      vec3 scol = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.62), ct);
      col += star * scol * (1.4 + fl * 0.5);
    }
  }
  float band = exp(-pow(d.y * 2.1 + 0.12, 2.0) * 2.4);
  col += vec3(0.018, 0.02, 0.032) * band * fbm(d * 3.5);
  col += vec3(0.003, 0.0035, 0.006);
  return col * uStarDensity;
}

// Boyer–Lindquist with spin along +Y
// y = r cosθ,  x = √(r²+a²) sinθ cosφ,  z = √(r²+a²) sinθ sinφ
void cartToBL(vec3 p, float a, out float r, out float th, out float ph) {
  float aa = a * a;
  float rho2 = p.x * p.x + p.z * p.z;
  float y = p.y;
  float A = rho2 + y * y - aa;
  float r2 = 0.5 * (A + sqrt(max(A * A + 4.0 * aa * y * y, 0.0)));
  r = sqrt(max(r2, 1e-8));
  th = acos(clamp(y / r, -1.0, 1.0));
  ph = atan(p.z, p.x);
}

vec3 blToCartesian(float r, float th, float ph, float a) {
  float st = sin(th);
  float ct = cos(th);
  float Rbar = sqrt(r * r + a * a);
  return vec3(Rbar * st * cos(ph), r * ct, Rbar * st * sin(ph));
}

// Kerr thin disk at equatorial BL radius r, azimuth φ, spin a
vec3 sampleDiskKerr(float r, float phi, vec3 toObs, float aStar, float rIn, float rOut, float heightW) {
  if (r < rIn || r > rOut) return vec3(0.0);

  float aDim = aStar * M;
  float sqM = sqrt(M);
  float omega = sqM / (pow(max(r, 0.05), 1.5) + aDim * sqM);
  float d = r * r - 2.0 * M * r + aDim * aDim;
  float sigma = r * r + aDim * aDim;
  float omegaZ = 2.0 * M * aDim * r / max(sigma * sigma, 1e-4);
  float lapse = sqrt(max(d / sigma, 0.02));
  float beta = clamp(abs(omega - omegaZ) * r / max(lapse, 0.08), 0.0, 0.94);

  vec3 velDir = normalize(vec3(-sin(phi), 0.0, cos(phi)));
  vec3 nHat = -normalize(toObs + 1e-8);
  float gamma = 1.0 / sqrt(max(1.0 - beta * beta, 0.04));
  float mu = dot(velDir, nHat);
  float gD = clamp(1.0 / max(gamma * (1.0 - beta * mu), 1e-3), 0.14, 3.2);

  float rs_ = max(r, 0.2);
  float sqR = sqrt(rs_);
  float num = rs_ * sqR - 2.0 * M * sqR + aDim * sqM;
  float inner = rs_ * sqR - 3.0 * M * sqR + 2.0 * aDim * sqM;
  float den = pow(rs_, 0.75) * sqrt(max(inner, 1e-4));
  float Eem = clamp(num / max(den, 1e-4), 0.05, 8.0);
  float gGrav = clamp(1.0 / Eem, 0.08, 1.4);
  float gTotal = clamp(gD * gGrav, 0.04, 2.6);

  float Tref = clamp(7200.0 * (3.0 / max(rIn, 0.6)), 4800.0, 14000.0);
  float T = Tref * pow(rIn / r, 0.75);
  float Tobs = clamp(T * gTotal, 1800.0, 26000.0);

  float radial = pow(rIn / r, 1.85);
  float beam = pow(gD, 3.6);
  float intensity = radial * beam * gGrav * 0.55;

  float pattern = phi + omega * uTime * 3.4;
  float n = fbm(vec3(cos(pattern), sin(pattern), r * 1.65) * 2.35);
  n = 0.62 + 0.38 * n;
  float spiral = 0.5 + 0.5 * sin(phi * 3.0 - log(r) * 8.5 + omega * uTime * 4.4);
  float fil = mix(0.78, 1.22, spiral * n);

  float ein = smoothstep(rIn, rIn + 0.35, r);
  float eout = 1.0 - smoothstep(rOut - 2.8, rOut, r);
  float thick = mix(0.35, 1.0, heightW);

  vec3 chroma = diskChroma(Tobs * mix(0.85, 1.25, clamp(gD, 0.0, 2.0)));
  vec3 color = chroma * intensity * ein * eout * fil * n * thick * uDiskBrightness;

  float hot = clamp((Tobs - 8500.0) / 7000.0, 0.0, 0.4) * clamp(gD, 0.0, 1.3);
  color += vec3(1.0, 0.96, 0.88) * intensity * hot * ein * eout * thick * 0.35;
  return max(color, vec3(0.0));
}

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  float tanHalf = tan(uFov * 0.5);
  vec3 dir = normalize(uCamForward + uCamRight * (p.x * tanHalf) + uCamUp * (p.y * tanHalf));
  vec3 pos = uCamPos;
  vec3 vel = dir;

  float aStar = clamp(uSpin, 0.0, 0.998);
  float aDim = aStar * M;
  float rh = horizonR(aStar);
  float rIn = iscoR(aStar);
  float rOut = max(rIn + 7.5, 13.0);
  float rPh = photonOrbitR(aStar);
  float diskTh = 0.20;

  // Conserved angular momentum about spin axis (+Y)
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  float Lz = hv.y;

  vec3 color = vec3(0.0);
  float transmittance = 1.0;
  bool captured = false;
  float glow = 0.0;
  int diskHits = 0;

  int steps = int(uSteps);
  if (steps > MAX_STEPS) steps = MAX_STEPS;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= steps) break;

    float r2 = dot(pos, pos);
    float r = sqrt(max(r2, 1e-8));

    // Kerr horizon + spin-asymmetric capture (retrograde falls in from farther out)
    float spinAlign = Lz * aDim;
    float rCap = rh + max(0.0, -spinAlign) * 0.22 + max(0.0, spinAlign) * (-0.04);
    rCap = clamp(rCap, rh * 0.75, rh + 0.55);
    if (r < rCap) {
      captured = true;
      break;
    }
    if (r > 46.0 && dot(pos, vel) > 0.0) break;

    float stepSize = clamp(0.09 * r, 0.03, 0.7);
    if (r < rh + 2.0) stepSize = min(stepSize, 0.05);
    if (r < rPh + 1.5) stepSize = min(stepSize, 0.04);

    // Null-geodesic bending (stable Cartesian) — Kerr spin added below
    vec3 accel = -1.5 * h2 * pos / (r2 * r2 * max(r, 1e-6));

    // Lense–Thirring frame dragging about +Y
    if (aStar > 0.001) {
      float omegaFD = 2.0 * M * aDim / max(r * r * r, 1e-4);
      float fall = 1.0 / (1.0 + r * r * 0.08);
      accel += 1.35 * omegaFD * cross(vec3(0.0, 1.0, 0.0), vel) * fall;
    }

    vec3 newVel = vel + accel * stepSize;
    vec3 newPos = pos + newVel * stepSize;
    vec3 delta = newPos - pos;

    // Photon-ring glow near prograde photon orbit
    float drPh = abs(r - rPh);
    if (r > rh + 0.15 && r < rPh + 3.0) {
      glow += exp(-drPh * drPh * 16.0) * stepSize * 0.13;
    }

    // Volumetric thin disk (y=0 slab) — additive, keeps lensed images visible
    {
      float rho2 = newPos.x * newPos.x + newPos.z * newPos.z;
      float rEq = sqrt(max(rho2 - aDim * aDim, 0.08));
      float yAbs = abs(newPos.y);
      if (rEq > rIn && rEq < rOut && yAbs < diskTh * 3.2 && transmittance > 0.01) {
        float fallY = exp(-(newPos.y * newPos.y) / (diskTh * diskTh));
        float hitPh = atan(newPos.z, newPos.x);
        vec3 rayDir = normalize(delta + 1e-8);
        vec3 emission = sampleDiskKerr(rEq, hitPh, rayDir, aStar, rIn, rOut, fallY);
        color += emission * fallY * 0.28 * stepSize * transmittance;
        transmittance *= (1.0 - 0.05 * fallY);
      }
    }

    // Stronger primary plane hits
    if (pos.y * newPos.y < 0.0 && diskHits < 5 && transmittance > 0.02) {
      float s = clamp(pos.y / (pos.y - newPos.y), 0.0, 1.0);
      vec3 hit = mix(pos, newPos, s);
      float rho2 = hit.x * hit.x + hit.z * hit.z;
      float rEq = sqrt(max(rho2 - aDim * aDim, 0.08));
      if (rEq > rIn * 0.9 && rEq < rOut + 0.5) {
        float hitPh = atan(hit.z, hit.x);
        vec3 rayDir = normalize(delta + 1e-8);
        vec3 emission = sampleDiskKerr(rEq, hitPh, rayDir, aStar, rIn, rOut, 1.0);
        float eMag = min(length(emission), 40.0);
        if (eMag > 1e-4) {
          color += emission * 0.7 * transmittance;
          transmittance *= (1.0 - clamp(eMag * 0.4, 0.1, 0.8));
          diskHits += 1;
        }
      }
    }

    pos = newPos;
    vel = newVel;
  }

  if (!captured) {
    color += starfield(normalize(vel)) * transmittance;
    vec3 glowCol = vec3(1.0, 0.72, 0.28) * min(glow, 2.0) * uGlow * 0.32;
    color += glowCol;
  }

  color *= uExposure;
  color = aces(color);

  vec2 q = gl_FragCoord.xy / uResolution;
  float vig = pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.12);
  color *= mix(0.82, 1.0, vig);

  gl_FragColor = vec4(color, 1.0);
}
`;
