'use client';

import { useRef, useEffect, useState } from 'react';
import YouTube from 'react-youtube';

/* ---------- 타입 ---------- */
interface PitchPoint  { time_sec: number; pitch_hz: number; }
interface CaptionLine { startTime: number; endTime: number; script: string; }

export default function AudioPitchWithCaptionSVG() {
  const svgRef      = useRef<SVGSVGElement>(null);
  const playRef     = useRef<any>(null);

  // 마이크 캡처 refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufRef      = useRef<Float32Array | null>(null);

  // 타이밍 refs
  const startRef    = useRef(0);
  const lastIdxRef  = useRef(-1);
  const rafRef      = useRef(0);

  // 캡션 인덱스
  const curIdxRef   = useRef<number>(-1);

  /* ---------- 데이터 refs ---------- */
  const userPtsRef  = useRef<number[]>([]);

  /* ---------- state ---------- */
  const [defPts,  setDefPts]  = useState<PitchPoint[]>([]);
  const [caps,    setCaps]    = useState<CaptionLine[]>([]);
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
    const rms = Math.sqrt(buf.reduce((s, v) => s + v*v, 0) / N);
    if (rms < 0.01) return -1;
    for (let off = 64; off < N/2; off++) {
      let corr = 0;
      for (let i = 0; i < N-off; i++) corr += buf[i]*buf[i+off];
      if (corr > bestCorr) { bestCorr = corr; best = off; }
    }
    return best > 0 ? sr / best : -1;
  }

  /* ---------- tickAudio (클로저) ---------- */
  const tickAudio = () => {
    const ctx = audioCtxRef.current!;
    const analyser = analyserRef.current!;
    const buf = bufRef.current!;

    const now = ctx.currentTime - startRef.current;

    // 캡션 동기화
    const capIdx = caps.findIndex(c => now >= c.startTime && now <= c.endTime);
    if (capIdx !== curIdxRef.current) {
      curIdxRef.current = capIdx;
      setCurCap(capIdx >= 0 ? caps[capIdx] : null);

      // 새 구간 시작 → 이전 데이터 전부 삭제
      userPtsRef.current = [];
      lastIdxRef.current = -1;
    }

    // 사용자 피치 수집 & 윈도우에 추가
    analyser.getFloatTimeDomainData(buf);
    const p = autoCorrelate(buf, ctx.sampleRate);
    userPtsRef.current.push(p > 0 ? p : 0);
    // 최근 1000프레임만 유지
    if (userPtsRef.current.length > 1000) {
      userPtsRef.current.shift();
    }

    // SVG polyline 업데이트
    const segStart = curCap?.startTime ?? 0;
    const nextStart = caps[curIdxRef.current + 1]?.startTime;
    const segEnd = nextStart ?? curCap?.endTime ?? 1;
    const defSeg = defPts.filter(p => p.time_sec >= segStart && p.time_sec <= segEnd);
    const maxPitch = Math.max(...defSeg.map(p=>p.pitch_hz), ...userPtsRef.current, 1);

    const userLine = svgRef.current!.querySelector<SVGPolylineElement>('.user-line');
    if (userLine) {
      const pts = buildLine(userPtsRef.current, true, segStart, segEnd, maxPitch);
      userLine.setAttribute('points', pts);
    }

    rafRef.current = requestAnimationFrame(tickAudio);
  };

  /* ---------- 시작/재시작 ---------- */
  const startAll = async () => {
    playRef.current?.playVideo?.();

    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
        rafRef.current = requestAnimationFrame(tickAudio);
      }
      return;
    }

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
    bufRef.current      = buf;
    startRef.current    = ctx.currentTime;
    userPtsRef.current  = [];

    rafRef.current = requestAnimationFrame(tickAudio);
  };

  /* ---------- 중지 = 일시정지 ---------- */
  const stopAll = async () => {
    playRef.current?.pauseVideo?.();
    if (!audioCtxRef.current) return;
    cancelAnimationFrame(rafRef.current);
    await audioCtxRef.current.suspend();
  };

  /* ---------- YouTube 준비 ---------- */
  const onPlayerReady = (e: any) => {
    playRef.current = e.target;
  };

  /* ---------- polyline 생성 함수 ---------- */
  function buildLine(
    src: (PitchPoint|number)[],
    isUser: boolean,
    sStart: number,
    sEnd: number,
    maxP: number
  ) {
    const dur = Math.max(sEnd - sStart, 0.01);
    return src.map((v,i) => {
      const pitch = isUser ? (v as number) : (v as PitchPoint).pitch_hz;
      const t = isUser
        ? sStart + i * frameDurRef.current
        : (v as PitchPoint).time_sec;
      const x = ((t - sStart)/dur) * W;
      const y = H - Math.min(pitch/maxP,1) * H;
      return `${x},${y}`;
    }).join(' ');
  }

  /* ---------- 렌더링 ---------- */
  return (
    <div style={{ padding:'2rem', textAlign:'center', color:'#fff' }}>
      <h2>🎙️ 대사·침묵 구간별 실시간 피치</h2>
      <YouTube
        videoId={VIDEO_ID}
        onReady={onPlayerReady}
        opts={{ playerVars:{ playsinline:1, controls:1 } }}
      />
      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={{
          width:'100%', maxWidth:W,
          background:'#111', border:'1px solid #444', borderRadius:4
        }}
      >
        {/* 기준 피치 (파랑) */}
        {defPts.length > 1 && curCap && (
          <polyline
            points={buildLine(
              defPts.filter(p => p.time_sec >= curCap.startTime && p.time_sec <= (caps[curIdxRef.current+1]?.startTime ?? curCap.endTime)),
              false,
              curCap.startTime,
              (caps[curIdxRef.current+1]?.startTime ?? curCap.endTime),
              Math.max(1, ...defPts.map(p=>p.pitch_hz))
            )}
            fill="none"
            stroke="deepskyblue"
            strokeWidth={2}
          />
        )}
        {/* 사용자 피치 (빨강) */}
        <polyline
          className="user-line"
          fill="none"
          stroke="tomato"
          strokeWidth={2}
          points=""
        />
      </svg>
      <div style={{
        marginTop:'1rem', minHeight:'2.2em',
        fontSize:'1.1rem', color:'#0f0'
      }}>
        {curCap?.script ?? ''}
      </div>
      <div style={{ marginTop:'1rem' }}>
        <button onClick={startAll} style={{ marginRight:'1rem' }}>시작</button>
        <button onClick={stopAll}>중지</button>
      </div>
    </div>
  );
}
