import { useEffect, useRef, useState } from 'preact/hooks';

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;
void main() {
  vec2 uv = (gl_FragCoord.xy / u_res.xy - 0.5);
  uv.x *= u_res.x / u_res.y;
  float t = u_time * 0.25;
  float v = sin(uv.x * 3.0 + t)
          + sin((uv.y + t) * 4.0)
          + sin((uv.x + uv.y) * 3.0 + t * 1.2)
          + sin(length(uv) * 6.0 - t * 1.5);
  v *= 0.25;
  vec3 A = vec3(1.00, 0.95, 0.93);
  vec3 B = vec3(1.00, 0.62, 0.43);
  vec3 C = vec3(0.79, 0.49, 1.00);
  vec3 col = mix(A, B, 0.5 + 0.5 * v);
  col = mix(col, C, 0.25 * sin(v * 3.1415));
  outColor = vec4(col, 1.0);
}`;

const FADE_GRADIENT =
  'linear-gradient(to bottom,' +
  ' rgba(255,255,255,0) 0%,' +
  ' rgba(255,255,255,0) 30%,' +
  ' rgba(255,255,255,0.35) 55%,' +
  ' rgba(255,255,255,0.75) 80%,' +
  ' rgba(255,255,255,1) 100%)';

const FALLBACK_GRADIENT =
  'linear-gradient(135deg, #FFF1ED 0%, #FF9F6E 50%, #C97DFF 100%)';

export function HeroShader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;

    if (!gl) {
      setFallback(true);
      return;
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        // Surface to console but do not throw; fall back instead.
        console.error('HeroShader compile error:', gl.getShaderInfoLog(s));
      }
      return s;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('HeroShader link error:', gl.getProgramInfoLog(prog));
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const t0 = performance.now();
    let rafId = 0;
    let paused = false;

    const drawFrame = () => {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const loop = () => {
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    if (reduceMotion) {
      drawFrame();
    } else {
      rafId = requestAnimationFrame(loop);
    }

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        paused = true;
      } else if (paused && !reduceMotion) {
        paused = false;
        rafId = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div class="absolute inset-0 -z-10 pointer-events-none" aria-hidden="true">
      <canvas ref={canvasRef} class="absolute inset-0 block w-full h-full" />
      {fallback && (
        <div
          class="absolute inset-0"
          style={{ background: FALLBACK_GRADIENT }}
        />
      )}
      <div class="absolute inset-0" style={{ background: FADE_GRADIENT }} />
    </div>
  );
}
