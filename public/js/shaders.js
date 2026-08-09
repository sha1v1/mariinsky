// GLSL passes for image layers. One WebGL context is shared by every layer in
// the app -- browsers cap you at roughly sixteen live contexts, and an orb can
// easily want more layers than that.
//
// Everything runs premultiplied. Layers are cut-outs with real alpha, and
// blurring straight RGBA drags the colour of transparent pixels into the
// visible ones, which puts a black halo around every shard. Premultiply, blur,
// divide back out at the end.
//
// The blur is a 9-tap gaussian run as a separable pair, and re-run a few times
// for wide radii: cheaper and smoother than trying to reach across the image in
// a single pass, which bands.

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const BLUR = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
varying vec2 v_uv;
void main() {
  float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
  vec4 c = texture2D(u_tex, v_uv) * w0;
  c += (texture2D(u_tex, v_uv + u_dir) + texture2D(u_tex, v_uv - u_dir)) * w1;
  c += (texture2D(u_tex, v_uv + u_dir * 2.0) + texture2D(u_tex, v_uv - u_dir * 2.0)) * w2;
  c += (texture2D(u_tex, v_uv + u_dir * 3.0) + texture2D(u_tex, v_uv - u_dir * 3.0)) * w3;
  c += (texture2D(u_tex, v_uv + u_dir * 4.0) + texture2D(u_tex, v_uv - u_dir * 4.0)) * w4;
  gl_FragColor = c;
}`;

const COMPOSITE = `
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_blur;
uniform vec2 u_texel;
uniform int u_mode;
uniform float u_bloom, u_bleed, u_haze, u_drain, u_lift;
varying vec2 v_uv;

const vec3 W = vec3(0.2126, 0.7152, 0.0722);

vec4 unp(vec4 c) { return c.a > 0.003 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }

void main() {
  vec4 s = unp(texture2D(u_src, v_uv));
  vec4 b = unp(texture2D(u_blur, v_uv));
  vec3 rgb;
  float a;

  if (u_mode == 0) {
    // blurry -- it was never in focus. Nothing but the blur, bled very slightly
    // toward grey so it does not read as a sharp photo behind frosted glass.
    rgb = mix(vec3(dot(b.rgb, W)), b.rgb, 0.92);
    a = b.a;

  } else if (u_mode == 1) {
    // dreamy -- the sharp image is still there, but its highlights have escaped
    // it. Bloom is the blurred bright end added back on top; the bleed pulls the
    // red and blue channels apart the way cheap glass does.
    vec3 lit = max(b.rgb - 0.52, 0.0);
    rgb = s.rgb + lit * u_bloom * 2.6;
    vec2 o = u_texel * (2.0 + u_bleed * 9.0);
    float r = unp(texture2D(u_blur, v_uv + o)).r;
    float bl = unp(texture2D(u_blur, v_uv - o)).b;
    rgb = mix(rgb, vec3(r, rgb.g, bl), u_bleed);
    rgb = rgb * (1.0 - u_lift * 0.3) + u_lift * 0.15;
    a = mix(s.a, max(s.a, b.a), 0.4);

  } else {
    // distant -- air between you and it. Haze mixes toward the blur and toward
    // the colour of the air itself, contrast collapses, and the whole thing
    // gives up its saturation. This is aerial perspective, which is what makes
    // a thing read as far away rather than merely small.
    rgb = mix(s.rgb, b.rgb, u_haze);
    rgb = mix(rgb, vec3(dot(rgb, W)), u_drain);
    rgb = mix(rgb, vec3(0.54, 0.57, 0.66), u_haze * 0.42);
    rgb = (rgb - 0.5) * (1.0 - u_haze * 0.38) + 0.5;
    rgb += u_lift * 0.12;
    a = s.a * (1.0 - u_haze * 0.22);
  }

  rgb = clamp(rgb, 0.0, 1.0);
  gl_FragColor = vec4(rgb * a, a);
}`;

const MODES = { blurry: 0, dreamy: 1, distant: 2 };

let GL = null;

function gpu() {
  if (GL !== null) return GL;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true,
  });
  if (!gl) { GL = false; return GL; }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  GL = {
    canvas, gl, quad,
    blur: program(gl, VERT, BLUR),
    comp: program(gl, VERT, COMPOSITE),
  };
  return GL;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    }
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  clampy(gl);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

function clampy(gl) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function bindQuad(gl, prog, quad) {
  gl.useProgram(prog);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

/** A cache key for one shader configuration, so layers are not rebuilt for free. */
export function shaderKey(spec) {
  if (!spec || !MODES.hasOwnProperty(spec.kind)) return '';
  return `${spec.kind}|${spec.radius}|${spec.bloom}|${spec.bleed}|${spec.haze}|${spec.drain}|${spec.lift}`;
}

/**
 * Run a layer canvas through one of the shaders. Returns a new canvas; the
 * input is left alone. Falls back to returning the input untouched if this
 * machine has no WebGL, because a memory with no shader is still a memory.
 */
export function applyShader(source, spec) {
  if (!spec || !MODES.hasOwnProperty(spec.kind)) return source;
  const G = gpu();
  if (!G) return source;
  const { gl, quad } = G;
  const w = source.width, h = source.height;
  G.canvas.width = w;
  G.canvas.height = h;

  const src = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  clampy(gl);

  const a = target(gl, w, h);
  const b = target(gl, w, h);

  // Wide blurs are reached by repeating the pair rather than by stretching the
  // taps, which would band.
  const radius = Math.max(0, spec.radius || 0);
  const passes = Math.min(4, Math.max(1, Math.ceil(radius / 4)));
  const step = radius / passes;

  gl.viewport(0, 0, w, h);
  gl.disable(gl.BLEND);
  bindQuad(gl, G.blur, quad);
  const uTex = gl.getUniformLocation(G.blur, 'u_tex');
  const uDir = gl.getUniformLocation(G.blur, 'u_dir');

  let read = src;
  for (let i = 0; i < passes; i++) {
    for (const [dx, dy, dst] of [[step / w, 0, a], [0, step / h, b]]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read);
      gl.uniform1i(uTex, 0);
      gl.uniform2f(uDir, dx, dy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      read = dst.tex;
    }
  }

  bindQuad(gl, G.comp, quad);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.uniform1i(gl.getUniformLocation(G.comp, 'u_src'), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, read);
  gl.uniform1i(gl.getUniformLocation(G.comp, 'u_blur'), 1);
  gl.uniform2f(gl.getUniformLocation(G.comp, 'u_texel'), 1 / w, 1 / h);
  gl.uniform1i(gl.getUniformLocation(G.comp, 'u_mode'), MODES[spec.kind]);
  for (const k of ['bloom', 'bleed', 'haze', 'drain', 'lift']) {
    gl.uniform1f(gl.getUniformLocation(G.comp, `u_${k}`), spec[k] || 0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(G.canvas, 0, 0);

  gl.deleteTexture(src);
  for (const t of [a, b]) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
  return out;
}
