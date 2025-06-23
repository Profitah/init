/* 128-프레임 버퍼의 RMS를 구해 ‘발화(1)/무음(0)’ 값을 메인 스레드로 보냄 */
class MicProcessor extends AudioWorkletProcessor {
  static RMS_THRESHOLD = 0.02;

  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      this.port.postMessage(rms > MicProcessor.RMS_THRESHOLD ? 1 : 0);
    }
    return true; // 계속 동작
  }
}
registerProcessor('mic-processor', MicProcessor);