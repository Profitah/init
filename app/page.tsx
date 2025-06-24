'use client';

import { useRef, useEffect, useState } from 'react';
import YouTube from 'react-youtube';

/* ---------- 타입 ---------- */
interface PitchPoint  { time_sec: number; pitch_hz: number; }
interface CaptionLine { startTime: number; endTime: number; script: string; }

export default function AudioPitchWithCaptionSVG() {
  /* ---------- refs ---------- */
  const svgRef        = useRef<SVGSVGElement>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const bufRef        = useRef<Float32Array | null>(null);
  const frameDurRef   = useRef(0);
  const invFrameDur   = useRef(0);
  const startRef      = useRef(0);
  const lastIdxRef    = useRef(-1);
  const rafRef        = useRef(0);
  const curIdxRef     = useRef(-1);              // 현재 캡션 인덱스

  /*---유튜브 변수---- */
  const playRef = useRef<any>(null);
  const VIDEO_ID = '-6bdHjc2gWM';     // shorts URL 의 끝부분

  /* ---------- 상태 ---------- */
  const [defPts,  setDefPts]  = useState<PitchPoint[]>([]);
  const [caps,    setCaps]    = useState<CaptionLine[]>([]);
  const [userPts, setUserPts] = useState<number[]>([]);
  const [curCap,  setCurCap]  = useState<CaptionLine | null>(null);

  /* ---------- SVG 상수 ---------- */
  const W = 800, H = 220;
  const viewBox = `0 0 ${W} ${H}`;

  /* ---------- JSON 로드 ---------- */
  useEffect(() => {
    (async () => {
      try {
        const [pRes, cRes] = await Promise.all([
          fetch('/pitch.json'),
          fetch('/script.json'),          // 파일명 맞추세요
        ]);
        if (!pRes.ok || !cRes.ok) throw new Error('파일 로드 실패');
        setDefPts(await pRes.json());
        setCaps(await cRes.json());
      } catch (e) { console.error(e); }
    })();
  }, []);

  /* ---------- 프레임 길이 계산 ---------- */
  useEffect(() => {
    if (defPts.length > 1) {
      const d = defPts[1].time_sec - defPts[0].time_sec;
      frameDurRef.current = d;
      invFrameDur.current = 1 / d;
    }
  }, [defPts]);

  /* ---------- 오토코릴레이션 ---------- */
  function autoCorrelate(buf: Float32Array, sr: number) {
    const N = buf.length;
    let best = -1, bestCorr = 0;
    const rms = Math.sqrt(buf.reduce((s,v)=>s+v*v,0)/N);
    if (rms < 0.01) return -1;
    for (let off = 64; off < N/2; off++) {
      let corr = 0;
      for (let i = 0; i < N - off; i++) corr += buf[i]*buf[i+off];
      if (corr > bestCorr) { bestCorr = corr; best = off; }
    }
    return best > 0 ? sr / best : -1;
  }

  /* ---------- 오디오 시작 ---------- */
  const start = async () => {
    /* 0) 유튜브 플레이 ON */
    if(playRef.current && playRef.current.playVideo){
      if (playRef.current.getPlayerState?.() !== 1) playRef.current.playVideo();
    }
    /* 1) 마이크 피치 분석 이미 켜져 있으면 종료 */
    if (audioCtxRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 80;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.2;

    const buf = new Float32Array(analyser.fftSize);
    ctx.createMediaStreamSource(stream).connect(filter).connect(analyser);

    /* 초기화 */
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    bufRef.current      = buf;
    // startRef.current    = ctx.currentTime;//
    lastIdxRef.current  = -1;
    curIdxRef.current   = -1;
    setUserPts([]);
    setCurCap(null);

    /* 루프 */
    const tick = () => {
      if (!analyserRef.current) return;
      const now = ctx.currentTime - startRef.current;

      /* 캡션 인덱스 계산 */
      const curIdx = caps.findIndex(c => now >= c.startTime && now <= c.endTime);
      if (curIdx !== curIdxRef.current) {
        curIdxRef.current = curIdx;
        setCurCap(curIdx >= 0 ? caps[curIdx] : null);
        setUserPts([]);                     // 새 구간에 맞춰 사용자 피치 리셋
      }

      /* 프레임 처리 (침묵 구간도 계속 수집) */
      const idx = Math.floor(now * invFrameDur.current);
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

  /* ---------- 오디오 중지 ---------- */
  const stop = () => {
    /* 0) 유튜브 플레이어 멈춤 ------------------------------------------- */
    if (playRef.current && playRef.current.pauseVideo) {
      playRef.current.pauseVideo();
    }
    if (!audioCtxRef.current) return;
    cancelAnimationFrame(rafRef.current);
    audioCtxRef.current.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  /* ---------- 현재 구간(대사+침묵) 범위 ---------- */
  const segStart = curCap?.startTime ?? 0;
  const nextStart = caps[curIdxRef.current + 1]?.startTime;
  const segEnd = nextStart ?? curCap?.endTime ?? 1;  // 다음 대사 시작까지 포함

  /* ---------- 데이터 필터링 ---------- */
  const defSeg = defPts.filter(p => p.time_sec >= segStart && p.time_sec <= segEnd);
  const maxPitch = Math.max(...defSeg.map(p=>p.pitch_hz), ...userPts, 1);

  /* ---------- polyline 생성 ---------- */
  function buildLine(
    src: (PitchPoint|number)[], isUser:boolean,
    sStart:number, sEnd:number, maxP:number
  ){
    const dur = Math.max(sEnd - sStart, 0.01);
    const pts:string[] = [];

    src.forEach((v,i)=>{
      const pitch = isUser ? (v as number) : (v as PitchPoint).pitch_hz;
      const t = isUser ? sStart + i*frameDurRef.current
                       : (v as PitchPoint).time_sec;
      if (t < sStart || t > sEnd) return;
      const x = ((t - sStart)/dur)*W;
      const y = H - Math.min(pitch/maxP,1)*H;
      pts.push(`${x},${y}`);
    });

    /* 🔹 침묵 구간을 평평하게 이어주기 */
    if (pts.length){
      const lastY = pts[pts.length-1].split(',')[1];
      pts.push(`${W},${lastY}`);
    }
    return pts.join(' ');
  }
  /*---------유튜브 영상---------*/
  const onPlayerReady = (event: any) => {
    playRef.current = event.target;
    event.target.playVideo();
  }
  useEffect(() => {
    const tick = () => {
      if (playRef.current && playRef.current.getCurrentTime) {
        const now = playRef.current.getCurrentTime();   // 영상 재생 시간(초)
  
        /* 1) 현재 캡션 라인 계산 ---------------------------------------- */
        const idx = caps.findIndex(c => now >= c.startTime && now <= c.endTime);
        if (idx !== curIdxRef.current) {
          curIdxRef.current = idx;
          setCurCap(idx >= 0 ? caps[idx] : null);
          setUserPts([]);                     // 새 구간이면 사용자 피치 초기화
        }
  
        /* 2) 사용자 마이크 피치 측정 ------------------------------------- */
        if (analyserRef.current) {
          // frameDur 기준으로 사용자 데이터 추가
          const frameIdx = Math.floor(now * invFrameDur.current);
          if (frameIdx > lastIdxRef.current) {
            analyserRef.current.getFloatTimeDomainData(bufRef.current!);
            const p = autoCorrelate(bufRef.current!, audioCtxRef.current!.sampleRate);
            setUserPts(prev => [...prev, p > 0 ? p : 0]);
            lastIdxRef.current = frameIdx;
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [caps]);
  /* ---------- 렌더 ---------- */
  return (
    <div style={{padding:'2rem',textAlign:'center',color:'#fff'}}>
      <h2>🎙️ 대사·침묵 구간별 실시간 피치</h2>
      <YouTube 
        videoId={VIDEO_ID}
        onReady={onPlayerReady}
        opts={{
          playerVars: {
            playsinline: 1,
            controls: 1,
          }
        }}
      />
      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={{
          width:'100%',maxWidth:W,
          background:'#111',border:'1px solid #444',borderRadius:4
        }}
      >
        {/* 기준 (파랑) */}
        {defSeg.length>1 && (
          <polyline
            points={buildLine(defSeg,false,segStart,segEnd,maxPitch)}
            fill="none" stroke="deepskyblue" strokeWidth={2}/>
        )}

        {/* 사용자 (빨강) */}
        {userPts.length>0 && (
          <polyline
            points={buildLine(userPts,true,segStart,segEnd,maxPitch)}
            fill="none" stroke="tomato" strokeWidth={2}/>
        )}
      </svg>

      {/* 자막 */}
      <div style={{
        marginTop:'1rem',minHeight:'2.2em',
        fontSize:'1.1rem',color:'#0f0'
      }}>
        {curCap?.script ?? ''}
      </div>

      {/* 범례 & 버튼 */}
      <div style={{marginTop:'0.5rem',fontSize:'0.9rem'}}>
        <span style={{color:'deepskyblue'}}>■ 기준 피치</span>
        <span style={{marginLeft:'1rem',color:'tomato'}}>■ 사용자 피치</span>
      </div>

      <div style={{marginTop:'1rem'}}>
        <button onClick={start} style={{marginRight:'1rem'}}>시작</button>
        <button onClick={stop}>중지</button>
        <button
          style={{marginLeft:'1rem'}}
          onClick={()=>{
            if(!svgRef.current) return;
            const xml = new XMLSerializer().serializeToString(svgRef.current);
            const blob = new Blob([xml],{type:'image/svg+xml'});
            const url  = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href=url; a.download='pitch.svg'; a.click();
            URL.revokeObjectURL(url);
          }}>
          SVG 다운로드
        </button>
      </div>
    </div>
  );
}