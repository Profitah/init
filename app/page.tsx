'use client';

import { useRef, useState, useEffect } from 'react';

export default function AudioPitchHistory() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Float32Array | null>(null);
  const animRef = useRef<number | null>(null);
  const [streaming, setStreaming] = useState(false);

  // 과거 피치 기록 (픽셀 단위)
  const pitchHistoryRef = useRef<number[]>([]);

  // 간단한 auto-correlation 기반 피치 검출
  function autoCorrelate(buffer: Float32Array, sampleRate: number): number {
    const SIZE = buffer.length;
    let bestOffset = -1;
    let bestCorr = 0;
    const rms = Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / SIZE);
    if (rms < 0.01) return -1; // 소음 레벨 이하

    for (let offset = 64; offset < SIZE / 2; offset++) {
      let corr = 0;
      for (let i = 0; i < SIZE - offset; i++) {
        corr += buffer[i] * buffer[i + offset];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestOffset = offset;
      }
    }
    if (bestOffset === -1) return -1;
    return sampleRate / bestOffset;
  }

  const handleStart = async () => {
    if (streaming) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    // 고역 필터로 저주파 잡음 제거
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 80;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;                       // 해상도 증가
    analyser.smoothingTimeConstant = 0.8;          // 데이터 부드럽게

    const bufferLen = analyser.fftSize;
    dataRef.current = new Float32Array(bufferLen);

    const src = ctx.createMediaStreamSource(stream);
    src.connect(filter).connect(analyser);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    setStreaming(true);
    draw();
  };

  const handleStop = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    pitchHistoryRef.current = [];
    setStreaming(false);
  };

  const draw = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const analyser = analyserRef.current!;
    const data = dataRef.current!;

    const w = canvas.width;
    const h = canvas.height;

    // 시간영역 데이터 가져와서 피치 검출
    analyser.getFloatTimeDomainData(data);
    const pitch = autoCorrelate(data, audioCtxRef.current!.sampleRate);
    const hist = pitchHistoryRef.current;
    hist.push(pitch > 0 ? pitch : 0);
    if (hist.length > w) hist.shift();

    // 캔버스 클리어
    ctx.clearRect(0, 0, w, h);

    // 피치 히스토리 그리기
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'red';
    ctx.beginPath();
    hist.forEach((val, i) => {
      // 50Hz~1000Hz 범위 맵핑
      const y = h - Math.min(Math.max((val - 50) / 950, 0), 1) * h;
      if (i === 0) ctx.moveTo(i, y);
      else         ctx.lineTo(i, y);
    });
    ctx.stroke();

    animRef.current = requestAnimationFrame(draw);
  };

  // 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <h1>🎙️ 실시간 피치 히스토리 </h1>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        style={{
          border: '1px solid #ccc',
          borderRadius: 4,
          display: 'block',
          margin: '1rem auto'
        }}
      />
      <button
        onClick={handleStart}
        disabled={streaming}
        style={{ marginRight: '1rem' }}
      >
        시작
      </button>
      <button onClick={handleStop} disabled={!streaming}>
        중지
      </button>
    </div>
  );
}
