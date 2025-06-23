
'use client';

import { useRef, useState, useEffect } from 'react';

export default function AudioPitchHistory() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef  = useRef<HTMLAudioElement>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const dataRef       = useRef<Float32Array | null>(null);
  const rafRef        = useRef<number>(0);

  const [streaming, setStreaming] = useState(false);
  const [audioEnded, setAudioEnded] = useState(false);

  const defaultPitches = useRef<number[]>([]);
  const userPitches    = useRef<number[]>([]);

  const frameDur = useRef(0);
  const totalDur = useRef(0);

  const lastIdxRef = useRef(-1);

  function autoCorrelate(buf: Float32Array, sr: number): number {
    const SIZE = buf.length;
    let bestOffset = -1, bestCorr = 0;
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / SIZE);
    if (rms < 0.01) return -1;
    for (let off = 64; off < SIZE / 2; off++) {
      let corr = 0;
      for (let i = 0; i < SIZE - off; i++) {
        corr += buf[i] * buf[i + off];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestOffset = off;
      }
    }
    return bestOffset > 0 ? sr / bestOffset : -1;
  }

  const resize = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    c.width  = width  * dpr;
    c.height = height * dpr;
  };

  useEffect(() => {
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/test.wav');
      const buf = await res.arrayBuffer();
      const ctx = new AudioContext();
      const ab  = await ctx.decodeAudioData(buf);
      const data = ab.getChannelData(0);

      const frameSize = 4096;
      frameDur.current = frameSize / ab.sampleRate;
      totalDur.current = ab.duration;

      const pts: number[] = [];
      for (let i = 0; i + frameSize < data.length; i += frameSize) {
        const seg = data.slice(i, i + frameSize);
        const p = autoCorrelate(seg, ab.sampleRate);
        pts.push(p > 0 ? p : 0);
      }
      defaultPitches.current = pts;
      ctx.close();
    })();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      setAudioEnded(true);
      stop();
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, []);

  const start = async () => {
    if (streaming || audioRef.current?.ended) return;
    audioRef.current?.play();

    userPitches.current = [];
    lastIdxRef.current = -1;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx    = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const filter   = ctx.createBiquadFilter();
    filter.type    = 'highpass';
    filter.frequency.value = 80;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.8;

    dataRef.current = new Float32Array(analyser.fftSize);
    ctx.createMediaStreamSource(stream)
       .connect(filter)
       .connect(analyser);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    setStreaming(true);
    rafRef.current = requestAnimationFrame(draw);
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setStreaming(false);
  };

  function draw() {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    const total = totalDur.current;
    const step  = total <= 10 ? 1 : total <= 60 ? 5 : 10;
    ctx.strokeStyle = '#555';
    ctx.fillStyle   = '#777';
    ctx.lineWidth   = 1;
    ctx.font        = `${12 * (h/200)}px sans-serif`;
    for (let t = 0; t <= total; t += step) {
      const x = (t / total) * w;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - 5 * (h/200));
      ctx.stroke();
      ctx.fillText(`${t}s`, x + 2, h - 7 * (h/200));
    }

    const now = audioRef.current?.currentTime ?? 0;
    const idx = Math.floor(now / frameDur.current);

    if (analyserRef.current && dataRef.current && idx > lastIdxRef.current) {
      analyserRef.current.getFloatTimeDomainData(dataRef.current);
      const p = autoCorrelate(dataRef.current, audioCtxRef.current!.sampleRate);
      userPitches.current.push(p > 0 ? p : 0);
      lastIdxRef.current = idx;
    }

    const def = defaultPitches.current.slice(0, idx);
    const usr = userPitches.current;
    const mx = Math.max(...def, ...usr, 1);

    ctx.beginPath();
    ctx.strokeStyle = 'deepskyblue';
    ctx.lineWidth   = 2.5;
    def.forEach((v, i) => {
      const t = i * frameDur.current;
      const x = (t / total) * w;
      const y = h - Math.min(v/mx, 1) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = 'tomato';
    ctx.lineWidth   = 2.5;
    usr.forEach((v, i) => {
      const t = i * frameDur.current;
      const x = (t / total) * w;
      const y = h - Math.min(v/mx, 1) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    rafRef.current = requestAnimationFrame(draw);
  }

  return (
    <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>🎙️ 피치 비교 (디폴트 vs 입력)</h1>
      <audio ref={audioRef} src="/test.wav" />
      <canvas
        ref={canvasRef}
        height={200}
        style={{
          width: '600px',
          height: '200px',
          border: '1px solid #444',
          borderRadius: 4,
          background: '#111'
        }}
      />
      
      <div style={{ marginTop: '1rem' }}>
        <button onClick={start} disabled={streaming || audioEnded} style={{ marginRight: '1rem' }}>
          시작
        </button>
        <button onClick={stop} disabled={!streaming}>
          중지
        </button>
      </div>
    </div>
  );
}
