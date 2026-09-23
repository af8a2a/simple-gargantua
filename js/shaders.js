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

// Units: rs = 2M = 1 → M = 0.5.
// Visual frame: spin +Y, disk in XZ.
// Kerr–Schild / Blacklight frame: spin +Z, disk in XY (y↔z swap).
const float M = 0.5;
const float RS = 1.0;
const int MAX_STEPS = 640;

// Empirical ring-overlay radii in observer-screen coordinates (b0=3*sqrt(3)*M).
float criticalB(float aStar) {
  // Prograde / retrograde equatorial photon-orbit impact parameters
  float b0 = 3.0 * sqrt(3.0) * M;
  float bPro = b0 * (1.0 - 0.20 * aStar);
  float bRet = b0 * (1.0 + 0.28 * aStar);
  return 0.5 * (bPro + bRet);
}

float criticalBAz(float aStar, float screenAz) {
  float b0 = 3.0 * sqrt(3.0) * M;
  float bPro = b0 * (1.0 - 0.20 * aStar);
  float bRet = b0 * (1.0 + 0.28 * aStar);
  // Approximate prograde-side compression for the artistic glow overlay.
  float t = 0.5 + 0.5 * cos(screenAz);
  return mix(bRet, bPro, t);
}

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

float iscoR(float aStar) {
  aStar = clamp(abs(aStar), 0.0, 0.998);
  float aa = aStar * aStar;
  float z1 = 1.0 + pow(max(1.0 - aa, 0.0), 1.0 / 3.0) *
                    (pow(1.0 + aStar, 1.0 / 3.0) + pow(max(1.0 - aStar, 0.0), 1.0 / 3.0));
  float z2 = sqrt(3.0 * aa + z1 * z1);
  float term = max((3.0 - z1) * (3.0 + z1 + 2.0 * z2), 0.0);
  float rM = 3.0 + z2 - sqrt(term);
  return max(rM * M, horizonR(aStar) + 0.08);
}

float photonOrbitR(float aStar) {
  float aS = clamp(aStar, 0.0, 0.998);
  return 2.0 * M * (1.0 + cos((2.0 / 3.0) * acos(clamp(-aS, -1.0, 1.0))));
}

// Visual (spin +Y) ↔ Kerr–Schild (spin +Z):  ks = (vis.x, vis.z, vis.y)
vec3 visToKs(vec3 v) { return vec3(v.x, v.z, v.y); }
vec3 ksToVisFixed(vec3 k) { return vec3(k.x, k.z, k.y); }

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

// ---------------------------------------------------------------------------
// Cartesian Kerr–Schild (Blacklight arXiv:2203.15963, spin along +z)
// g_{αβ} = η_{αβ} + f l_α l_β
// g^{αβ} = η^{αβ} - f l^α l^β
// f = 2Mr³/(r⁴+a²z²)
// l^α = (-1, (rx+ay)/(r²+a²), (ry-ax)/(r²+a²), z/r)
// ---------------------------------------------------------------------------

// Inverse metric as rows: row[α][β] = g^{αβ}
void kerrSchildGinv(vec3 pos, float a, out vec4 rowT, out vec4 rowX, out vec4 rowY, out vec4 rowZ) {
  float x = pos.x;
  float y = pos.y;
  float z = pos.z;
  float a2 = a * a;
  float R2 = x * x + y * y + z * z;
  float S = R2 - a2;
  float T = sqrt(max(S * S + 4.0 * a2 * z * z, 1e-12));
  float r2 = max(0.5 * (S + T), 1e-10);
  float r = sqrt(r2);
  float r3 = r2 * r;
  float r4 = r2 * r2;
  float f = 2.0 * M * r3 / max(r4 + a2 * z * z, 1e-12);

  float den = r2 + a2;
  float lx = (r * x + a * y) / den;
  float ly = (r * y - a * x) / den;
  float lz = z / max(r, 1e-6);
  // contravariant null vector l^α = (-1, lx, ly, lz)
  float l0 = -1.0;
  float l1 = lx;
  float l2 = ly;
  float l3 = lz;

  // g^{αβ} = η^{αβ} - f l^α l^β,  η = diag(-1,1,1,1)
  rowT = vec4(-1.0 - f * l0 * l0, 0.0 - f * l0 * l1, 0.0 - f * l0 * l2, 0.0 - f * l0 * l3);
  rowX = vec4(0.0 - f * l1 * l0, 1.0 - f * l1 * l1, 0.0 - f * l1 * l2, 0.0 - f * l1 * l3);
  rowY = vec4(0.0 - f * l2 * l0, 0.0 - f * l2 * l1, 1.0 - f * l2 * l2, 0.0 - f * l2 * l3);
  rowZ = vec4(0.0 - f * l3 * l0, 0.0 - f * l3 * l1, 0.0 - f * l3 * l2, 1.0 - f * l3 * l3);
}

vec4 ginvApply(vec4 rowT, vec4 rowX, vec4 rowY, vec4 rowZ, vec4 p) {
  return vec4(dot(rowT, p), dot(rowX, p), dot(rowY, p), dot(rowZ, p));
}

// Past-directed covariant null momentum for a ray traced toward the source.
// Keep dlam > 0 throughout tracing and radiative accumulation. The null root
// below gives dt/dlam = A * p_t + B/2 = -sqrt(discriminant)/2 < 0.
// This is equivalent to tracing the opposite, future-directed four-momentum
// with negative affine steps; flipping only p_t would not preserve nullness.
vec4 pastDirectedMomentum(vec3 pos, vec3 spatialMomentum, float a) {
  vec4 rowT, rowX, rowY, rowZ;
  kerrSchildGinv(pos, a, rowT, rowX, rowY, rowZ);
  vec4 pSpatial = vec4(0.0, spatialMomentum);
  float A = rowT.x;
  float B = 2.0 * dot(rowT.yzw, spatialMomentum);
  float C = dot(pSpatial, ginvApply(rowT, rowX, rowY, rowZ, pSpatial));
  float discriminant = max(B * B - 4.0 * A * C, 0.0);
  float pt = (-B - sqrt(discriminant)) / (2.0 * A);
  return vec4(pt, spatialMomentum);
}

float ksRadius(vec3 pos, float a) {
  float a2 = a * a;
  float R2 = dot(pos, pos);
  float S = R2 - a2;
  float T = sqrt(max(S * S + 4.0 * a2 * pos.z * pos.z, 0.0));
  return sqrt(max(0.5 * (S + T), 0.0));
}

// Hamiltonian RHS (Blacklight arXiv:2203.15963 Eq. 20) in Cartesian Kerr–Schild.
// dx^α/dλ = g^{αβ} p_β
// dp_i/dλ = -½ ∂_i g^{αβ} p_α p_β
// Analytic ∂_i via g^{αβ} = η^{αβ} - f l^α l^β  ⇒
//   ∂_i g^{αβ}p_αp_β = -(∂_i f)(l·p)² - 2f (l·p) ∂_i(l·p)
void hamRhs(vec3 x, vec4 p, float a, out vec3 dx, out vec3 dpi) {
  float x0 = x.x, x1 = x.y, x2 = x.z;
  float a2 = a * a;
  float R2 = x0 * x0 + x1 * x1 + x2 * x2;
  float S = R2 - a2;
  float T = sqrt(max(S * S + 4.0 * a2 * x2 * x2, 1e-12));
  float r2 = max(0.5 * (S + T), 1e-10);
  float r = sqrt(r2);
  float r3 = r2 * r;
  float r4 = r2 * r2;

  vec3 dr = vec3(
    x0 * (S + T) / (2.0 * r * max(T, 1e-8)),
    x1 * (S + T) / (2.0 * r * max(T, 1e-8)),
    x2 * (T + R2 + a2) / (2.0 * r * max(T, 1e-8))
  );

  float D = max(r4 + a2 * x2 * x2, 1e-12);
  float f = 2.0 * M * r3 / D;
  vec3 dD = 4.0 * r3 * dr;
  dD.z += 2.0 * a2 * x2;
  vec3 df = (2.0 * M) * (3.0 * r2 * dr * D - r3 * dD) / (D * D);

  float den = r2 + a2;
  vec3 dden = 2.0 * r * dr;
  float l0 = -1.0;
  float numx = r * x0 + a * x1;
  float numy = r * x1 - a * x0;
  float lx = numx / den;
  float ly = numy / den;
  float lz = x2 / max(r, 1e-6);

  vec3 lx_g, ly_g, lz_g;
  lx_g.x = ((dr.x * x0 + r) * den - numx * dden.x) / (den * den);
  lx_g.y = ((dr.y * x0 + a) * den - numx * dden.y) / (den * den);
  lx_g.z = ((dr.z * x0) * den - numx * dden.z) / (den * den);
  ly_g.x = ((dr.x * x1 - a) * den - numy * dden.x) / (den * den);
  ly_g.y = ((dr.y * x1 + r) * den - numy * dden.y) / (den * den);
  ly_g.z = ((dr.z * x1) * den - numy * dden.z) / (den * den);
  lz_g = vec3(
    -x2 / (r * r) * dr.x,
    -x2 / (r * r) * dr.y,
    1.0 / r - x2 / (r * r) * dr.z
  );

  // Inverse metric rows g^{αβ} = η^{αβ} - f l^α l^β
  vec4 l = vec4(l0, lx, ly, lz);
  vec4 rowT = vec4(-1.0 - f * l.x * l.x, -f * l.x * l.y, -f * l.x * l.z, -f * l.x * l.w);
  vec4 rowX = vec4(-f * l.y * l.x, 1.0 - f * l.y * l.y, -f * l.y * l.z, -f * l.y * l.w);
  vec4 rowY = vec4(-f * l.z * l.x, -f * l.z * l.y, 1.0 - f * l.z * l.z, -f * l.z * l.w);
  vec4 rowZ = vec4(-f * l.w * l.x, -f * l.w * l.y, -f * l.w * l.z, 1.0 - f * l.w * l.w);

  dx = vec3(dot(rowX, p), dot(rowY, p), dot(rowZ, p));

  float lp = l.x * p.x + l.y * p.y + l.z * p.z + l.w * p.w;
  vec3 dlp = vec3(
    lx_g.x * p.y + ly_g.x * p.z + lz_g.x * p.w,
    lx_g.y * p.y + ly_g.y * p.z + lz_g.y * p.w,
    lx_g.z * p.y + ly_g.z * p.z + lz_g.z * p.w
  );
  // dp_i = -½ ∂_i (g^{αβ}p_αp_β) = ½ [ (∂_i f)(l·p)² + 2f (l·p) ∂_i(l·p) ]
  dpi = 0.5 * (df * lp * lp + 2.0 * f * dlp * lp);
}

// RK4 step on (x, p): p = (p_t, p_x, p_y, p_z). Keep p.x = p_t conserved.
void hamStep(inout vec3 x, inout vec4 p, float a, float dlam) {
  vec3 k1x, k2x, k3x, k4x;
  vec3 k1p, k2p, k3p, k4p;
  vec3 xt;
  vec4 pt;

  hamRhs(x, p, a, k1x, k1p);
  xt = x + 0.5 * dlam * k1x;
  pt = p;
  pt.yzw += 0.5 * dlam * k1p;
  hamRhs(xt, pt, a, k2x, k2p);
  xt = x + 0.5 * dlam * k2x;
  pt = p;
  pt.yzw += 0.5 * dlam * k2p;
  hamRhs(xt, pt, a, k3x, k3p);
  xt = x + dlam * k3x;
  pt = p;
  pt.yzw += dlam * k3p;
  hamRhs(xt, pt, a, k4x, k4p);

  x += (dlam / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
  p.yzw += (dlam / 6.0) * (k1p + 2.0 * k2p + 2.0 * k3p + k4p);
}

// Normalize a coordinate velocity dx^i/dt in the local Kerr-Schild metric.
// For a static camera use velocity=0; invalid (non-timelike) flows return zero.
vec4 coordinateFourVelocity(vec3 pos, vec3 velocity, float a) {
  float r = ksRadius(pos, a);
  float r2 = r * r;
  float a2 = a * a;
  float f = 2.0 * M * r2 * r / max(r2 * r2 + a2 * pos.z * pos.z, 1e-12);
  vec3 ell = vec3((r * pos.x + a * pos.y) / (r2 + a2),
                  (r * pos.y - a * pos.x) / (r2 + a2), pos.z / r);
  float lv = 1.0 + dot(ell, velocity);
  float properTimeSquared = 1.0 - dot(velocity, velocity) - f * lv * lv;
  if (!(properTimeSquared > 0.0)) return vec4(0.0);
  return vec4(1.0, velocity) / sqrt(properTimeSquared);
}

float keplerOmega(float r, float a) {
  return sqrt(M) / (pow(r, 1.5) + a * sqrt(M));
}

vec4 diskFourVelocity(vec3 pos, float orbitR, float a) {
  // At fixed r and theta, d(x,y,z)/dphi=(-y,x,0) in Cartesian KS.
  // Extend the equatorial rotation law through the finite disk height,
  // normalizing at the actual sample position (off-plane flow is prescribed).
  float omega = keplerOmega(orbitR, a);
  return coordinateFourVelocity(pos, omega * vec3(-pos.y, pos.x, 0.0), a);
}

float frequencyShift(vec4 photonCov, vec4 emitterVelocity, float observerFrequency) {
  // pk is past-directed: positive physical frequency is pk_mu * u^mu.
  // The ratio includes gravity, transverse Doppler and orbital beaming once.
  float emittedFrequency = dot(photonCov, emitterVelocity);
  if (!(observerFrequency > 0.0) || !(emittedFrequency > 0.0)) return 0.0;
  return observerFrequency / emittedFrequency;
}

float diskFrequencyShift(vec3 pos, vec4 photonCov, float orbitR, float a, float observerFrequency) {
  return frequencyShift(photonCov, diskFourVelocity(pos, orbitR, a), observerFrequency);
}

vec3 sampleDiskKerr(float r, float phi, float g, float aStar, float rIn, float rOut, float heightW) {
  if (r < rIn || r > rOut) return vec3(0.0);

  if (!(g > 0.0)) return vec3(0.0);
  float omega = keplerOmega(r, aStar * M);

  float Tref = clamp(7200.0 * (3.0 / max(rIn, 0.6)), 4800.0, 14000.0);
  float T = Tref * pow(rIn / r, 0.75);
  float Tobs = T * g;

  float radial = pow(rIn / r, 1.85);
  // The radial profile is emitted bolometric intensity: I_obs = g^4 I_em.
  // diskChroma only supplies the approximate color at T_obs = g T_em.
  float intensity = radial * pow(g, 4.0) * 0.72;

  float pattern = phi + omega * uTime * 3.4;
  float n = fbm(vec3(cos(pattern), sin(pattern), r * 1.65) * 2.35);
  n = 0.62 + 0.38 * n;
  float spiral = 0.5 + 0.5 * sin(phi * 3.0 - log(r) * 8.5 + omega * uTime * 4.4);
  float fil = mix(0.78, 1.22, spiral * n);

  float ein = smoothstep(rIn, rIn + 0.35, r);
  float eout = 1.0 - smoothstep(rOut - 2.8, rOut, r);
  float thick = mix(0.35, 1.0, heightW);

  vec3 chroma = diskChroma(Tobs);
  vec3 color = chroma * intensity * ein * eout * fil * n * thick * uDiskBrightness;

  float hot = clamp((Tobs - 8500.0) / 7000.0, 0.0, 0.4);
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
  vec3 dirVis = normalize(uCamForward + uCamRight * (p.x * tanHalf) + uCamUp * (p.y * tanHalf));

  float aStar = clamp(uSpin, 0.0, 0.998);
  float aDim = aStar * M;
  float rh = horizonR(aStar);
  float rIn = iscoR(aStar);
  float rOut = max(rIn + 7.5, 13.0);
  float rPh = photonOrbitR(aStar);
  float diskTh = 0.20;

  // Kerr–Schild state (spin +z)
  vec3 xKs = visToKs(uCamPos);
  vec3 nKs = normalize(visToKs(dirVis));
  float camR = max(ksRadius(xKs, aDim), rh + 1.0);

  // Observer-screen coordinates rotate with the camera around the spin axis.
  // This empirical overlay and its refinement bands share the same sky basis.
  vec2 skyDir = vec2(dot(dirVis, uCamRight), dot(dirVis, uCamUp));
  // Equivalent to |x_cam x dirVis| for this center-pointing camera.
  float bmag = length(uCamPos) * length(skyDir);
  // The screen center has no polar angle; avoid GLSL atan(0, 0).
  float skyAz = dot(skyDir, skyDir) > 1e-12 ? atan(skyDir.y, skyDir.x) : 0.0;
  float bCrit = criticalBAz(aStar, skyAz);
  float dbCrit = abs(bmag - bCrit);
  // Lensing band n=0…2: exponentially thin shells around the critical curve
  float band0 = exp(-pow(dbCrit / 0.55, 2.0));
  float band1 = exp(-pow(dbCrit / 0.18, 2.0));
  float band2 = exp(-pow(dbCrit / 0.07, 2.0));
  float skyCrit = max(band0, max(band1 * 0.85, band2 * 0.7));

  // Backtrace from the camera toward the source with dt/dlam < 0.
  vec3 x = xKs;
  vec4 pk = pastDirectedMomentum(xKs, nKs, aDim);
  // Each rendered camera is static in KS coordinates, at its finite distance.
  vec4 observerVelocity = coordinateFourVelocity(xKs, vec3(0.0), aDim);
  float observerFrequency = dot(pk, observerVelocity);

  vec3 color = vec3(0.0);
  float transmittance = 1.0;
  bool captured = false;
  float glow = 0.0;
  int diskHits = 0;
  vec3 lastDirVis = dirVis;
  float phiAcc = 0.0;          // accumulated |dφ| ≈ half-orbit counter
  float shellAdapt = 0.0;      // running max of photon-shell proximity

  int steps = int(uSteps);
  if (steps > MAX_STEPS) steps = MAX_STEPS;
  // AART: spend extra affine steps on rays in the critical / high-n bands
  int stepBudget = int(clamp(float(steps) * (1.0 + 1.6 * skyCrit), float(steps), float(MAX_STEPS)));

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= stepBudget) break;

    float r = ksRadius(x, aDim);
    if (!(r > 0.0) || r < rh * 1.02 || dot(x, x) > 2.5e3) {
      captured = r < rh * 3.0;
      break;
    }
    if (r > max(camR + 3.0, 40.0)) {
      vec3 dxv, dpv;
      hamRhs(x, pk, aDim, dxv, dpv);
      if (dot(dxv, dxv) > 1e-12) lastDirVis = ksToVisFixed(normalize(dxv));
      break;
    }

    // Photon-shell proximity (AART critical region): fine steps near r_ph
    float shell = exp(-pow((r - rPh) / 0.40, 2.0));
    shellAdapt = max(shellAdapt, shell);
    float adapt = clamp(max(skyCrit, shell), 0.0, 1.0);

    // Positive affine length: pk is past-directed, so coordinate time decreases.
    float dlam = clamp(0.28 * max(r - rh, 0.08), 0.025, 0.55);
    dlam = mix(dlam, 0.012 + 0.03 * max(r - rh, 0.0), adapt);
    if (r < rh + 1.8) dlam = min(dlam, 0.045);
    if (r < rPh + 1.2) dlam = min(dlam, 0.03);

    vec3 xOldKs = x;
    vec4 pkOld = pk;
    vec3 dxNow, dpNow;
    hamRhs(x, pk, aDim, dxNow, dpNow);
    if (dot(dxNow, dxNow) > 1e-12) lastDirVis = ksToVisFixed(normalize(dxNow));

    hamStep(x, pk, aDim, dlam);

    if (r > rh + 0.1 && r < rPh + 2.5) {
      glow += exp(-pow((r - rPh) / 0.45, 2.0)) * dlam * 0.18;
    }

    vec3 pOld = ksToVisFixed(xOldKs);
    vec3 pNew = ksToVisFixed(x);

    // Half-orbit accumulator (AART layer index n ~ φ_acc / π)
    {
      vec3 cprod = cross(pOld, pNew);
      float dphi = abs(cprod.y) / max(dot(pNew.xz, pNew.xz), 0.25);
      phiAcc += dphi;
    }

    // Volumetric thin disk — keep optically thin so high-n layers survive
    {
      float rho2 = pNew.x * pNew.x + pNew.z * pNew.z;
      float rEq = sqrt(max(rho2 - aDim * aDim, 0.08));
      float yAbs = abs(pNew.y);
      if (rEq > rIn && rEq < rOut && yAbs < diskTh * 3.2 && transmittance > 0.005) {
        float fallY = exp(-(pNew.y * pNew.y) / (diskTh * diskTh));
        float hitPh = atan(pNew.z, pNew.x);
        float g = diskFrequencyShift(x, pk, rEq, aDim, observerFrequency);
        vec3 emission = sampleDiskKerr(rEq, hitPh, g, aStar, rIn, rOut, fallY);
        // Slightly stronger sampling in the critical band (higher-n image content)
        float bandBoost = 1.0 + 1.4 * skyCrit + 0.8 * shell;
        color += emission * fallY * 0.20 * dlam * bandBoost * transmittance;
        transmittance *= (1.0 - 0.028 * fallY);
      }
    }

    // Plane crossings: label image order by accumulated half-orbits
    if (pOld.y * pNew.y < 0.0 && diskHits < 10 && transmittance > 0.008) {
      float s = clamp(pOld.y / (pOld.y - pNew.y), 0.0, 1.0);
      vec3 hit = mix(pOld, pNew, s);
      float rho2 = hit.x * hit.x + hit.z * hit.z;
      float rEq = sqrt(max(rho2 - aDim * aDim, 0.08));
      if (rEq > rIn * 0.85 && rEq < rOut + 0.8) {
        float hitPh = atan(hit.z, hit.x);
        // Interpolate momentum at the same crossing fraction as position.
        vec4 pkHit = mix(pkOld, pk, s);
        float g = diskFrequencyShift(visToKs(hit), pkHit, rEq, aDim, observerFrequency);
        vec3 emission = sampleDiskKerr(rEq, hitPh, g, aStar, rIn, rOut, 1.0);
        float eMag = min(length(emission), 40.0);
        if (eMag > 1e-4) {
          // AART demagnification e^{-nγ}; γ_eff ~ 0.9 per half-orbit, modulated by lensing band
          float nLayer = floor(phiAcc / 3.14159265);
          float demag = exp(-nLayer * 0.75);
          float bandGain = 1.0 + 2.2 * band2 + 1.1 * band1 + 0.4 * band0;
          float w = 0.55 * demag * bandGain * (1.0 + 0.5 * shellAdapt);
          color += emission * w * transmittance;
          // Soft opacity so n≥1/2 rings remain visible
          transmittance *= (1.0 - clamp(eMag * 0.22, 0.03, 0.55));
          diskHits += 1;
        }
      }
    }
  }

  if (!captured) {
    color += starfield(lastDirVis) * transmittance;
  }

  // Artistic photon-ring glow around the approximate observer-screen contour
  {
    float ringW = mix(0.04, 0.10, aStar);
    float ring = exp(-pow(dbCrit / ringW, 2.0));
    float side = 0.75 + 0.45 * clamp(skyDir.x * 0.6 + 0.4, 0.0, 1.0);
    color += vec3(1.0, 0.78, 0.38) * ring * uGlow * 0.38 * side * (0.35 + 0.65 * skyCrit);
    // Subtle n=1 / n=2 subrings just outside the critical curve
    float n1 = exp(-pow((dbCrit - 0.10) / 0.04, 2.0));
    float n2 = exp(-pow((dbCrit - 0.19) / 0.028, 2.0));
    color += vec3(1.0, 0.70, 0.32) * n1 * uGlow * 0.14;
    color += vec3(1.0, 0.65, 0.28) * n2 * uGlow * 0.07;
    color += vec3(1.0, 0.72, 0.28) * min(glow, 2.0) * uGlow * 0.20;
  }

  color *= uExposure;
  color = aces(color);

  vec2 q = gl_FragCoord.xy / uResolution;
  float vig = pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.12);
  color *= mix(0.82, 1.0, vig);

  gl_FragColor = vec4(color, 1.0);
}
`;
