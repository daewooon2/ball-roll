// 맵 편집기: 코스 JSON을 고쳐 바로 적용해 본다. 저장은 하지 않는다(새로 고치면 원래 맵).
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let apply: (json: unknown) => void = () => {};

$('editor-apply').addEventListener('click', () => {
  const error = $('editor-error');
  try {
    apply(JSON.parse($<HTMLTextAreaElement>('editor-text').value));
    error.textContent = '';
    $<HTMLDialogElement>('editor').close();
  } catch (e) {
    error.textContent = (e as Error).message;
  }
});

/** onApply가 던지면 그 메시지를 보여 주고 창을 닫지 않는다. */
export function openEditor(mapJson: unknown, onApply: (json: unknown) => void) {
  apply = onApply;
  $<HTMLTextAreaElement>('editor-text').value = JSON.stringify(mapJson, null, 1);
  $('editor-error').textContent = '';
  $<HTMLDialogElement>('editor').showModal();
}
