/* 에이전트 스크립트 예시 — illy run examples/buttons.js -o buttons.svg
   상태 확인 → 선택자로 대상 특정 → 원자적 배치 의 기본 흐름 */

illy.newDocument({ width: 320, height: 200, name: '버튼 세트' });

illy.transaction('버튼 3개', a => {
  [['확인', '#2563eb'], ['취소', '#64748b'], ['삭제', '#dc2626']].forEach(([label, color], i) => {
    const y = 20 + i * 56;
    a.addRect({ x: 20, y, width: 280, height: 44, radius: 10, fill: color, name: 'btn-' + label });
    a.addText({ x: 160, y: y + 29, text: label, size: 17, weight: 700, align: 'center', fill: '#ffffff' });
  });
});

/* 선택자로 대상을 특정한다 — 좌표를 추측하지 않는다 */
const danger = illy.find({ name: '/^btn-삭제/' });
illy.set(danger, { strokeWidth: 2, stroke: '#7f1d1d' });

console.error(illy.describe());
