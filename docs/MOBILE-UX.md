# 모바일 UI 설계

데스크톱 UI 를 줄인 것이 아니라, 터치와 한 손 조작을 전제로 다시 설계했습니다.
아래 표의 근거 문헌·표준에서 수치를 가져왔고, 각 항목은 `test/mobile.mjs` 에서
실제로 측정·검증합니다.

---

## 1. 근거 → 설계

| 근거 | 발견 / 기준 | 이 앱의 반영 |
|---|---|---|
| Parhi, Karlson & Bederson, *Target size study for one-handed thumb use on small touchscreen devices* (MobileHCI 2006) | 한 손 엄지 이산 탭 **9.2mm**, 연속 탭 7.6mm 이상이면 성능·선호도 저하 없음 (9.2mm ≈ **35 CSS px**) | 모든 터치 타깃 **44px 이상**, 주 컨트롤 48px — 연구 최소치를 25% 이상 상회 |
| Apple HIG **44pt** · Material Design **48dp** | 플랫폼 권장 최소 | 앱바 버튼 48px, 독 슬롯 폭 ≥ 44px, 시트 컨트롤 높이 44px |
| WCAG 2.2 **SC 2.5.8 Target Size (Minimum)** (AA) | 24×24 CSS px — *바닥값이지 목표가 아님* | 전 컨트롤이 이를 크게 상회. 컨텍스트 칩만 높이 36px + 간격 6px |
| Hoober, *How Do Users Really Hold Mobile Devices?* (2013, n=1,333) | **49%** 한 손, 36% 크래들, 15% 양손 → 엄지 도달 범위가 핵심 | 도구 독·컨텍스트 바를 **화면 하단**에 배치. 파괴적 동작(삭제)은 스크롤 끝으로. **왼손잡이 전환** 제공 |
| Kurtenbach & Buxton, *The limits of expert performance using hierarchic marking menus* (CHI '93) / *User learning and performance with marking menus* (CHI '94) | 방사형 마킹 메뉴는 초보(메뉴 보고 선택)→숙련자(방향만으로 선택) 전환을 **같은 동작**으로 지원 | 독 슬롯 **길게 누르기 → 방사형 메뉴**. 메뉴가 뜨기 전에 방향으로 그으면 바로 선택 |
| Vogel & Baudisch, *Shift: a technique for operating pen-based interfaces using touch* (CHI 2007) | 손가락에 가려진 영역을 **가려지지 않는 위치에 확대 복제**하고 실제 선택점을 표시 → 작은 타깃 오류율 급감 | 정밀 도구(선택·직접선택·펜·가위·그레이디언트 등) 드래그 중 **루페** 표시. 손가락 위쪽에 2배 확대 + 십자선 |
| Holz & Baudisch, *Understanding touch* (CHI 2011) | 사용자가 인지하는 입력점과 접촉 중심이 다름 → 접촉면 크기만큼 오차 | 터치 기기에서 히트 허용 범위를 **4px → 11px** 로 확대 (그려지는 크기는 그대로) |
| Guiard, *Asymmetric division of labor in human skilled bimanual action* (1987) | 비우세손이 기준 프레임을 잡고 우세손이 세부 작업 | **두 손가락 = 캔버스 조작**(이동·확대)을 도구와 무관하게 항상 유지. 도구 전환 없이 화면을 잡고 그릴 수 있음 |
| Procreate 관례 (널리 학습된 제스처) | 2손가락 탭 = 실행 취소, 3손가락 탭 = 다시 실행 | 그대로 채택 — 새 규칙을 만들지 않음 |

---

## 2. 화면 구조

```
┌──────────────────────────────┐
│ ☰   무제-1        ⤺  ⤻   ⋯  │  앱바 48px  (메뉴 · 제목 · 취소/재실행 · 패널)
├──────────────────────────────┤
│                        [83%] │  줌 배지 = 탭하면 대지에 맞춤
│                              │
│           캔 버 스            │  전체 영역 · 두 손가락으로 이동/확대
│                    ◉ 루페     │  정밀 드래그 중에만
│                              │
├──────────────────────────────┤
│ 칠 획 변형 효과 │ ◀ ▶ ▲ ▼ 그룹 … │  선택 컨텍스트 바 46px (선택 시에만, 가로 스크롤)
├──────────────────────────────┤
│  ▲                           │
│ 선택  펜  도형  문자 브러시 도구 ⬜ │  도구 독 60px + 안전영역
└──────────────────────────────┘
```

**엄지 영역 우선순위** — 자주 쓰는 것일수록 아래에 둡니다.
도구 전환·선택 편집(하단) > 실행 취소·패널(상단) > 메뉴(좌상단, 가장 드묾).

---

## 3. 제스처

| 조작 | 동작 |
|---|---|
| 한 손가락 드래그 | 현재 도구 |
| **두 손가락** 드래그 / 벌리기 | 캔버스 이동 · 확대 (도구와 무관, 항상) |
| **두 손가락 탭** | 실행 취소 |
| **세 손가락 탭** | 다시 실행 |
| 도구 슬롯 **길게 누르기** | 방사형 마킹 메뉴 |
| 도구 슬롯에서 **바로 긋기** | 메뉴 없이 방향으로 선택 (숙련자) |
| 시트 손잡이 **아래로 끌기** | 시트 닫기 |
| 그리는 도중 **두 번째 손가락** | 그리던 것만 취소하고 캔버스 조작으로 전환 |

마지막 항목은 구현이 미묘합니다. 단순히 `undo` 를 부르면 **직전의 다른 작업까지
지워집니다.** 드래그 시작 시점의 문서 스냅샷과 실행 취소 스택 깊이를 함께 기록해
두고, 그 지점으로 정확히 되돌립니다 (`app.cancelDrag(true)`).

---

## 4. 패널 재사용

모바일 패널을 새로 만들지 않았습니다. 바텀 시트를 열면 **데스크톱 패널의
DOM 노드를 그대로 시트로 옮기고**, 닫을 때 원래 자리로 되돌립니다.

```js
openPanel('color', '색상')   // .panel[data-panel=color] > .body 를 시트로 이동
closeSheet()                 // 원래 섹션으로 복귀
```

색상 피커·그레이디언트 정지점·레이어 트리의 모든 배선이 이미 되어 있으므로
중복 코드가 없고, 데스크톱에서 고친 버그가 모바일에도 그대로 반영됩니다.
크기만 CSS 로 키웁니다 (`#m-sheet-body .fld { height: 44px }`).

나중에 추가한 **효과 (모양)** 패널과 **대지** 패널도 이 규칙 덕분에
모바일 코드를 한 줄도 쓰지 않고 `패널 · 보기` 시트 목록에 그대로 올라왔습니다.
선택 컨텍스트 바에는 `효과` 칩이, 이미지를 선택했을 때는 `이미지 추적` · `자르기` 칩이
상황에 맞게 나타납니다 — 대화상자는 데스크톱과 같은 것을 씁니다.

---

## 5. 반응형 판정

```js
shortSide = min(innerWidth, innerHeight)
phone    : shortSide < 500  또는  width < 700
tablet   : 거친 포인터(pointer: coarse) 이고 width < 1180
desktop  : 그 외
```

가로폭만 보면 **가로 모드 휴대폰(844×390)이 태블릿으로 잡힙니다.**
짧은 변을 함께 보아 이를 막습니다. 태블릿은 왼쪽 도구바를 유지하되
오른쪽 패널 독을 시트로 대체합니다.

---

## 6. 검증 (`npm run test:mobile`)

| 항목 | 방법 |
|---|---|
| 터치 타깃 44px | 실제 렌더된 모든 컨트롤의 `getBoundingClientRect()` 를 측정 |
| 레이아웃 전환 | iPhone 13 / Pixel 5 / iPad / 1440px 데스크톱 · 가로 모드 |
| 가로 스크롤 없음 | 320 · 360 · 390 · 430px 전 폭에서 `scrollWidth` 확인 |
| 제스처 | 실제 `TouchEvent` 를 만들어 1·2·3 손가락 시퀀스 재생 |
| 드래그 취소 | 이전 작업이 보존되는지 이름으로 확인 |
| 마킹 메뉴 | 길게 누르기 → 방향 이동 → 강조 → 도구 전환까지 |
| 시트 재사용 | 패널 DOM 이동 · 시트 안 컨트롤이 문서를 실제로 바꾸는지 · 복귀 |
| 루페 | 드래그 중에만 나타나는지 |
| 데스크톱 무영향 | 1440px 에서 모바일 셸이 숨겨지고 기존 UI 가 그대로인지 |

---

## 7. 남은 한계

- 캔버스 회전(두 손가락 비틀기)은 렌더러가 뷰 회전을 지원하지 않아 미구현입니다.
- 스타일러스 필압·기울기는 사용하지 않습니다 (`PointerEvent.pressure` 미반영).
- 텍스트 입력은 OS 키보드를 그대로 쓰며, 키보드가 올라올 때 캔버스를
  자동으로 밀어 올리지 않습니다.
- 마킹 메뉴 항목이 5개일 때 방향 간격이 약 25° 로 Kurtenbach 의 45° 권고보다
  좁습니다. 좁은 화면의 제약이라, **항목 위에 직접 올리면 방향과 무관하게
  선택**되도록 보완했습니다.

---

## 참고 문헌

- Parhi, P., Karlson, A. K., & Bederson, B. B. (2006). *Target size study for one-handed thumb use on small touchscreen devices.* MobileHCI '06. https://dl.acm.org/doi/10.1145/1152215.1152260
- Hoober, S. (2013). *How Do Users Really Hold Mobile Devices?* UXmatters. https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- Kurtenbach, G., & Buxton, W. (1993). *The limits of expert performance using hierarchic marking menus.* CHI '93. https://www.billbuxton.com/MMExpert.html
- Kurtenbach, G., & Buxton, W. (1994). *User learning and performance with marking menus.* CHI '94. https://dl.acm.org/doi/10.1145/191666.191759
- Vogel, D., & Baudisch, P. (2007). *Shift: a technique for operating pen-based interfaces using touch.* CHI '07. https://www.patrickbaudisch.com/publications/2007-Vogel-CHI07-Shift.pdf
- Holz, C., & Baudisch, P. (2011). *Understanding touch.* CHI '11.
- Guiard, Y. (1987). *Asymmetric division of labor in human skilled bimanual action.* Journal of Motor Behavior, 19(4).
- W3C (2023). *WCAG 2.2 — SC 2.5.8 Target Size (Minimum).* https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Apple. *Human Interface Guidelines — Layout.* / Google. *Material Design — Accessibility.*
- Procreate Handbook. *Gestures.* https://help.procreate.com/procreate/handbook/interface-gestures/gestures
