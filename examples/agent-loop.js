/* 에이전트가 문서를 "보고" 고치는 흐름 예시
   illy run examples/agent-loop.js -o fixed.svg */

illy.newDocument({ width: 400, height: 300 });
illy.addRect({ x: 10, y: 10, width: 80, height: 80, fill: 'red' });
illy.addRect({ x: 120, y: 40, width: 80, height: 80, fill: 'red' });
illy.addRect({ x: 230, y: 70, width: 80, height: 80, fill: '#0066ff' });

/* 1. 현재 상태를 읽는다 */
console.error(illy.describe());

/* 2. 조건에 맞는 대상만 고른다 */
const reds = illy.find({ fill: 'red' });
console.error('빨간 도형:', reds);

/* 3. 여러 변경을 하나의 원자적 단위로 — 실패하면 전부 롤백된다 */
const r = illy.batch([
  { op: 'set', args: { query: reds, fill: '#0066ff' } },
  { op: 'align', args: { query: '*', mode: 'vcenter' } },
  { op: 'distribute', args: { query: '*', axis: 'h' } }
], '빨강 통일 후 정렬');

if (!r.ok) console.error('실패:', r.failedOp, r.error.message);

/* 4. 결과를 확인한다 */
console.error(illy.describe());
