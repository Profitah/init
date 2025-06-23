'use client';

import { useRef, useEffect } from 'react';

interface PitchPoint {
  time_sec: number;
  pitch_hz: number;
}

export default function AudioPitchHistory() {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const dataRef       = useRef<Float32Array | null>(null);
  const rafRef        = useRef<number>(0);

  // ── JSON에서 불러온 기준 피치 데이터 ──
  const defaultDataRef = useRef<PitchPoint[]>([]);
  const userPitches    = useRef<number[]>([]);

  const frameDur      = useRef(0);
  const invFrameDur   = useRef(0);
  const totalDur      = useRef(0);
  const startTimeRef  = useRef(0);
  const lastIdxRef    = useRef(-1);

  function autoCorrelate(buf: Float32Array, sr: number): number {
    const SIZE = buf.length;
    let bestOffset = -1, bestCorr = 0;
    const rms = Math.sqrt(buf.reduce((s, v) => s + v*v, 0)/SIZE);
    if (rms < 0.01) return -1;
    for (let off = 64; off < SIZE/2; off++) {
      let corr = 0;
      for (let i = 0; i < SIZE-off; i++) {
        corr += buf[i]*buf[i+off];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestOffset = off;
      }
    }
    return bestOffset > 0 ? sr / bestOffset : -1;
  }

  // 전체 재그리기: JSON 기준(파란) + 사용자 입력(빨강)
  const drawAll = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);

    // 1) JSON에서 불러온 기준 피치 (파란색)
    const def = defaultDataRef.current;
    if (def.length && totalDur.current > 0) {
      const mx = Math.max(
        ...def.map(d => d.pitch_hz),
        ...userPitches.current,
        1
      );
      ctx.beginPath();
      ctx.strokeStyle = 'deepskyblue';
      ctx.lineWidth   = 2;
      def.forEach((d, i) => {
        const x = (d.time_sec / totalDur.current) * w;
        const y = h - Math.min(d.pitch_hz / mx, 1) * h;
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 2) 사용자 마이크에서 실시간으로 측정된 피치(빨강)
    if (userPitches.current.length) {
      const mx = Math.max(
        ...userPitches.current,
        ...defaultDataRef.current.map(d => d.pitch_hz),
        1
      );
      ctx.beginPath();
      ctx.strokeStyle = 'tomato';
      ctx.lineWidth   = 2;
      userPitches.current.forEach((p, i) => {
        const t = i * frameDur.current;
        const x = (t / totalDur.current) * w;
        const y = h - Math.min(p / mx, 1) * h;
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  };

  // 캔버스 리사이즈 대응
  const resize = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    c.width  = width  * dpr;
    c.height = height * dpr;
    drawAll();
  };

  useEffect(() => {
    window.addEventListener('resize', resize);
    resize();

    // ── public/pitch.json 에서 기준 피치 불러오기 ──
    (async () => {
      try {
        // 1) pitch.json 파일을 fetch 요청
        const res = await fetch('/pitch.json');
        // 2) HTTP 상태가 OK가 아니면 에러 발생
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // 3) 응답을 JSON으로 파싱
        const data: PitchPoint[] = await res.json();
        // 4) defaultDataRef에 저장
        defaultDataRef.current = data;
        // 5) 프레임 간격 계산 (첫 두 요소의 time_sec 차이)
        if (data.length > 1) {
          frameDur.current    = data[1].time_sec - data[0].time_sec;
          invFrameDur.current = 1 / frameDur.current;
        }
        // 6) 총 재생 시간 설정 (마지막 요소의 time_sec)
        totalDur.current = data.length
          ? data[data.length - 1].time_sec
          : 0;
        // 7) JSON에서 가져온 모든 time_sec 값 출력
        // console.log('Fetched time_sec values:', data.map(d => d.time_sec));
        // 8) 첫 렌더링
        drawAll();
      } catch (e) {
        console.error('pitch.json load failed:', e);
      }
    })();

    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  const start = async () => {
    if (audioCtxRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 80;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;

    const buf = new Float32Array(analyser.fftSize);
    dataRef.current = buf;
    ctx.createMediaStreamSource(stream)
       .connect(filter)
       .connect(analyser);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    userPitches.current = [];
    lastIdxRef.current  = -1;
    startTimeRef.current = ctx.currentTime;

    const tick = () => {
      const now = ctx.currentTime - startTimeRef.current;
      const idx = (now * invFrameDur.current) | 0;
      if (idx > lastIdxRef.current) {
        analyser.getFloatTimeDomainData(buf);
        const p = autoCorrelate(buf, ctx.sampleRate);
        userPitches.current.push(p > 0 ? p : 0);
        lastIdxRef.current = idx;
      }
      drawAll();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!audioCtxRef.current) return;
    cancelAnimationFrame(rafRef.current);
    audioCtxRef.current.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <h1>🎙️ 실시간 피치 비교</h1>

      <canvas
        suppressHydrationWarning
        ref={canvasRef}
        style={{
          width: '100%',
          maxWidth: '800px',
          height: '200px',
          border: '1px solid #444',
          borderRadius: 4,
          background: '#111'
        }}
      />

      {/* ── 범례 표시 ── */}
      <div style={{ color: '#fff', marginTop: '0.5rem', fontSize: '0.9rem' }}>
        <span style={{ color: 'deepskyblue' }}>■ 기준 피치 (JSON)</span>
        <span style={{ marginLeft: '1rem', color: 'tomato' }}>■ 사용자 피치</span>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <button onClick={start} style={{ marginRight: '1rem' }}>
          시작
        </button>
        <button onClick={stop}>
          중지
        </button>
      </div>
    </div>
  );
}
