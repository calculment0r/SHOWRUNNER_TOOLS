// MONTAGE — les LUT : lecture des fichiers .cube et rendu WebGL2.
//
// Le serveur range chaque LUT sous une forme unique (server/tools/montage.py,
// `cube_text`) : TITLE, LUT_3D_SIZE ou LUT_1D_SIZE, puis les valeurs, rouge le
// plus rapide. ffmpeg lit ce même fichier à l'export (`lut3d`
// interp=trilinear, `lut1d` interp=linear) ; ici le shader refait son calcul
// mot pour mot (libavfilter/vf_lut3d.c, ffmpeg 6.1.1 : `interp_trilinear`,
// `interp_1d_linear`) : entrée bornée à 0..1 puis mise à l'échelle N − 1,
// voisins `(int)x` et `min((int)x + 1, N − 1)`, mélanges linéaires sur r, puis
// g, puis b. Les valeurs sont lues par texelFetch dans une texture en
// flottants 32 bits : aucune interpolation du matériel, aucun arrondi 8 bits
// de la table (le filtrage linéaire des GPU ne garde que quelques bits de
// poids).
//
// L'intensité k mêle l'image et l'image passée par la LUT (mix) ; l'export
// lit une LUT réécrite (1 − k)·identité + k·LUT, ce qui revient au même :
// l'interpolation est linéaire en ses valeurs et rend l'identité exacte.
//
// L'étalonnage du plan passe avant la LUT, comme à l'export (grade puis
// lut3d) ; il reprend ici, dans le même ordre, les filtres CSS de l'aperçu
// sans LUT (player.js, gradeCss) : brightness, contrast, saturate (matrice
// de la spécification Filter Effects), puis la température (gains RVB).

import { href } from '../commun/shell.js';

// ── la lecture ──────────────────────────────────────────────
export function parseCube(text) {
  let kind = null, size = 0;
  const vals = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const c = line[0];
    if ((c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.') {
      const p = line.split(/\s+/);
      vals.push(+p[0], +p[1], +p[2]);
      continue;
    }
    const [head, arg] = line.split(/\s+/);
    if (head === 'LUT_3D_SIZE') { kind = '3d'; size = +arg; }
    else if (head === 'LUT_1D_SIZE') { kind = '1d'; size = +arg; }
  }
  const want = (kind === '3d' ? size ** 3 : size) * 3;
  if (!kind || vals.length !== want || vals.some((v) => !Number.isFinite(v))) throw new Error('fichier .cube illisible');
  return { kind, size, data: new Float32Array(vals) };
}

const cache = new Map();       // id → { lut } | { wait: [callbacks] } | { err }
export function getLut(id, onready) {
  const e = cache.get(id);
  if (e && e.lut) return e.lut;
  if (e && e.err) return null;
  if (e) { if (onready) e.wait.push(onready); return null; }
  const w = { wait: onready ? [onready] : [] };
  cache.set(id, w);
  fetch(href(`api/montage/luts/${id}/cube`)).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then((t) => { const lut = { id, ...parseCube(t) }; cache.set(id, { lut }); for (const f of w.wait) f(lut); })
    .catch((err) => { cache.set(id, { err }); for (const f of w.wait) f(null); });
  return null;
}
export const lutFailed = (id) => !!(cache.get(id) && cache.get(id).err);

// La vignette d'une LUT : la même en 17³ sur 8 bits (route /mini du serveur,
// 14 739 octets) — des centaines de vignettes sans charger des centaines de
// cubes. Pour l'étagère seulement : un plan lit toujours le cube entier.
const minis = new Map();
export function getMini(id, onready) {
  const e = minis.get(id);
  if (e && e.lut) return e.lut;
  if (e && e.err) return null;
  if (e) { if (onready) e.wait.push(onready); return null; }
  const w = { wait: onready ? [onready] : [] };
  minis.set(id, w);
  fetch(href(`api/montage/luts/${id}/mini`)).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((buf) => {
      const b = new Uint8Array(buf);
      if (b.length !== 17 * 17 * 17 * 3) throw new Error('vignette de LUT illisible');
      const data = new Float32Array(b.length);
      for (let i = 0; i < b.length; i++) data[i] = b[i] / 255;
      const lut = { id: id + '#mini', kind: '3d', size: 17, data };
      minis.set(id, { lut });
      for (const f of w.wait) f(lut);
    })
    .catch((err) => { minis.set(id, { err }); for (const f of w.wait) f(null); });
  return null;
}

// ── le rendu ────────────────────────────────────────────────
const VS = `#version 300 es
in vec2 a;
out vec2 uv;
void main() { uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
uniform sampler2D src;
uniform sampler3D lut3;
uniform sampler2D lut1;
uniform int kind;          // 0 : aucune, 1 : 3D, 2 : 1D
uniform int n;             // points par côté (3D) ou entrées (1D)
uniform float k;           // intensité 0..1
uniform vec3 grade;        // brightness, contrast, saturate (1 = neutre)
uniform vec3 temp;         // gains de la température (1 = neutre)
in vec2 uv;
out vec4 o;

vec3 c01(vec3 c) { return clamp(c, 0.0, 1.0); }

vec3 look3(vec3 c) {
  vec3 s = clamp(c, 0.0, 1.0) * float(n - 1);
  ivec3 p = ivec3(s);
  ivec3 q = min(p + 1, ivec3(n - 1));
  vec3 d = s - vec3(p);
  vec3 c000 = texelFetch(lut3, ivec3(p.x, p.y, p.z), 0).rgb;
  vec3 c001 = texelFetch(lut3, ivec3(p.x, p.y, q.z), 0).rgb;
  vec3 c010 = texelFetch(lut3, ivec3(p.x, q.y, p.z), 0).rgb;
  vec3 c011 = texelFetch(lut3, ivec3(p.x, q.y, q.z), 0).rgb;
  vec3 c100 = texelFetch(lut3, ivec3(q.x, p.y, p.z), 0).rgb;
  vec3 c101 = texelFetch(lut3, ivec3(q.x, p.y, q.z), 0).rgb;
  vec3 c110 = texelFetch(lut3, ivec3(q.x, q.y, p.z), 0).rgb;
  vec3 c111 = texelFetch(lut3, ivec3(q.x, q.y, q.z), 0).rgb;
  vec3 c00 = mix(c000, c100, d.r), c10 = mix(c010, c110, d.r), c01_ = mix(c001, c101, d.r), c11 = mix(c011, c111, d.r);
  vec3 c0 = mix(c00, c10, d.g), c1 = mix(c01_, c11, d.g);
  return mix(c0, c1, d.b);
}

float at1(int i, int ch) { return texelFetch(lut1, ivec2(i % 64, i / 64), 0)[ch]; }
vec3 look1(vec3 c) {
  vec3 r;
  for (int ch = 0; ch < 3; ch++) {
    float s = clamp(c[ch], 0.0, 1.0) * float(n - 1);
    int p = int(s);
    int q = min(p + 1, n - 1);
    r[ch] = mix(at1(p, ch), at1(q, ch), s - float(p));
  }
  return r;
}

void main() {
  vec4 px = texture(src, uv);
  vec3 c = px.rgb;
  c = c01(c * grade.x);
  c = c01((c - 0.5) * grade.y + 0.5);
  float s = grade.z;
  c = c01(vec3(
    (0.213 + 0.787 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 - 0.072 * s) * c.b,
    (0.213 - 0.213 * s) * c.r + (0.715 + 0.285 * s) * c.g + (0.072 - 0.072 * s) * c.b,
    (0.213 - 0.213 * s) * c.r + (0.715 - 0.715 * s) * c.g + (0.072 + 0.928 * s) * c.b));
  c = c01(c * temp);
  if (kind == 1) c = mix(c, look3(c), k);
  else if (kind == 2) c = mix(c, look1(c), k);
  o = vec4(c, px.a);
}`;

export class LutGL {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = 2; this.cv.height = 2;
    const gl = this.cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    this.gl = gl;
    this.textures = new Map();
    if (!gl) { this.why = 'WebGL2 indisponible dans ce navigateur'; return; }
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      this.pr = pr;
    } catch (e) { this.why = 'shader : ' + e.message; this.gl = null; return; }
    gl.useProgram(this.pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.pr, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(['src', 'lut3', 'lut1', 'kind', 'n', 'k', 'grade', 'temp'].map((x) => [x, gl.getUniformLocation(this.pr, x)]));
    gl.uniform1i(this.u.src, 0); gl.uniform1i(this.u.lut3, 1); gl.uniform1i(this.u.lut1, 2);
    this.srcTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    // des textures vides pour les unités qu'on n'emploie pas (un échantillonneur doit être lié)
    this.empty3 = this.tex3(new Float32Array(3), 1);
    this.empty1 = this.tex1(new Float32Array(3), 1);
    // les images intermédiaires d'une chaîne d'effets : en demi-flottants si
    // l'on peut y dessiner (EXT_color_buffer_float, MDN), sinon sur 8 bits
    this.half = !!gl.getExtension('EXT_color_buffer_float');
    this.pp = [null, null];
  }

  // une image intermédiaire (texture + framebuffer) à w×h
  target(i, w, h) {
    const gl = this.gl;
    let t = this.pp[i];
    if (t && t.w === w && t.h === h) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    t = this.pp[i] = { tex, fb, w, h };
    return t;
  }

  // Une chaîne d'effets : chaque passe est un étalonnage (facultatif) suivi
  // d'une LUT (facultative) — { grade, temp, lut, mix }. Une seule passe :
  // le calcul de toujours ; plusieurs : de passe en passe par deux images
  // intermédiaires, dans l'ordre de la liste (comme les filtres de l'export).
  drawChain(source, w, h, passes, srcKey = null) {
    const gl = this.gl;
    if (!gl) return false;
    if (!passes || !passes.length) passes = [{}];
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    if (!srcKey || srcKey !== this.srcKey || source !== this.src) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); this.srcKey = null; return false; }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.src = source;
      this.srcKey = srcKey;
    }
    let input = this.srcTex;
    for (let i = 0; i < passes.length; i++) {
      const last = i === passes.length - 1;
      const out = last ? null : this.target(i % 2, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      const { lut = null, mix = 1, grade = null, temp = [1, 1, 1] } = passes[i];
      const g = grade || {};
      gl.uniform3f(this.u.grade, Math.pow(2, g.exposure || 0), 1 + (g.contrast || 0) / 100, 1 + (g.saturation || 0) / 100);
      gl.uniform3f(this.u.temp, temp[0], temp[1], temp[2]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lut && lut.kind === '3d' ? this.lutTex(lut) : this.empty3);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, lut && lut.kind === '1d' ? this.lutTex(lut) : this.empty1);
      gl.uniform1i(this.u.kind, !lut ? 0 : lut.kind === '3d' ? 1 : 2);
      gl.uniform1i(this.u.n, lut ? lut.size : 1);
      gl.uniform1f(this.u.k, lut ? Math.max(0, Math.min(1, mix)) : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (out) input = out.tex;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  get ok() { return !!this.gl; }

  tex3(data, n) {
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, n, n, n, 0, gl.RGB, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.NEAREST);
    return t;
  }

  tex1(data, n) {                      // N entrées rangées 64 par ligne (N ≤ 4096)
    const gl = this.gl, t = gl.createTexture();
    const w = Math.min(64, n), h = Math.ceil(n / 64);
    const buf = new Float32Array(w * h * 3);
    buf.set(data);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, w, h, 0, gl.RGB, gl.FLOAT, buf);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    return t;
  }

  lutTex(lut) {
    let t = this.textures.get(lut.id);
    if (!t) { t = lut.kind === '3d' ? this.tex3(lut.data, lut.size) : this.tex1(lut.data, lut.size); this.textures.set(lut.id, t); }
    return t;
  }

  // Rend `source` (vidéo, image, canevas) à w×h dans this.cv. opts : { lut, mix, grade, temp: [r,g,b], srcKey }
  // srcKey : la même source qu'au dessin d'avant (une étagère de vignettes) : elle ne remonte pas au GPU.
  draw(source, w, h, { lut = null, mix = 1, grade = null, temp = [1, 1, 1], srcKey = null } = {}) {
    return this.drawChain(source, w, h, [{ lut, mix, grade, temp }], srcKey);
  }
}

// Les passes d'une chaîne d'effets (model.js, chainOf) : un étalonnage et la
// LUT qui le suit se font en une passe (l'ordre du shader : étalonnage puis
// LUT) ; `luts` : les LUT chargées, par identifiant. `tempOf` : les gains de
// la température (player.js).
export function passesOf(steps, luts, tempOf) {
  const out = [];
  let open = null;
  for (const f of steps) {
    if (f.type === 'grade') {
      open = { grade: f, temp: Math.abs((f.temperature || 6500) - 6500) > 0.5 ? tempOf(f.temperature) : [1, 1, 1] };
      out.push(open);
    } else if (f.type === 'lut') {
      const lut = luts.get(f.lut);
      if (!lut || !(f.mix > 0)) continue;
      if (open) { open.lut = lut; open.mix = f.mix; } else out.push({ lut, mix: f.mix });
      open = null;
    }
  }
  return out;
}

let shared = null;
export const lutGL = () => (shared || (shared = new LutGL()));
