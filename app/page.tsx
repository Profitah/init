'use client';

import { useState, useRef } from 'react';

export default function VoiceCounter() {
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const speakingRef = useRef(false);

  async function handleStart() {
    if (ctxRef.current) return;            // 이미 실행 중
    setError(null);

    /* 1) 지원 여부 확인 */
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        '이 브라우저(또는 HTTP 프로토콜)에서는 마이크를 사용할 수 없습니다.\n' +
        'HTTPS 로 접속하거나 최신 브라우저를 사용하세요.',
      );
      return;
    }

    try {
      /* 2) 권한 요청 */
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      /* 3) 오디오 컨텍스트 + Worklet 구성 */
      const ctx = new AudioContext({ sampleRate: 48_000 });
      if (ctx.state === 'suspended') await ctx.resume(); // Safari 대비

      /* public/ 아래 정적 파일은 /mic-processor.js 로 접근 */
      await ctx.audioWorklet.addModule('/mic-processor.js');

      const source = ctx.createMediaStreamSource(stream);
      const node   = new AudioWorkletNode(ctx, 'mic-processor');

      node.port.onmessage = (e) => {
        const spoke = Boolean(e.data);      // 1 = 발화 감지
        if (spoke && !speakingRef.current) {
          setCount((c) => c + 1);           // 무음 → 발화 시 카운트++
          speakingRef.current = true;
        }
        if (!spoke && speakingRef.current) {
          speakingRef.current = false;      // 발화 끝
        }
      };

      source.connect(node).connect(ctx.destination);

      ctxRef.current  = ctx;
      nodeRef.current = node;
    } catch (err: any) {
      console.error(err);
      setError(
        err.name === 'NotAllowedError'
          ? '마이크 접근이 차단되었습니다. 브라우저 권한을 허용해 주세요.'
          : `마이크 오류: ${err.message || '알 수 없음'}`,
      );
    }
  }

  function handleStop() {
    nodeRef.current?.disconnect();
    ctxRef.current?.close();
    nodeRef.current = null;
    ctxRef.current  = null;
    speakingRef.current = false;
  }

  return (
    <main style={{ padding: '2rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
        🗣️ 말한 횟수: {count}
      </h1>

      <button
        onClick={handleStart}
        disabled={!!ctxRef.current}
        style={{ padding: '0.5rem 1.5rem', marginRight: '1rem' }}
      >
        마이크 시작
      </button>

      <button
        onClick={handleStop}
        disabled={!ctxRef.current}
        style={{ padding: '0.5rem 1.5rem' }}
      >
        중지
      </button>

      {error && (
        <p style={{ color: 'red', marginTop: '1rem', whiteSpace: 'pre-line' }}>
          {error}
        </p>
      )}
    </main>
  );
}
