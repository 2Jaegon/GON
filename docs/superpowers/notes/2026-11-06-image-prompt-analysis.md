# 이미지 프롬프트 102개 분석 — 채팅 이미지 생성용 규칙 정리

- 대상: `C:\Users\aicam\Downloads\이미지_프롬프트\프롬프트` (.txt 102개, 약 270KB). 모든 파일을 끝까지 읽었습니다.
- 목적: 채팅 요청 → 카테고리 판별 → 슬롯 채우기 → 규칙 블록 붙이기 → Codex CLI `image_generation`으로 전송.
- 원칙: 아래 규칙 블록과 템플릿은 **원문을 옮긴 게 아니라 직접 다시 쓴 문장**입니다. 원문 .txt는 저장소에 넣지 않습니다.

---

## 0. 한눈에 보기

| 항목 | 결과 |
|---|---|
| 전체 파일 | 102개 (빈 파일 2, 완전 중복 2쌍, 크레딧만 다른 사실상 중복 1쌍) |
| 이미지 생성에 쓸 수 있음 | 91개 (C1~C13, 그중 단독 실행이 안 되는 조각·라이브러리 5개) |
| 영상 전용·빈 파일 (제외) | 8개 (C14: 영상 6 + 빈 파일 2) |
| 텍스트 분석/메타 (이미지 생성 아님) | 3개 (C15, 전처리 단계로만 활용) |
| 본문 언어 | 영어 위주 약 74개 (한글 헤더·메모 섞인 것 포함), 한국어 위주 약 26개, 빈 파일 2개 |
| 출처/작성자 줄 있음 | 1개 (`옷 입히기.txt`). 단, `의상 교환.txt`는 같은 본문에서 크레딧 줄만 뺀 것 |

---

## 1. 카테고리 분류 (15개)

참조 이미지 표기: **필수 N** = 없으면 못 만듦 / **선택** = 있으면 정체성 유지에 쓰고 없으면 텍스트만으로 생성 / **0** = 필요 없음.
역할: 인물(얼굴·정체성), 의상(옷·소품), 배경(장면), 원본(편집할 사진 자체), 상품, 시트(인물 시트).

### C1. 셀카·일상 스냅 (폰카 감성)
- 파일(17): 카페셀카, 카페셀카2, 차안셀카, 블루베리셀카, 창가플로어포즈, 거울셀카2, 거울셀카3, 빈티지카메라셀카, 어반셀카, KTX창가셀카, 햇살셀카, 공원셀카1, 공원셀카2, 러닝셀카, 침대셀카2, 복도셀카, 야간도로
  (+ 영어 서술형 단일 인물 묘사가 대부분 여기)
- 트리거: "셀카", "거울샷", "카페에서", "기차/KTX 창가", "차 안에서", "공원", "러닝", "침대에서", "복도", "밤거리", "인스타 감성 셀카", "아이폰으로 찍은 것처럼"
- 참조: **선택 1 (인물)**. 한국어 파일들은 대부분 "첨부 얼굴 100% 유지"를 요구하고, 영어 서술형(차안·블루베리·거울2/3 등)은 참조 없이 텍스트만으로 씀. 복도셀카는 참조 1장을 **인물+스타일(구도·조명·렌즈) 기준**으로 동시에 씀.

### C2. 레트로 기기·플래시 스냅 (디카·CCD·흔들림)
- 파일(6): 디카샷 앞모습, 디카샷 옆모습, 거울셀카(Y2K 폰 플래시), 엘리베이터셀카(온카메라 플래시), 야외 포징(야간 플래시 스트리트 10컷), 흔들리는 이펙트(사진을 '실수로 찍힌 셀카'로 변환)
- 트리거: "디카 감성", "똑딱이", "CCD", "Y2K", "플래시 터진", "필름 느낌", "대충 찍힌", "흔들린 사진", "저화질 감성"
- 참조: 디카샷·거울셀카·엘리베이터 **필수 1 (인물: 얼굴+헤어)**, 흔들리는 이펙트 **필수 1 (원본)**, 야외 포징 **0**.

### C3. 장소·여행 화보 / 몽환 블룸
- 파일(2, 각각 장면 13~14개 묶음): 도교 스냅샷(시부야·가챠폰·하코네·우에노·아사쿠사 등 13장면), 인스타감성(창가·해변·숲길 비눗방울·선풍기 등 14장면, 백라이트 블룸 공통)
- 트리거: "도쿄 여행 사진", "여행 화보", "벚꽃 피크닉", "기모노", "몽환적인", "뽀샤시", "역광", "블룸", "햇살 가득"
- 참조: **선택~권장 1 (인물)**. 인스타감성은 `[LEAD_CHARACTER]` 자리 + "참조 이미지 헤어 그대로"라서 사실상 인물 1장을 전제로 함.

### C4. 카메라 앵글·프레이밍
- 파일(11, 일부 C10·C14와 겹침): 아이레벨, 로우앵글, 버드아이뷰, 쓰리쿼터앵글, 오버숄더, 프로필사이드뷰, 클로즈업, 익스트림클로즈업, 하이앵글(빈 파일), 줌인(영상 문구지만 '더 타이트한 크롭' 정지 이미지로 바꿔 쓸 수 있음), 인물 플라스틱 해소의 예시2(참조 기반 익스트림 클로즈업)
- 공통 구조: 흰 스튜디오 + 같은 의상 + 같은 피부 블록, **앵글 문장만 교체**. 앵글 사전으로 쓰기 가장 좋음.
- 트리거: "로우앵글", "아래에서 올려다보게", "위에서 내려다보는", "부감", "탑뷰", "옆모습", "측면", "45도", "어깨 너머", "클로즈업", "얼굴만 꽉 차게", "전신", "눈높이"
- 참조: **선택 1 (인물)**. 사진을 주면 "같은 사람, 앵글만 변경"으로 동작.

### C5. 부분 편집 (표정·포즈·헤어·조명·배경)
- 파일(6): 인물 표정 수정, 인물 포즈 수정, 인물 헤어 스타일 수정, 인물 조명(10가지 인물 조명 사전), 스튜디오샷_배경변경, (흔들리는 이펙트는 C2로 분류)
- 트리거: "웃게 해줘", "표정 바꿔", "포즈 바꿔", "주머니에 손", "머리 스타일 바꿔", "단발로", "앞머리", "조명 바꿔", "렘브란트 조명", "배경만 바꿔", "시부야로 옮겨줘"
- 참조: **필수 1 (원본)**. 바꿀 대상 하나만 바꾸고 나머지는 잠금.

### C6. 의상 합성·교체 (착장)
- 파일(12): 옷 입히기, 의상 교환, 의상 합성(후드 포즈 9종), 의상 합성1(여러 장 합성 + 품질 접미사), 룩북 합성, 시트 활용, 스튜디오샷_베이스 / 상의변경 / 하의변경 / 벨트변경 / 가방추가 / 신발변경
- 트리거: "이 옷 입혀줘", "옷 바꿔", "코디 합성", "룩북", "착장샷", "가방 추가", "신발만 바꿔", "벨트 추가", "아우터 걸쳐줘"
- 참조: **필수 2 (인물 1 + 의상 1)** 가 기본. 스튜디오샷 시리즈는 **원본 1 + (선택) 아이템 1** — 아이템은 텍스트로 아주 자세히 묘사. 의상 합성1은 2~3장 이상. 룩북 합성은 인물 1(의상 동일 유지). 시트 활용은 **시트 1**.

### C7. 커머스 상품 이미지
- 파일(7): 고스트 마네킹_상의, 고스트 마네킹_하의, 이커머스 패션(2x2 착용컷), 리얼 목업_UGC스타일, 상의 합성(12칸 의류 분석 보드), 하의_의상 합성(12칸 하의 분석 보드), 사람 하체 레퍼런스
- 트리거: "상품 사진", "누끼", "고스트 마네킹", "흰 배경 제품컷", "쇼핑몰 상세", "착용컷 4장", "리뷰 사진처럼", "UGC", "실사용 사진", "소재 디테일 컷"
- 참조: 고스트 마네킹·이커머스·UGC **필수 1 (상품)**, 상의 합성 **필수 1 (상품을 입은 모델)**, 하의_의상 합성 **필수 2 (하체 체형 1 + 상품 1)**, 사람 하체 레퍼런스 **0**.

### C8. 인물·캐릭터 시트
- 파일(7): 기본 인물 시트, 캐릭터 시트 생성(둘은 완전 동일), 인물 시트 생성(12칸 표정·앵글·조명), 인물 시트 생성2(기준 인물을 텍스트로 새로 만드는 단일 포트레이트), 4by4 그리드(16칸 이모티콘 시트), 시트 활용(시트를 정체성 앵커로 사용 — C6과 겹침), 실사 인물 시트(메타 프롬프트 — C15 참고)
- 트리거: "인물 시트", "캐릭터 시트", "레퍼런스 시트", "정면/측면/후면", "턴어라운드", "표정 모음", "이모티콘 16개", "스티커", "가상 모델 만들기"
- 참조: 기본/캐릭터 시트·4by4 **필수 1 (인물/캐릭터)**, 인물 시트 생성 **선택 1**, 인물 시트 생성2 **0**.

### C9. 다컷·콜라주 (3컷·12컷·졸업앨범)
- 파일(11): 12컷 도교, 12컷 바다, 12컷 삿포로, 12컷 유럽, 12컷 홍콩, 12컷 조선 한복, 3컷 셀카1, 3컷 셀카2, 3컷 셀카3, 첫사랑 졸업앨범 3컷, 첫사랑 졸업앨법 스타일(표지 1장 + 무드 3종 + 실패 시 수정문)
- 트리거: "12컷", "3컷", "콜라주", "스크랩북", "여행 기록 모음", "세로 3분할", "캐러셀", "졸업앨범", "첫사랑 감성"
- 참조: 12컷(조선 한복 제외) **0** — 대신 공통 인물 묘사(SUBJECT) 사용. 12컷 조선 한복 **필수 1 (인물)**. 3컷 셀카·졸업앨범 **필수 1 (인물)**.

### C10. 보정·업스케일·리얼리즘 강화
- 파일(4): 업스케일링(일반판 + 잡티 제거판), 하이퍼 리얼리즘 보정(CG/그림 → 실사 사진), 인물 플라스틱 해소(피부 블록 2종 + 섹션형 작성 틀), 의상 합성1(품질 접미사와 부작용 설명)
- 트리거: "화질 올려줘", "업스케일", "선명하게", "8K", "실사처럼", "AI 티 안 나게", "피부 플라스틱 같아", "자연스러운 피부로", "잡티 제거"
- 참조: **필수 1 (원본)**.

### C11. 손글씨·낙서 꾸미기
- 파일(6): 손글씨, 손글씨_기본(둘은 완전 동일), 손글씨_디저트 메모, 손글씨_음식 메모, 손글씨_음식 메모2(실패 시 수정문 포함), 손글씨_의상 메모(OOTD)
- 트리거: "손글씨", "낙서", "메모 달아줘", "인스타 스토리처럼 꾸며줘", "카페 투어 느낌", "OOTD 꾸미기", "흰 펜 주석"
- 참조: **필수 1 (원본)**. 원본은 그대로 두고 여백에 덧그리기만.

### C12. 썸네일·UI 쇼케이스
- 파일(3): 썸네일 라이프스타일, 썸네일 여행 브이로그_어드밴처, UI 쇼케이스_스포티파이 심야 침실 버전
- 트리거: "유튜브 썸네일", "썸네일 만들어줘", "리액션 썸네일", "앱 화면 떠 있는", "UI 목업", "홀로그램 화면"
- 참조: 썸네일 **필수 1 (인물 얼굴)**, UI 쇼케이스 **0** (앱 이름은 일반 명사로 대체 권장).

### C13. 스타일 변환·혼합 효과
- 파일(6): 3D 캐릭터 변환(한 줄짜리), 디즈니_동물_효과1/2/3(실사 + 2D 손그림 동물), 인물_동물카툰 추가(실사 + 카툰 동물 배치), 시네마틱1(인물 없는 폐허 도시 환경 컨셉아트, 문장이 중간에 끊김)
- 트리거: "3D로 바꿔", "픽사 느낌", "카툰 동물 넣어줘", "로저 래빗처럼", "만화 동물이랑 같이", "영화 같은 배경", "컨셉아트"
- 참조: 3D **필수 1 (원본)**, 디즈니 동물 **필수 1 (원본 사진)**, 동물카툰 추가 **필수 2 (원본 장면 1 + 카툰 동물 소스 1)**, 시네마틱1 **0**.

### C14. 영상용 (제외) — 5번 항목 참고
### C15. 분석·메타 (이미지 생성 아님) — 5번 항목 참고

---

## 2. 공통 프롬프트 구조 (슬롯 순서)

파일들을 겹쳐 보면 아래 순서가 가장 흔합니다. `인물 역설계2`도 결합 순서를 "피사체 → 스타일 → 동작 → 장소 → 조명 → 카메라"로 둡니다. 편집형은 0~1번(참조·잠금)이 맨 앞에 오고, 생성형은 2번부터 시작합니다.

| # | 슬롯 | 흔한 값 예시 | 비고 |
|---|---|---|---|
| 0 | 참조 역할 선언 | "1번 이미지 = 인물, 2번 = 의상", "@person", "REF", "기준 이미지를 구도·조명 기준으로" | 여러 장일 때 **역할을 번호로** 지정하는 게 핵심 |
| 1 | 정체성 잠금 | 얼굴형·눈매·코·입·턱선·피부톤·헤어라인·체형 유지, 미화 금지 | 편집형 필수 |
| 2 | 결과물 유형 | 초실사 인물 사진 / 셀카 / 룩북 / 12컷 콜라주 / 상품컷 / 썸네일 | 첫 문장에 둠 |
| 3 | 촬영 매체·기기 | 아이폰 전면 카메라, 2007년 무렵 콤팩트 디카, CCD 디카, 필름 카메라, 풀프레임 50mm f/2.0, 85mm f/1.2, Portra 160 톤 | 질감을 가장 크게 좌우 |
| 4 | 샷 크기·앵글·구도 | 익스트림 클로즈업 / 가슴 위 / 허벅지 위 / 전신(머리 위·발 아래 여백, 프레임의 60~70%) · 눈높이 / 하이 / 로우 / 버드아이 / 3/4 / 측면 90도 / 어깨 너머 · 비대칭 크롭, 중앙에서 살짝 벗어남, 좌측 여백 | |
| 5 | 피사체 기본 | 20대 초중반 여성, 부드러운 인상, 슬림 | 체형·인종 묘사는 최소화 권장(민감) |
| 6 | 얼굴·표정·시선 | 은은한 미소, 무표정+몽환, 살짝 벌린 입술, 삐죽, 윙크 · 카메라 응시 / 시선 옆 / 액정 응시 | |
| 7 | 헤어 | 허리까지 긴 흑발 생머리, 시스루 앞머리, 잔머리, 로우 사이드 포니, 메시 업두, 단발 | |
| 8 | 메이크업 | 노메이크업 룩, 유리알 피부, 애교살, 얇은 아이라인, 글로시 누드핑크 립, 도우인 스타일 | |
| 9 | 의상·소품 | 상의/하의/신발/양말/가방/액세서리/네일을 **소재·핏·색·디테일** 단위로 | 커머스·착장에서는 가장 긴 슬롯 |
| 10 | 포즈·동작 | 손 위치(턱 괴기, 머리 쓸어넘기기), 몸 비틀기, 무게중심, 앉음/엎드림, 걷는 중 | |
| 11 | 장소·배경 | 실내/야외, 벽·바닥 재질, 소품, 배경 흐림 정도(아웃포커스/딥포커스) | |
| 12 | 조명 | 광원 방향·색온도·하드/소프트: 창가 측광, 골든아워, 직광 플래시, 텅스텐, 형광등, 네온, 백라이트 블룸, 렘브란트 등 명칭 조명 | |
| 13 | 색감·톤 | 저채도, 웜/쿨, 바랜 시네마틱, lifted blacks, 미세 그레인, CCD 누런 톤, 파스텔 | |
| 14 | 분위기 | 고요·쓸쓸·장난·몽환·도도 등 3~4개 단어 | |
| 15 | 피부 리얼리즘 블록 | (3번 항목 B1) | 거의 모든 인물 프롬프트에 고정 |
| 16 | 품질·렌더 | 4K/8K, 선명한 초점, 얕은 심도 | 남용 시 부작용(B18) |
| 17 | 텍스트·로고 정책 | 글자·워터마크·로고 없음 / 또는 한국어 텍스트 규칙 | |
| 18 | 네거티브·실패 조건 | 해부학 오류, 플라스틱 피부, CGI, 과보정, "다른 사람처럼 보이면 실패" | |
| 19 | 비율·해상도 | 4:5(가장 흔함), 9:16, 1080x1350, 2x2·3x4·4x4 그리드 | |
| 20 | (후속) 추가 주문 | 같은 결과물에서 포즈·표정·앵글만 바꾸는 짧은 후속 문장 | 채팅 2턴째 이후 편집으로 그대로 매핑 |

슬롯 작성 팁 (파일 공통):
- 영어 서술형(차안셀카 등)은 "샷 종류 → 인물 → 조명 → 의상 → 배경 → 팔레트 → 기기 → 분위기"를 한 문단에 이어 씀.
- 한국어·섹션형(디카샷, 스튜디오샷)은 `[블록 이름]` 또는 `XXX LOCK` 헤더로 끊어 씀. 생성기 입장에선 **섹션형이 지시 누락이 적음** → 우리 템플릿은 섹션형 채택 권장.

---

## 3. 반복되는 규칙 블록 (직접 다시 쓴 요약)

- **B1 피부 리얼리즘 (고정 블록)** — 모공·옅은 잡티·약간 고르지 않은 톤·자연스러운 볼 홍조를 남기고, 보정·스무딩·밀랍/도자기 같은 피부를 금지. 약 30개 파일에 거의 같은 문구로 반복. 예외: 업스케일 '잡티 제거판', 뷰티 스무딩을 일부러 넣는 한국어 셀카 일부, 디카 감성(일부러 흐리게).
- **B2 정체성 잠금** — 얼굴 부위(형태·눈 모양·간격·코·입술·턱·헤어라인·피부톤·체형)를 나열하고 "재해석·미화·나이·인종 변화 금지". 한국어판은 "다른 사람처럼 보이면 실패"로 강하게 씀.
- **B3 장면 잠금 묶음 (편집용)** — 배경·조명·색(화이트밸런스·대비·채도)·구도·카메라 각도를 원본과 같게 고정. "환경·조명·구도는 바뀌지 않는다"로 마무리.
- **B4 한 가지만 바꾸기** — "오직 X만 바뀐다"를 맨 앞과 맨 끝에 반복(스튜디오샷 시리즈). 이전 단계에서 추가된 아이템은 '유지 목록'에 계속 누적.
- **B5 전신 프레이밍** — 카메라를 조금 뒤로, 머리 위·발 아래 여백, 인물이 화면의 60~70%, 타이트 크롭 금지, 중앙 정렬.
- **B6 앵글 문장 사전** — 앵글마다 '무엇이 크게/작게 보이는지'까지 적음. 예: 로우=다리가 크고 머리가 멀어짐·키가 커 보임 / 버드아이=정수리·어깨가 위를 채우고 발은 거의 안 보임 / 3/4=몸 45도, 얼굴만 살짝 렌즈 쪽 / 측면=완전한 90도 실루엣 / 어깨 너머=등·어깨가 전경, 얼굴 일부 / 하이셀카=팔을 뻗어 위에서 / 익스트림 클로즈업=눈·코만, 얼굴이 85~95%.
- **B7 불완전한 폰카 리얼리즘** — 약한 손떨림 블러, 가끔 초점 놓침, 하이라이트 날아감, 렌즈 플레어, 저조도 노이즈, 압축 흔적, 중심에서 벗어난·잘린 구도, '의도치 않게 찍힌' 느낌.
- **B8 디카·플래시 감성** — 정면 직광 플래시로 얼굴만 밝고 배경은 눌림, 단단한 그림자, CCD 특유의 살짝 누런 저채도·저대비, HDR·샤픈·DSLR 느낌 금지, 살짝 흐림·헤이즈·블룸.
- **B9 몽환 블룸** — 강한 창가 역광, 우유빛 하이라이트, 떠다니는 헤이즈, 낮은 대비, 파스텔로 씻긴 톤, 살짝 노출 과다, 필름 블룸.
- **B10 그리드 잠금** — 칸 수를 숫자로 못박고(예: 정확히 12, 11도 13도 아님), 행×열·같은 크기·같은 간격, 칸마다 역할 1개, 라벨은 칸 안 하단 중앙 2~3단어·번호 없음, "글자 렌더링이 불안하면 레이아웃을 우선".
- **B11 순백 배경** — #FFFFFF 균일, 그라데이션·회색 캐스트·배경 그림자 없음, 상품 바로 아래 아주 옅은 그림자만 허용, 흰 옷은 가장자리 대비로 분리.
- **B12 의복 충실도** — 실루엣·봉제선·여밈·포켓·밑단·소재 무게감·정확한 색 유지, 재디자인 금지. 인쇄/자수/패치는 평면 그대로, 단추·지퍼만 입체로(인쇄 글자를 단추로 만들지 말 것).
- **B13 착용 리얼리즘** — 포즈·체형에 맞는 주름과 처짐, 중력, 몸에 눌린 압축, 접지 그림자, "붙여넣은 듯 떠 있지 않게".
- **B14 합성 통합 (요소 삽입)** — 넣는 요소의 원근 크기, 접지 그림자, 가려짐(가구 뒤), 렌즈 블러·헤이즈·반사까지 장면과 맞추기. 2D 요소는 2D 그대로 유지(실사화 금지)하되 공간에는 실재하는 것처럼.
- **B15 텍스트 정책** — 기본은 "글자·워터마크·로고 없음". 글자가 필요하면 ① 한국어만 ② 1~3단어 ③ 얼굴을 가리지 않는 빈 공간 ④ 정확한 문자열을 따옴표로 지정. 실명 학교·이름표·개인정보 금지.
- **B16 해부학 네거티브** — 손가락 수 오류·붙은 손가락·꺾인 손목·중복 신체·불가능한 포즈·비율 왜곡 금지.
- **B17 원본 보존 오버레이** — 사진을 다시 그리지 말고 위에 덧그리기만, 주요 피사체(음식·옷)를 가리지 않게 여백에 배치.
- **B18 품질 접미사 주의** — "8K·마스터피스·선명" 류는 맨 끝에 짧게. 필름·몽환·수채화 스타일에선 질감을 노이즈로 지워버리고, 피부를 플라스틱으로 만들고, 과샤픈을 부름 → 스타일별로 끄기.
- **B19 인물 조명 사전** — 렘브란트(45도 위, 반대 뺨 역삼각 빛), 루프(코 옆 작은 고리 그림자), 스플릿(정측면, 얼굴 반반), 버터플라이(정면 위, 코 밑 나비 그림자), 언더(아래에서, 불길함), 탑/갓파더(정수리 수직, 눈 그늘), 클램셸(위아래 동시, 뷰티), 림(뒤에서 윤곽선), 브로드(넓은 면 밝게), 숏(좁은 면 밝게, 갸름). 포즈·시선 고정 문구와 같이 씀.
- **B20 실패 시 수정문** — 얼굴이 바뀜 → "얼굴은 원본 그대로, X만 바꿔" / 너무 AI 같음 → 피부결·그레인·현실 조명 추가 / 원본이 변형됨 → "재생성 말고 덧그리기만" / 한글 깨짐 → 정확한 문자열 재지정. 채팅 재시도 버튼에 매핑하기 좋음.

---

## 4. 언어 관찰과 권장

- **영어 위주 (약 74개)**: 앵글 9종, 편집(표정·포즈·헤어), 의상 합성 전부, 스튜디오샷, 커머스 전부, 12컷 전부, 썸네일·UI, 디즈니 동물, 영상 프롬프트, 영어 서술형 셀카(차안·블루베리·거울2/3·카페2·어반·창가·빈티지), 도교 스냅샷·인스타감성(한글 제목 + 영어 본문), 졸업앨범(영어 본문 + 한국어 수정문), 손글씨/손글씨_기본(영어 지시 + "글자는 한국어").
- **한국어 위주 (약 26개)**: 카페셀카, 햇살셀카, 공원셀카1/2, 러닝셀카, 엘리베이터셀카, 침대셀카2, 거울셀카, 야간도로(줄바꿈이 깨진 손상 텍스트), 3컷 셀카1/2/3, 디카샷 앞/옆, 기본 인물 시트, 캐릭터 시트 생성, 4by4 그리드, 3D 캐릭터 변환, 인물 조명, 인물 역설계1/2, 손글씨_디저트/음식/음식2/의상 메모, 의상 합성1(한영 혼용).
- **권장: 생성기에는 영어로 보낸다.**
  - 검증된 규칙 블록(피부·잠금·그리드·커머스)이 전부 영어이고, 렌즈·조명·소재 용어가 영어에서 더 정확함.
  - 한국어 고유 표현은 영어로 풀어 씀: 애교살 → "subtle under-eye puffiness (aegyo-sal)", 시스루뱅 → "wispy see-through bangs", 도우인 메이크업 → "soft Douyin-style glam makeup", 유리알 피부 → "dewy glass-skin finish".
  - **그림 안에 들어갈 글자만 한국어 원문을 따옴표로** 넣고 "All visible text must be Korean, exactly: '...'"로 고정.
  - 사용자에게 보여주는 요약·확인 문구는 한국어.

---

## 5. 제외·주의 대상

### 5-1. 영상 전용·빈 파일 (C14, 이미지 기능에서 제외)
| 파일 | 이유 |
|---|---|
| 립싱크 | 대사 립싱크 영상(음성·입 모양) |
| 180도 뒷모습 | "참조 이미지를 시작 프레임으로 한 영상", 호흡·미세 움직임 |
| 90도 오른쪽 사이드뷰 | 같은 형식의 영상 |
| 90도 왼쪽 사이드뷰 | 같은 형식의 영상 |
| 번지는 효과 | 시작/끝 이미지 사이 휩팬 전환 영상 |
| 줌인 | 첫 프레임 기준 줌인 영상. 단 '더 타이트한 크롭'으로 바꾸면 C4 정지 이미지로 재활용 가능 |
| 12컷 영상화 | 빈 파일(0 byte) |
| (하이앵글) | 빈 파일(0 byte). 카테고리는 C4지만 내용 없음 — 앵글 문장은 공원셀카·러닝셀카에서 보충 |

참고: `스튜디오샷_배경변경`은 "걷는 영상의 시작 프레임" 의도가 적혀 있지만 결과물은 정지 이미지라 C5에 남김.

### 5-2. 이미지 생성이 아닌 것 (C15, 전처리 LLM 단계로만)
- 인물 역설계1 — 인물 사진을 7항목 텍스트 설명으로 정리(학습용 설명 데이터).
- 인물 역설계2 — 사진을 피사체·동작·장소·조명·카메라·스타일로 분해하고 한 줄 프롬프트 생성. → **"이 사진처럼 만들어줘" 요청 시 1단계(비전 분석)로 쓰기 좋음.**
- 실사 인물 시트 — 콘셉트 텍스트를 받아 배우 프로필 시트 프롬프트를 '출력'하는 메타 프롬프트.

### 5-3. 조각·라이브러리 (단독 실행 불가, 블록으로만)
- 3D 캐릭터 변환(한 줄), 시네마틱1(문장 중간에 끊김), 의상 합성1(품질 접미사+주의사항), 인물 플라스틱 해소(블록 모음), 인물 조명(조명 사전).

### 5-4. 중복
- `손글씨.txt` = `손글씨_기본.txt` (MD5 동일)
- `기본 인물 시트.txt` = `캐릭터 시트 생성.txt` (MD5 동일)
- `옷 입히기.txt` ≈ `의상 교환.txt` (본문 동일, 앞 파일에만 출처 줄)

### 5-5. 그대로 쓰면 안 되는 요소 (템플릿에서 일반화할 것)
- **실제 브랜드·IP 이름**: 디즈니 작품·캐릭터명(밤비·아리스토캣 등), Spotify, Adidas / adidas x Wales Bonner, alo, Apple AirPods·Watch, CELINE, Starbucks, Lawson, Zara/H&M, Canon 기종명, iPhone 기종명. → 로고·상표는 "작은 무지 로고", "음악 스트리밍 앱", "클래식 손그림 애니메이션 풍 동물" 같은 일반 표현으로 바꾸기. 기기명은 '느낌'으로만("modern smartphone front camera", "mid-2000s compact digital camera").
- **선정적·신체 수치 묘사**: 침대셀카2("가슴 볼륨 약 500cc"), 3컷 셀카1(브라 라인 노출·모래시계 체형), 엘리베이터셀카(S라인 강조), 사람 하체 레퍼런스·하의_의상 합성(허벅지 갭·특정 체형 이상화). → 체형 수치·노출 강조 슬롯은 템플릿에서 아예 빼고, 사용자가 써도 정책 필터를 거치게 하기.
- **인종·민족 지정**: 여러 파일이 "Asian / East Asian / 인도네시아 / 태국·한국·일본" 등을 지정. 참조 인물이 있으면 넣지 않는 게 안전(정체성은 참조 사진이 결정).
- **실존 인물·실명 학교 등**: 졸업앨범 파일처럼 "실존 연예인 흉내 금지, 학교명·이름표 금지"를 기본 네거티브로 넣기.
- **외부 배포물 흔적**: 야외 포징 첫 줄("PDF를 받아 복사하라")은 다른 곳에서 가져온 묶음이라는 표시 — 원문 재사용 금지 대상.

---

## 6. 카테고리별 템플릿 (직접 작성, `{슬롯}` 자리표시)

공통 꼬리표(모든 인물 템플릿 끝에 자동 부착):
- `{SKIN}` = "Keep skin true to life: fine pores and faint natural marks stay visible, tone is slightly uneven with a soft natural blush; no airbrushing, no waxy or poreless finish."
- `{ANATOMY}` = "Hands and limbs must be anatomically correct: five fingers per hand, natural joints, no duplicated or missing body parts."
- `{NOTEXT}` = "No text, captions, watermarks or logos anywhere in the image."
- `{IDENTITY}` = "Treat image {n} as the identity source. Keep the same face shape, eye shape and spacing, nose, lips, jawline, hairline and skin tone. Do not beautify, age-shift or redesign the face — it must read as the same person."

### C1. 셀카·일상 스냅
```
A candid {shot_size} selfie taken on a modern smartphone {camera_side: front camera | in a mirror}, {angle}.
{IDENTITY if ref}
Subject: {age_range} {gender}, {expression}, gaze {gaze}.
Hair: {hair}. Makeup: {makeup}.
Outfit: {top}; {bottom}; {accessories}.
Pose: {pose_hands_body}.
Setting: {place}, background {background_details}, {depth: softly blurred | everything in focus}.
Light: {light_source_and_direction}, {color_temperature}.
Color & mood: {palette}; {mood_words}. Slight phone-camera grain, casual everyday feel, not a studio shoot.
{SKIN} {ANATOMY} {NOTEXT}
Aspect ratio {ratio: 4:5}.
```

### C2. 레트로 기기·플래시 스냅
```
{IDENTITY}
Make this look like an offhand snapshot from a {device_feel: mid-2000s compact digital camera | old CCD point-and-shoot}, not a model shoot.
Framing: {shot_size}, {angle}; the camera {is visible in the mirror | is held beside the face}.
Flash: a strong direct on-camera flash lights only the face and shoulders; the background {place} falls into darkness; hard shadow behind the subject.
Look: low saturation, low contrast, faint yellowish cast, mild haze and bloom, slightly soft focus, a little noise. No HDR, no sharpening, no crisp DSLR look.
Expression: {expression}; eyes {gaze: on the camera screen, not the lens}.
Hair: {keep original, slightly messy}. Outfit: {outfit}.
Fail if: the face looks like someone else, the image is razor sharp, or the skin looks perfectly smooth.
Aspect ratio {ratio: 4:5}.
```

### C3. 장소·여행 화보 / 몽환 블룸
```
{IDENTITY if ref}
A candid {shot_size} travel photo at {location}, {season_time_weather}.
Subject {action_pose}, gaze {gaze}, {expression}.
Outfit: {outfit_with_fabric_and_fit}.
Environment details: {landmarks_props_signage_generic}.
Capture style: {device_feel}; {light_style: bright direct sun | flat overcast | night mixed street light | strong window backlight with soft bloom, milky highlights, floating haze and low contrast}.
Color: {grading}. Mood: {mood_words}.
{SKIN} {ANATOMY} {NOTEXT}
Aspect ratio {ratio: 4:5}.
```

### C4. 카메라 앵글·프레이밍
```
{IDENTITY if ref, else: A young {gender} in a plain white studio}
Outfit: {outfit} {if ref: same as the reference}.
Background: seamless white backdrop, soft even light, no hard shadows.
Camera: {angle_phrase}  ← B6 사전에서 하나 선택
Framing: {framing: full body head-to-toe with margin | chest-up | eyes-and-nose only, face fills ~90% of frame}.
Keep pose, lighting and mood unchanged; only the camera position changes.
{SKIN} {ANATOMY} {NOTEXT}
Aspect ratio {ratio: 4:5}.
```
`angle_phrase` 예: low = "camera near the floor looking up; legs loom large, head recedes, subject feels tall" / bird's-eye = "camera directly overhead; crown and shoulders dominate, feet barely visible" / three-quarter = "body turned about 45° away, face turned slightly back to the lens" / profile = "pure 90° side view, clean silhouette" / over-shoulder = "camera behind one shoulder, back in the foreground, face partly visible".

### C5. 부분 편집 (표정·포즈·헤어·조명·배경)
```
Edit image 1. Change only the {target: facial expression | pose | hairstyle | lighting | background}.
New {target}: {desired_value}.
{IDENTITY with n=1}
Locked: clothing, skin texture, camera angle, framing{, background}{, lighting} — everything not named above stays exactly as in the original.
Make the change physically believable: {target_specific_realism: natural muscle movement and real-looking teeth | balanced weight and natural limb positions | real strands, natural hairline and flyaways | light direction consistent with shadows | subject's skin tone unchanged, contact shadow under the feet}.
Avoid over-beautifying, uncanny symmetry, wig-like hair, floating hands or warped background.
{SKIN}
```
조명 편집이면 `desired_value`에 B19 사전 문장 하나를 넣고 "pose and gaze stay fixed"를 덧붙임.

### C6. 의상 합성·교체
```
Image 1 is the person. Image 2 is the garment{ / image 3 is the second item}.
Dress the person from image 1 in the {item_type} from image 2.
{IDENTITY with n=1}
Locked: pose, body proportions, hairstyle, background, lighting, camera angle{, every other clothing item: {keep_list}}.
Transfer the garment exactly: design, cut, color, fabric texture, seams, closures and hardware.
Wear it realistically: folds and drape follow the pose and gravity, the fabric presses against the body where it rests, shadows and light match the scene — it must not look pasted on.
{optional_style_wrapper: Full-body lookbook on a pure white seamless background, camera pulled back with space above the head and below the feet.}
{SKIN} {ANATOMY} {NOTEXT}
```
스튜디오샷식 단계 편집은 `item_type`을 하나씩 바꾸고 이전에 추가된 아이템을 `keep_list`에 누적.

### C7. 커머스 상품 이미지
고스트 마네킹:
```
Image 1 is the product. First read the garment's structure (silhouette, neckline, sleeves, hem, waist/rise, volume), then keep it exactly.
Render it as an invisible-mannequin product shot: the garment holds a worn 3D shape with no body, hanger or mannequin visible; the inside of the {neckline / sleeve ends / waist opening} is visible.
Preserve every seam, closure, pocket and trim; flat prints stay flat, embroidery stays embroidery, only real buttons/zippers are 3D. Exact original color.
Background pure white (#FFFFFF), perfectly even; only a faint shadow directly under the garment. Soft even light from both sides. Centered with even margins, nothing cropped.
No redesign, no length or width change, no added logos or text.
```
UGC/라이프스타일:
```
Image 1 is the product; keep its design, color and branding unchanged.
A real-feeling phone photo of {person_type: an ordinary non-model person} {product_state: holding it casually} at {place}, with {nearby_objects} around.
Slightly imperfect: uneven natural light, minor softness or grain, off-center framing, a lived-in background.
The product matches the scene lighting and casts real shadows on the hand.
{SKIN} Looks like a customer photo, not an ad.
```

### C8. 인물·캐릭터 시트
```
{IDENTITY with n=1}
Create a clean reference sheet of this same person on a white background.
Layout: {layout: top row = four full-body views (front, left, right, back); bottom row = three face views (front, left, right) | 3x4 grid: expressions / angles / lighting studies}.
Every panel: same identity, same proportions, same scale, neutral {A-pose | standing pose}, consistent soft studio lighting.
{label_rule: no labels | one short label (2–3 words) centered under each panel, no numbers}.
{SKIN} {ANATOMY}
```
이모티콘 시트:
```
{IDENTITY with n=1, style: keep the same character art style}
Make a {rows}x{cols} sticker sheet ({rows*cols} cells), each cell a separate usable emoji of the same character showing {expression_list}.
White background, clean sticker-style edges, consistent look in every cell, no text.
```

### C9. 다컷·콜라주
```
{IDENTITY if ref, else Subject: {subject_description}}
A single {ratio: vertical 4:5 | 9:16} image made of {count} panels arranged as {layout: three stacked panels | loose tilted scrapbook collage}.
Same person, same {fixed_elements: outfit / backdrop / framing} in every panel.
Panels:
1) {scene_or_mood_1}
2) {scene_or_mood_2}
… ({count}개)
Capture style: {device_feel}; candid, partly accidental framing, off-center subjects.
Each panel must feel clearly different in {difference_axis: mood | place | time of day}, while the person stays recognizable.
Grade: {grading}. {SKIN} {NOTEXT}
```

### C10. 보정·업스케일
```
Improve the quality of image 1 only. Keep the person, expression, pose, clothing, background, framing and composition exactly the same — add nothing, remove nothing.
Recover fine detail: crisp facial contours, individual hair strands, clear eyes, clean edges, real fabric texture.
Improve dynamic range and depth while respecting the original light direction.
{skin_mode: keep natural pores and small marks | lightly clean temporary blemishes but keep pore texture}.
{style_guard: if the source is film/grain/dreamy, keep that texture — do not treat it as noise.}
High-resolution, photographic, no CGI or game-render look.
```

### C11. 손글씨·낙서 꾸미기
```
Do not regenerate image 1 — keep the photo exactly as it is and only draw on top of it.
Add hand-drawn annotations in {pen: thin white pen | playful marker} with slightly wobbly, imperfect lines:
- outline the main {subject_kind: food items / clothing items / people} with a thin line
- arrows or dotted curves guiding the eye to each item
- a few small doodles ({doodles: hearts, sparkles, steam lines, stars}) used sparingly
Handwritten notes in Korean only, short and casual, {tone: diary-like monologue | friendly styling tips}:
{per_item_notes: '…' for the main item, '…' for the drink/side, '…' for the space, one-line summary '…'}.
Place all writing in empty areas; never cover the main subject. Keep it airy, like an Instagram story or a magazine scrapbook page.
```

### C12. 썸네일·UI 쇼케이스
썸네일:
```
Image 1 is the face. {IDENTITY with n=1}
A high-impact video thumbnail: the subject is close to the lens, filling 40–60% of the frame, reacting with {emotion} to {story_moment} in {environment}.
Add story props: {props}. Background slightly softened.
Lighting: strong face highlight, subtle rim light, deeper shadows — dramatic but natural.
Text: only "{korean_text_1_to_3_words}", bold heavy lettering with slight texture, in empty space, never over the face; no long sentences, no neon glow, no sticker look.
Slight wide-angle feel. {SKIN}
Aspect ratio 16:9.
```
UI 쇼케이스:
```
A first-person view in {environment} with a large floating semi-transparent glass interface of a {app_type: generic music streaming app} showing {ui_sections}.
The panel has rounded corners, soft reflections and a glow that lights the nearby surfaces; it sits in real perspective, not as a flat overlay.
Lighting mixes {warm_practical_light} with the cool glow of the panel. {lens: 24–28mm feel}, gentle depth of field.
Readable minimal typography; no real brand names or logos. Mood: {mood}.
```

### C13. 스타일 변환·혼합
실사 + 2D 동물:
```
Image 1 is an untouched real photo: the person, background, lighting, color and camera stay exactly as they are; the person stays fully photorealistic.
Add original hand-painted 2D {animal_type} in a classic storybook-animation feel (no copied characters, no 3D/CGI look), scattered naturally: some close to the lens, some near the person, some far back, some half-hidden behind objects.
Each creature matches the scene's perspective, scale, light direction, lens blur and gets a soft contact shadow, so it feels present in the room rather than pasted on.
```
3D 변환:
```
Re-render image 1 as a {style_3d: stylized 3D animated-film character | realistic game-engine 3D} while keeping the pose, outfit colors, framing and recognizable facial traits of the person.
```

---

## 7. 출처/작성자 줄이 있는 파일

| 파일 | 내용 |
|---|---|
| `옷 입히기.txt` | 마지막 줄에 `[출처] … | 작성자 …` 형식 블로그 크레딧(작성자 "AI 신사장") |

- 그 밖에 `출처`, `작성자`, `copyright`, `©` 등을 전체 검색했지만 크레딧 줄은 위 1개뿐이었어요.
- 다만 `의상 교환.txt`는 위 파일과 **본문이 글자 하나까지 같고 크레딧 줄만 빠진** 상태라 같은 출처로 봐야 합니다.
- `야외 포징.txt` 첫 줄의 "PDF를 받아 복사하라"는 외부 배포물에서 옮긴 흔적입니다(크레딧은 없음).
- 나머지 파일에도 출처 표시가 없을 뿐 외부 수집본일 수 있으니, **원문은 저장소에 넣지 말고 위 2·3·6번처럼 다시 쓴 규칙과 템플릿만** 쓰는 게 안전해요.

---

## 8. 구현 메모 (라우팅 순서 제안)

1. 요청 분류: 트리거 키워드 + 첨부 이미지 수로 C1~C13 중 하나 선택. 영상 키워드("영상", "움직이게", "립싱크", "전환")면 C14로 보내 "이미지 기능 아님" 안내.
2. 참조 검사: 카테고리별 필수 장수 미달이면 생성 전에 "인물 사진 1장, 옷 사진 1장이 필요해요"처럼 역할을 짚어서 요청.
3. "이 사진처럼"이면 C15(역설계2 방식)로 먼저 비전 분석 → 슬롯 자동 채움.
4. 슬롯 채우기: 사용자가 말한 값 우선, 빈 슬롯은 카테고리 기본값.
5. 블록 부착: 인물 있음 → B1·B16, 편집 → B2·B3·B4, 그리드 → B10, 상품 → B11·B12, 텍스트 요청 → B15.
6. 정책 필터: 5-5의 브랜드·신체 수치·인종 슬롯 제거/일반화.
7. 영어로 조립, 그림 속 한국어만 따옴표로 유지, 비율 지정 후 전송.
8. 후속 턴: "추가 주문" 패턴 → 직전 결과를 원본으로 C5 편집. 실패 피드백 → B20 수정문 매핑.
