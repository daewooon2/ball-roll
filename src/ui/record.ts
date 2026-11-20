// 경주 화면 녹화. canvas만 찍히므로 이름표(DOM)는 영상에 들어가지 않는다.
let recorder: MediaRecorder | undefined;

export function toggleRecording(canvas: HTMLCanvasElement, button: HTMLButtonElement) {
  if (recorder) {
    recorder.stop();
    return;
  }
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(canvas.captureStream(60));
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    recorder = undefined;
    button.classList.remove('on');
    button.textContent = '● 녹화';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
    a.download = `marble-race.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  rec.start();
  recorder = rec;
  button.classList.add('on');
  button.textContent = '■ 녹화 끝';
}
