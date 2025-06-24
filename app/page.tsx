'use client';

import { useRef, useEffect, useState } from 'react';
import YouTube from 'react-youtube';

/* ---------- 타입 ---------- */
interface PitchPoint  { time_sec: number; pitch_hz: number; }
interface CaptionLine { startTime: number; endTime: number; script: string; }

export default function AudioPitchWithCaptionSVG() {
  /* ---------- refs ---------- */
  const svgRef      = useRef<SVGSVGElement>(null);
  const playRef     = useRef<any>(null);

  // 사용자 피치 캡처 refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufRef      = useRef<Float32Array | null>(null);
  const startRef    = useRef(0);
  const lastIdxRef  = useRef(-1);
  const rafRef      = useRef(0);

  // 현재 캡션 인덱스
  const curIdxRef   = useRef<number>(-1);

  /* ---------- state ---------- */
  const [defPts,  setDefPts]  = useState<PitchPoint[]>([]);
  const [caps,    setCaps]    = useState<CaptionLine[]>([]);
  const [userPts, setUserPts] = useState<number[]>([]);
  const [curCap,  setCurCap]  = useState<CaptionLine | null>(null);

  /* ---------- constants ---------- */
  const W = 800, H = 220;
  const viewBox = `0 0 ${W} ${H}`;
  const VIDEO_ID = '-6bdHjc2gWM';

  /* ---------- JSON 로드 ---------- */
  useEffect(() => {
    (async () => {
      const [pRes, cRes] = await Promise.all([
        fetch('/pitch.json'),
        fetch('/script.json'),
      ]);
      if (pRes.ok && cRes.ok) {
        setDefPts(await pRes.json());
        setCaps(await cRes.json());
      }
    })();
  }, []);

  /* ---------- frameDur 계산 ---------- */
  const frameDurRef = useRef(0);
  const invFrameDur = useRef(0);
  useEffect(() => {
    if (defPts.length > 1) {
      const d = defPts[1].time_sec - defPts[0].time_sec;
      frameDurRef.current = d;
      invFrameDur.current = 1 / d;
    }
  }, [defPts]);

  /* ---------- autoCorrelate ---------- */
  function autoCorrelate(buf: Float32Array, sr: number) {
    const N = buf.length;
    let best = -1, bestCorr = 0;
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / N);
    if (rms < 0.01) return -1;
    for (let off = 64; off < N / 2; off++) {
      let corr = 0;
      for (let i = 0; i < N - off; i++) corr += buf[i] * buf[i + off];
      if (corr > bestCorr) {
        bestCorr = corr;
        best = off;
      }
    }
    return best > 0 ? sr / best : -1;
  }

  /* ---------- 전체 시작 (영상 + 피치) ---------- */
  const startAll = async () => {
    // 1) YouTube 재생
    if (playRef.current?.playVideo) {
      playRef.current.playVideo();
    }

    // 2) 마이크 피치 캡처
    if (audioCtxRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    const buf = new Float32Array(analyser.fftSize);
    ctx.createMediaStreamSource(stream).connect(analyser);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    bufRef.current = buf;
    startRef.current = ctx.currentTime;
    lastIdxRef.current = -1;
    setUserPts([]);

    const tick = () => {
      if (!analyserRef.current || !bufRef.current) return;
      const now = ctx.currentTime - startRef.current;
      const idx = Math.floor(now * invFrameDur.current);
      if (idx > lastIdxRef.current) {
        analyser.getFloatTimeDomainData(bufRef.current);
        const p = autoCorrelate(bufRef.current, ctx.sampleRate);
        setUserPts(prev => [...prev, p > 0 ? p : 0]);
        lastIdxRef.current = idx;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  /* ---------- 전체 중지 (영상 일시정지 + 피치 중지) ---------- */
  const stopAll = () => {
    // 1) YouTube 일시정지
    if (playRef.current?.pauseVideo) {
      playRef.current.pauseVideo();
    }
    // 2) 마이크 캡처 중지
    if (!audioCtxRef.current) return;
    cancelAnimationFrame(rafRef.current);
    audioCtxRef.current.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    bufRef.current = null;
  };

  /* ---------- YouTube 준비 시 ---------- */
  const onPlayerReady = (event: any) => {
    playRef.current = event.target;
  };

  /* ---------- 캡션 동기화 ---------- */
  useEffect(() => {
    const tick = () => {
      const now = playRef.current?.getCurrentTime?.() ?? 0;
      const idx = caps.findIndex(c => now >= c.startTime && now <= c.endTime);
      if (idx !== curIdxRef.current) {
        curIdxRef.current = idx;
        setCurCap(idx >= 0 ? caps[idx] : null);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [caps]);

  /* ---------- polyline 생성 ---------- */
  function buildLine(
    src: (PitchPoint | number)[],
    isUser: boolean,
    sStart: number,
    sEnd: number,
    maxP: number
  ) {
    const dur = Math.max(sEnd - sStart, 0.01);
    return src.map((v, i) => {
      const pitch = isUser ? (v as number) : (v as PitchPoint).pitch_hz;
      const t = isUser
        ? sStart + i * frameDurRef.current
        : (v as PitchPoint).time_sec;
      const x = ((t - sStart) / dur) * W;
      const y = H - Math.min(pitch / maxP, 1) * H;
      return `${x},${y}`;
    }).join(' ');
  }

  /* ---------- 구간 & 데이터 ---------- */
  const segStart = curCap?.startTime ?? 0;
  const nextStart = curIdxRef.current >= 0 && caps[curIdxRef.current + 1]
    ? caps[curIdxRef.current + 1].startTime
    : undefined;
  const segEnd = nextStart ?? curCap?.endTime ?? 1;

  const defSeg = defPts.filter(p => p.time_sec >= segStart && p.time_sec <= segEnd);
  const maxPitch = Math.max(...defSeg.map(p => p.pitch_hz), ...userPts, 1);

  /* ---------- render ---------- */
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>
      <h2>🎙️ 대사·침묵 구간별 실시간 피치</h2>

      <YouTube
        videoId={VIDEO_ID}
        onReady={onPlayerReady}
        opts={{ playerVars: { playsinline: 1, controls: 1 } }}
      />

      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={{
          width: '100%',
          maxWidth: W,
          background: '#111',
          border: '1px solid #444',
          borderRadius: 4
        }}
      >
        {/* 기준 피치 (파랑) */}
        {defSeg.length > 1 && (
          <polyline
            points={buildLine(defSeg, false, segStart, segEnd, maxPitch)}
            fill="none"
            stroke="deepskyblue"
            strokeWidth={2}
          />
        )}
        {/* 사용자 피치 (빨강) */}
        {userPts.length > 0 && (
          <polyline
            points={buildLine(userPts, true, segStart, segEnd, maxPitch)}
            fill="none"
            stroke="tomato"
            strokeWidth={2}
          />
        )}
      </svg>

      <div style={{
        marginTop: '1rem',
        minHeight: '2.2em',
        fontSize: '1.1rem',
        color: '#0f0'
      }}>
        {curCap?.script ?? ''}
      </div>

      <div style={{ marginTop: '1rem' }}>
        <button onClick={startAll} style={{ marginRight: '1rem' }}>시작</button>
        <button onClick={stopAll}>중지</button>
        <button
          style={{ marginLeft: '1rem' }}
          onClick={() => {
            if (!svgRef.current) return;
            const xml = new XMLSerializer().serializeToString(svgRef.current);
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
