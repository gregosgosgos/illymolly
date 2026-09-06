# 내장 글꼴

PDF · AI 로 내보낼 때 글자를 **윤곽선이 아니라 진짜 글꼴로** 심기 위해 둔 파일입니다.
심어야 일러스트레이터에서 여전히 편집 가능한 텍스트로 열리고, 글자 모양도 원본 그대로입니다.

| 파일 | 내용 |
|---|---|
| `NotoSansKR-Regular.woff` · `-Bold.woff` | 한글 + ASCII (Noto Sans KR 한국어 서브셋) |
| `NotoSansKR-Latin-Regular.woff` · `-Bold.woff` | 라틴 · 라틴 확장 · 문장부호 |

- 글꼴: **Noto Sans KR** (Google) — [SIL Open Font License 1.1](OFL.txt).
  상업적 사용 · 임베딩 · 재배포 모두 허용됩니다.
- `.woff` 는 표 하나하나가 zlib 으로 눌린 SFNT 라, 이미 있는 inflate(`src/pdfin.js`)로
  풀어 그대로 TrueType 으로 씁니다. 별도 라이브러리가 필요 없습니다.
- 내보낼 때는 **문서에 실제로 쓰인 글자만 골라 서브셋**해서 심습니다.
  상세페이지 한 장이면 보통 30~80KB 정도만 붙습니다.
- 문서에 한글이 없으면 아예 받아 오지 않습니다.
