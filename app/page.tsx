'use client';

import { useRef, useEffect, useState } from 'react';

interface PitchPoint {
  time_sec: number;
  pitch_hz: number;
}

export default function AudioPitchHistorySVG() {
  const svgRef = useRef<SVGSVGElement>(null);

  // 기준 피치 데이터 (JSON)
  const [defPts, setDefPts] = useState<PitchPoint[]>([]);
  // 사용자 실시간 피치
  const [userPts, setUserPts] = useState<number[]>([]);

  // 오디오 & 분석기
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef     = useRef<Float32Array | null>(null);

  // 시간 관련
  const frameDurRef    = useRef(0);
  const invFrameDurRef = useRef(0);
  const startTimeRef   = useRef(0);
  const lastIdxRef     = useRef(-1);
  const rafRef         = useRef(0);

  // SVG 뷰 크기
  const w = 800;
  const h = 200;
  const viewBox = `0 0 ${w} ${h}`;

  // JSON 로드
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch('/pitch.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PitchPoint[];
        setDefPts(data);
      } catch (e) {
        console.error('pitch.json load failed:', e);
      }
    })();
  }, []);

  // frameDur 계산
  useEffect(() => {
    if (defPts.length > 1) {
      const dur = defPts[1].time_sec - defPts[0].time_sec;
      frameDurRef.current    = dur;
      invFrameDurRef.current = 1 / dur;
    }
  }, [defPts]);

  // autoCorrelate 함수 (캔버스 버전과 동일)
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

  // 오디오 시작
  const start = async () => {
    if (audioCtxRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    // 필터 + 분석기
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 80;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;

    const buf = new Float32Array(analyser.fftSize);
    dataRef.current = buf;

    const src = ctx.createMediaStreamSource(stream);
    src.connect(filter).connect(analyser);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    startTimeRef.current = ctx.currentTime;
    lastIdxRef.current = -1;
    setUserPts([]);

    const tick = () => {
      if (!analyserRef.current) return;
      const now = ctx.currentTime - startTimeRef.current;
      const idx = Math.floor(now * invFrameDurRef.current);
      if (idx > lastIdxRef.current) {
        analyser.getFloatTimeDomainData(buf);
        const p = autoCorrelate(buf, ctx.sampleRate);
        setUserPts(prev => [...prev, p > 0 ? p : 0]);
        lastIdxRef.current = idx;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // 오디오 중지
  const stop = () => {
    if (!audioCtxRef.current) return;
    cancelAnimationFrame(rafRef.current);
    audioCtxRef.current.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  // SVG polyline 좌표 빌드
  const buildPolyline = (
    src: (PitchPoint | number)[],
    isUser: boolean,
    totalDur: number,
    maxPitch: number
  ) => {
    const pts: string[] = [];
    src.forEach((item, i) => {
      const pitch = isUser
        ? (item as number)
        : (item as PitchPoint).pitch_hz;
      const t = isUser
        ? i * frameDurRef.current
        : (item as PitchPoint).time_sec;
      const x = (t / totalDur) * w;
      const y = h - Math.min(pitch / maxPitch, 1) * h;
      pts.push(`${x},${y}`);
    });
    return pts.join(' ');
  };

  // 총 재생 시간 · 최대 피치
  const totalDur = defPts.length
    ? defPts[defPts.length - 1].time_sec
    : 1;
  const maxPitch = Math.max(
    ...defPts.map(p => p.pitch_hz),
    ...userPts,
    1
  );

  return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <h1>🎙️ 실시간 피치 비교 (SVG)</h1>

      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={{
          width: '100%',
          maxWidth: '800px',
          height: 'auto',
          background: '#111',
          border: '1px solid #444',
          borderRadius: 4,
        }}
      >
        {/* 기준 피치 (파랑) */}
        {defPts.length > 1 && (
          <polyline
            points={buildPolyline(defPts, false, totalDur, maxPitch)}
            fill="none"
            stroke="deepskyblue"
            strokeWidth="2"
          />
        )}

        {/* 사용자 피치 (빨강) */}
        {userPts.length > 0 && (
          <polyline
            points={buildPolyline(userPts, true, totalDur, maxPitch)}
            fill="none"
            stroke="tomato"
            strokeWidth="2"
          />
        )}
      </svg>

      <div style={{ color: '#fff', marginTop: '0.5rem', fontSize: '0.9rem' }}>
        <span style={{ color: 'deepskyblue' }}>■ 기준 피치 (JSON)</span>
        <span style={{ marginLeft: '1rem', color: 'tomato' }}>■ 사용자 피치</span>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <button onClick={start} style={{ marginRight: '1rem' }}>
          시작
        </button>
        <button onClick={stop}>중지</button>
        <button
          style={{ marginLeft: '1rem' }}
          onClick={() => {
            const svg = svgRef.current;
            if (!svg) return;
            const xml = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([xml], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pitch.svg';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          SVG 다운로드
        </button>
      </div>
    </div>
  );
}
