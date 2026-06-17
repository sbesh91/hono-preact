import { rampAmplitude } from './shader-anim.ts';

export type WorkerInMsg =
  | {
      type: 'init';
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      reducedMotion: boolean;
    }
  | { type: 'resize'; width: number; height: number }
  | { type: 'visibility'; hidden: boolean };

export type WorkerOutMsg = { type: 'ready' } | { type: 'error' };

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// u_amp scales the wave field; at 0 the shader is a flat palette blend, which is
// what makes the fade-in read as the gradient coming alive. A/B/C must stay in
// sync with BASE_GRADIENT in HeroShader.tsx.
const FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_amp;
out vec4 outColor;
void main() {
  vec2 uv = (gl_FragCoord.xy / u_res.xy - 0.5);
  uv.x *= u_res.x / u_res.y;
  float t = u_time * 0.25;
  float v = sin(uv.x * 3.0 + t)
          + sin((uv.y + t) * 4.0)
          + sin((uv.x + uv.y) * 3.0 + t * 1.2)
          + sin(length(uv) * 6.0 - t * 1.5);
  v *= 0.25 * u_amp;
  vec3 A = vec3(1.00, 0.95, 0.93);
  vec3 B = vec3(1.00, 0.62, 0.43);
  vec3 C = vec3(0.79, 0.49, 1.00);
  vec3 col = mix(A, B, 0.5 + 0.5 * v);
  col = mix(col, C, 0.25 * sin(v * 3.1415));
  outColor = vec4(col, 1.0);
}`;

// The worker global. The DOM lib types `self` as `Window`, whose `postMessage`
// signature differs from a worker's, so we alias the one method we call.
const post = (msg: WorkerOutMsg): void =>
  (self as unknown as { postMessage(message: WorkerOutMsg): void }).postMessage(
    msg
  );

let gl: WebGL2RenderingContext | null = null;
let surface: OffscreenCanvas | null = null;
let uRes: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uAmp: WebGLUniformLocation | null = null;
let rafId = 0;
// t0 is set on the first painted frame (not at construction), so u_time and the
// amplitude ramp start from zero on the first visible frame regardless of worker
// spawn latency. Do not initialize this to performance.now() here.
let t0 = 0;
let firstFrame = true;
let reduceMotion = false;
let width = 0;
let height = 0;

function compile(type: number, src: string): WebGLShader | null {
  if (!gl) return null;
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('HeroShader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function setup(init: Extract<WorkerInMsg, { type: 'init' }>): boolean {
  surface = init.canvas;
  width = init.width;
  height = init.height;
  reduceMotion = init.reducedMotion;
  surface.width = width;
  surface.height = height;

  gl = surface.getContext('webgl2', {
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) return false;

  const vs = compile(gl.VERTEX_SHADER, VS);
  const fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return false;

  const prog = gl.createProgram();
  if (!prog) return false;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('HeroShader link error:', gl.getProgramInfoLog(prog));
    return false;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  if (!buf) return false;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  uRes = gl.getUniformLocation(prog, 'u_res');
  uTime = gl.getUniformLocation(prog, 'u_time');
  uAmp = gl.getUniformLocation(prog, 'u_amp');
  gl.viewport(0, 0, width, height);
  return true;
}

function drawFrame(): void {
  if (!gl) return;
  const now = performance.now();
  if (firstFrame) t0 = now;
  const elapsed = now - t0;
  gl.uniform2f(uRes, width, height);
  gl.uniform1f(uTime, elapsed / 1000);
  gl.uniform1f(uAmp, rampAmplitude(elapsed, reduceMotion));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (firstFrame) {
    firstFrame = false;
    // First frame is painted; the main thread now fades the canvas in.
    post({ type: 'ready' });
  }
}

function loop(): void {
  drawFrame();
  rafId = requestAnimationFrame(loop);
}

self.onmessage = (e: MessageEvent): void => {
  const msg = e.data as WorkerInMsg;
  if (msg.type === 'init') {
    if (!setup(msg)) {
      post({ type: 'error' });
      return;
    }
    if (reduceMotion) {
      drawFrame();
    } else {
      rafId = requestAnimationFrame(loop);
    }
  } else if (msg.type === 'resize') {
    // Skip unchanged dimensions: reassigning surface.width/height resets the
    // drawing buffer, so a no-op resize would needlessly clear the canvas.
    if (msg.width === width && msg.height === height) return;
    width = msg.width;
    height = msg.height;
    if (surface) {
      surface.width = width;
      surface.height = height;
    }
    if (gl) gl.viewport(0, 0, width, height);
  } else if (msg.type === 'visibility') {
    if (msg.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!reduceMotion && rafId === 0) {
      rafId = requestAnimationFrame(loop);
    }
  }
};
