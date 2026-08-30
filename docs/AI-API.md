# Illymolly 자동화 API

사람이 GUI 로 쓰는 것과 **같은 문서**를 코드로 조종하기 위한 계층입니다.
브라우저에서는 `window.illy`, Node 에서는 `require('illymolly')` 로 접근하며
두 환경의 API 는 동일합니다.

```
사람 ──▶ GUI(도구·패널·단축키) ─┐
                                ├─▶ 같은 문서 · 같은 실행 취소 스택
AI  ──▶ illy API / RPC / CLI ───┘
```

---

## 1. 시작하기

### 브라우저 (GUI 와 함께)

```js
// 개발자 도구 · 확장 · Playwright page.evaluate 어디서든
illy.addRect({ x: 20, y: 20, width: 200, height: 120, fill: '#ff3366' });
illy.addText({ x: 30, y: 180, text: '안녕', size: 32 });
console.log(illy.describe());
```

캔버스가 즉시 갱신되고, 패널·레이어·선택 상태도 함께 반영됩니다.
사용자는 `Ctrl+Z` 로 API 가 한 작업을 되돌릴 수 있습니다.

### Node (헤드리스 · 브라우저 불필요)

```js
const { createDocument } = require('illymolly');
const illy = createDocument({ width: 400, height: 300, name: '카드' });
illy.addRect({ x: 0, y: 0, width: 400, height: 300, fill: '#1e3a8a' });
illy.addText({ x: 24, y: 160, text: 'Illymolly', size: 40, fill: '#fff' });
require('fs').writeFileSync('out.svg', illy.toSVG());
```

### CLI

```bash
illy run script.js -o out.svg     # 스크립트 실행 후 저장
illy render doc.illy.json -o o.svg
illy info doc.illy.json           # 사람이 읽는 구조 요약
illy ops --json                   # LLM 함수 정의로 쓸 매니페스트
```

### 원격 제어 (iframe RPC)

```js
const f = document.getElementById('illymolly').contentWindow;
f.postMessage({ illy: 1, id: 'r1', op: 'addRect',
                args: { x: 0, y: 0, width: 100, height: 100, fill: 'red' } }, '*');

window.addEventListener('message', e => {
  if (e.data?.illy === 1 && e.data.id === 'r1') console.log(e.data.response);
  // → { ok: true, result: 'path-3' }
});
```

특수 op: `__ping`(연결 확인) · `__ops`(매니페스트) · `__batch`(원자적 배치).

---

## 2. 에이전트를 위한 설계 결정

| 결정 | 이유 |
|---|---|
| **모든 값이 JSON 직렬화 가능** | 라이브 객체를 노출하지 않으므로 RPC·postMessage·원격 호출을 그대로 통과합니다. |
| **결정적 id** (`path-3`, `text-4`) | 같은 스크립트는 항상 같은 id 를 만듭니다. 결과 비교·회귀 테스트·재현이 가능합니다. |
| **선언형 op 테이블 하나** | 호출 가능한 메서드와 `illy.ops()` 매니페스트가 같은 정의에서 생성됩니다. 문서와 구현이 어긋날 수 없습니다. |
| **`undoable` 강제 선언** | 연산을 추가할 때 실행 취소 대상인지 반드시 표시해야 하며, 빠뜨리면 로드 시점에 즉시 실패합니다. 조회 연산이 실행 취소 스택을 오염시키는 사고를 구조적으로 막습니다. |
| **원자적 `batch()`** | 여러 연산 중 하나라도 실패하면 전부 롤백하고 실패 지점을 알려 줍니다. 절반만 적용된 문서가 생기지 않습니다. |
| **모르는 인자를 조용히 무시하지 않음** | `colour` 같은 오타는 즉시 오류가 되고, 사용 가능한 인자 목록을 함께 알려 줍니다. |
| **`describe()`** | 픽셀을 볼 수 없는 에이전트가 문서 상태를 텍스트로 파악합니다. |

---

## 3. 선택자

대상을 지정하는 모든 자리에 쓰입니다. 생략하면 **현재 선택**이 대상입니다.

```js
illy.find('*')                          // 전체
illy.find('로고')                        // 이름이 '로고'
illy.find('path-7')                     // id
illy.find(['path-7', 'text-9'])          // id 배열
illy.find({ type: 'text' })              // 타입
illy.find({ name: '/^btn-/' })           // 정규식
illy.find({ fill: '#ff0000' })           // 칠 색 ('red' 같은 이름도 가능)
illy.find({ layer: '아트워크' })          // 레이어
illy.find({ shape: 'rect' })             // 라이브 셰이프 종류
illy.find({ text: '구매' })              // 텍스트 내용 포함
illy.find({ at: { x: 120, y: 80 } })      // 해당 좌표를 포함하는 오브젝트
illy.find({ within: { x:0, y:0, w:200, h:200 } })
illy.find({ intersects: { x:0, y:0, w:200, h:200 } })
illy.find({ selected: true })
illy.find({ type: 'path', layer: '배경', limit: 5 })   // 조건은 AND
```

### 인자 축약

```js
illy.get('로고')                  // 문자열 선택자
illy.set('로고', { fill: 'red' }) // (선택자, 인자)
illy.set({ fill: 'red' })         // 선택자 생략 = 현재 선택
illy.rotate({ angle: 90 })        // 선택자 없는 인자 객체
```

판정 규칙은 단순합니다 — 넘긴 객체의 키 중 **실제 파라미터 이름이 하나도 없으면**
그 객체 전체를 선택자로 봅니다. 모호한 경우가 없습니다.

---

## 4. 연산 목록

`illy.help()` 로 그룹별 목록, `illy.help('addRect')` 로 상세를 볼 수 있습니다.
`illy.ops()` 는 LLM 함수 정의로 바로 넘길 수 있는 JSON 스키마를 반환합니다.

| 그룹 | 연산 |
|---|---|
| 문서 | `newDocument` `documentInfo` `setDocument` |
| 생성 | `addRect` `addEllipse` `addPolygon` `addStar` `addLine` `addPath` `addText` `addImage` |
| 조회 | `find` `get` `snapshot` `describe` |
| 선택 | `select` `deselect` `selection` |
| 수정 | `set` `remove` `duplicate` `arrange` `group` `ungroup` |
| 변형 | `move` `setBounds` `rotate` `scale` `reflect` |
| 정렬 | `align` `distribute` |
| 패스 | `pathfinder` `clipMask` |
| 레이어 | `addLayer` `setLayer` |
| 대지 | `addArtboard` `gotoArtboard` |
| 히스토리 | `undo` `redo` `history` |
| 출력 | `toSVG` `toJSON` `loadJSON` `toPNG` |
| GUI | `setTool` `zoom` *(브라우저 전용)* |

### 색상 표기

```js
'#ff0000'  '#f00'  'red'  'none'
{ r: 255, g: 0, b: 0, a: 0.5 }
{ type: 'linear', stops: [[0, '#fff'], [1, '#000']], angle: 45 }
{ type: 'radial', stops: [[0, '#fff'], [1, '#000']] }
```

### 기준점 (`anchor`)

`0` 좌상 · `1` 상 · `2` 우상 · `3` 좌 · `4` 중앙 · `5` 우 · `6` 좌하 · `7` 하 · `8` 우하

```js
illy.setBounds('로고', { width: 100, anchor: 8 });  // 오른쪽 아래를 고정하고 축소
```

---

## 5. 오류 처리

메서드는 예외를 던지고, `run()` / `batch()` 는 결과 봉투를 돌려줍니다.

```js
illy.run('addRekt', {});
// { ok:false, error:{ code:'NO_OP', message:"알 수 없는 연산: 'addRekt'. 비슷한 것: addRect, addText" } }

illy.run('addRect', { x:0, y:0, width:10, colour:'red' });
// { ok:false, error:{ code:'UNKNOWN_ARG',
//   message:'addRect: 알 수 없는 인자 — colour. 사용 가능: x, y, width, height, radius, fill, …' } }
```

| 코드 | 뜻 |
|---|---|
| `NO_OP` | 없는 연산 (비슷한 이름을 함께 제안) |
| `MISSING_ARG` | 필수 인자 누락 |
| `UNKNOWN_ARG` | 오타 등 모르는 인자 (사용 가능 목록 안내) |
| `BAD_ARG` | 타입/enum 불일치 (허용 값 안내) |
| `BAD_COLOR` | 해석할 수 없는 색상 |
| `NO_TARGET` | 선택자에 맞는 대상이 없음 |
| `NO_LAYER` `NO_TOOL` | 이름으로 찾지 못함 |
| `PF_EMPTY` | 패스파인더 결과가 비어 있음 |
| `NO_CANVAS` | Node 에서 `toPNG` 호출 (→ `toSVG` 사용) |
| `GUI_ONLY` | 헤드리스에서 GUI 전용 연산 호출 |

**실패한 연산은 문서를 전혀 건드리지 않습니다.**

---

## 6. 원자적 배치

```js
const r = illy.batch([
  { op: 'addRect',  args: { x: 0, y: 0, width: 100, height: 100, fill: '#eee' } },
  { op: 'addText',  args: { x: 10, y: 60, text: '버튼', size: 20 } },
  { op: 'group',    args: { query: '*', name: '버튼' } }
], '버튼 만들기');

// 성공: { ok:true, results:[ 'path-3', 'text-4', 'group-5' ] }
// 실패: { ok:false, failedAt:2, failedOp:'group',
//         error:{...}, rolledBack:true }   ← 문서는 시작 상태 그대로
```

전체가 **실행 취소 한 단계**로 묶이므로, 사용자는 `Ctrl+Z` 한 번으로
에이전트가 만든 결과를 통째로 되돌릴 수 있습니다. `transaction()` 도 같습니다.

```js
illy.transaction('격자 생성', a => {
  for (let i = 0; i < 5; i++) a.addRect({ x: i * 60, y: 0, width: 50, height: 50 });
});
```

---

## 7. 상태 파악

```js
illy.describe()
```
```
문서 "카드" · 대지 1개 · 활성 대지 300×200pt · 레이어 2개
[배경]
    path-5  사각형  x0 y0 w300 h200  칠 #1e3a8a→#7c3aed(선형)
[타이포]
  ▶ text-7  텍스트  x24 y82.8 w159 h35.7  칠 #ffffff  "Illymolly"
선택: text-7
```

`▶` 는 선택된 항목입니다. 더 정밀한 정보는 `snapshot()`(전체 구조) 또는
`get(선택자)`(개별 오브젝트)를 쓰고, 시각 확인이 필요하면 브라우저에서
`toPNG()` 로 이미지를 받아 봅니다.

---

## 8. 에이전트 작업 흐름 권장안

1. `describe()` 로 현재 상태를 읽는다.
2. `find()` 로 대상을 특정한다 — 좌표를 추측하지 말고 선택자로 지정한다.
3. 여러 변경은 `batch()` 로 묶는다 — 실패해도 절반만 적용되지 않고,
   사용자가 `Ctrl+Z` 한 번으로 되돌릴 수 있다.
4. `get()` 이나 `describe()` 로 결과를 확인한다.
5. 시각적 판단이 필요하면 `toPNG()` 로 확인한다 (브라우저).

```js
// 예: 빨간 도형을 모두 찾아 파랗게 바꾸고 가로 정렬
const ids = illy.find({ fill: 'red' });
if (ids.length) {
  illy.batch([
    { op: 'set',   args: { query: ids, fill: '#0066ff' } },
    { op: 'align', args: { query: ids, mode: 'hcenter' } }
  ], '빨강 → 파랑 정렬');
}
```

---

## 9. 한계

- `toPNG` · `setTool` · `zoom` 은 브라우저 전용입니다 (`NO_CANVAS` / `GUI_ONLY`).
- Node 에는 캔버스가 없어 **텍스트 바운딩이 근사치**입니다
  (전각 1.0em · 그 외 0.52em). 정확한 계측이 필요하면 브라우저에서 실행하세요.
- postMessage 브리지는 기본적으로 모든 오리진을 허용합니다.
  제한하려면 `AI.bridge.setAllowedOrigins(['https://내호스트'])` 를 호출하세요.
- 패스 편집(개별 앵커 조작)은 아직 API 로 노출되지 않았습니다.
  `addPath({ d })` 로 전체를 다시 그리는 방식을 쓰세요.
