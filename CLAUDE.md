# music-maker

**브라우저에서 여는 작곡(시퀀서) 앱.** 악기를 고르고 → 격자(피아노 롤)에 음표를 찍고 →
재생하면 곡이 흘러나온다. 곡은 "세션"처럼 저장되고, 링크로 다른 기기와 공유한다.

이 문서는 처음 이 저장소를 여는 사람/AI가 **전체 구조와 규칙을 빠르게 파악**하도록 쓴 가이드다.
대화는 한국어로 한다. (사용자는 한국어로 소통한다.)

---

## 한눈에

| 항목 | 값 |
|---|---|
| 종류 | 정적 웹 앱 (프레임워크·빌드 도구 없음) |
| 소리 엔진 | [Tone.js](https://tonejs.github.io/) 14.8.49 (CDN, `index.html`에서 로드) |
| 파일 | `index.html`(구조) · `style.css`(디자인) · `app.js`(전부 여기) |
| 실행 | `python3 -m http.server` 후 브라우저로 접속. **빌드 없음** |
| 라이브 | https://minsikim-42.github.io/music-maker/ (GitHub Pages, `main`/root) |
| 원격 | https://github.com/minsikim-42/music-maker (public) |
| 저장 | 브라우저 `localStorage` (곡=세션). 서버·DB·계정 없음 |
| 기기 간 이동 | 곡을 URL 해시에 통째로 담아 공유(자동 동기화 아님) |

**이 앱은 별도 프로젝트다.** 같은 사용자의 Unity 게임(`InuYashaProject`)과는 무관하며 코드를 공유하지 않는다.

---

## 실행 · 배포

### 로컬 실행
```bash
cd music-maker
python3 -m http.server 8000
# → http://localhost:8000  (첫 ▶ 재생 클릭 때 오디오가 켜진다: 브라우저 정책상 사용자 제스처 필요)
```
`index.html`을 파일로 바로 열어도 대체로 되지만, 로컬 서버 권장(일부 브라우저가 `file://`에서 제약).

### 배포 (변경 반영)
정적 파일뿐이라 push하면 GitHub Pages가 1~2분 뒤 자동 반영한다.
```bash
git add -A && git commit -m "..." && git push
```
- 계정 인증은 `gh`(GitHub CLI, brew 설치)로 로그인돼 있음(HTTPS, keyring). 커밋 author는 `minsikim-42` / `spalstlr321@gmail.com`.
- Pages 상태 확인: `gh api repos/minsikim-42/music-maker/pages/builds/latest --jq '.status'` (`built`면 완료).
- Pages가 꺼져 있으면: `gh api -X POST repos/minsikim-42/music-maker/pages -f "source[branch]=main" -f "source[path]=/"`.

### 검증 방법 (이 프로젝트의 원칙)
자동 테스트는 없다. **브라우저에서 직접 확인한다.** 에이전트라면 in-app 브라우저로:
로컬 서버 띄우기 → 화면·클릭·콘솔 에러(`read_console_messages` onlyErrors) 확인.
localStorage 상태나 공유 코덱 round-trip은 `javascript_tool`로 `localStorage`를 읽어 검증한다
(`encodeShare`/`decodeShare`는 전역이 아니라 직접 호출 불가 → 공유 링크를 만들고 그 URL로 접속해 복원 확인).

> **주의: 해시(`#song=...`)만 바뀌는 이동은 브라우저가 페이지를 리로드하지 않는다.**
> `importFromHash`는 로드 시 1회만 도므로, 같은 탭에서 공유 링크 임포트를 테스트하려면
> **쿼리를 붙여**(`?r=1#song=...`) 강제 리로드해야 한다. 실제 다른 기기에서는 새 로드라 문제없다.

---

## 코드 지도

한 파일 `app.js`(약 960줄)에 전부 있고, `// ═══` 헤더로 섹션이 나뉜다. 위에서 아래로 의존한다.

| 섹션 | 핵심 함수 | 하는 일 |
|---|---|---|
| 악기(신스) | `buildSynth` `defaultParams` `applyParamsLive` `disposeSynth` `triggerTrack` `preview` | 트랙 종류/악기에 맞는 Tone 신스 생성·해제, 한 스텝 울리기 |
| 트랙 | `makeTrackObj` `addTrack` `removeTrack` `resizeAll` `clearTracks` | 트랙 객체 생성/추가/삭제, 곡 길이 변경 시 격자 리사이즈 |
| 화면 그리기 | `render` `renderTrack` | 트랙들을 DOM으로 그림(격자 셀·헤더 컨트롤). 구조 변경 때 전체 재그림 |
| 재생 | `rebuildSequence` `highlightColumn` `clearHighlight` | `Tone.Transport`+`Tone.Sequence`로 스텝을 돌며 모든 트랙을 함께 울림, 재생 위치 표시 |
| 세션 저장소 | `serialize` `deserialize` `newSong` `openSession` `saveActive` `markDirty` `flushSave` `deleteSession` `renameSession` `renderSessionList` | 곡=세션을 localStorage에 자동 저장, 왼쪽 목록에서 전환 |
| 컨트롤 배선 | (익명) | 재생/정지/템포/곡길이/트랙추가/공유 버튼 이벤트 |
| 드로어 + 메뉴 | `MENU` `openSynthFromMenu` `openDrawer` `showToast` | 왼쪽 "내 곡" 목록 + "앞으로 추가할 기능"(잠금/사용가능) |
| 링크 공유 | `encodeShare` `decodeShare` `openShareModal` `openSynthModal` `importFromHash` | 곡을 URL에 담고/풀고, 공유·음색 편집 모달 |
| 시작 | (하단) | localStorage 로드 → 해시 임포트 or 지난 곡 or 새 곡 |

`index.html`: 상단바(햄버거), 컨트롤 바, `#tracks`(트랙 컨테이너), `#drawer`(세션+메뉴),
`#modal`(공유·음색 공용 팝업), `#toast`. `style.css`: 다크 테마, CSS 변수로 색을 모음.

---

## 데이터 모델

### 세션 (곡 하나)
```js
{ id, name, updatedAt, data }              // localStorage 키 "music-maker.sessions" 배열
// 활성 곡 id는 키 "music-maker.activeId"
```
`data` = 곡 내용(저장·공유 대상):
```js
{ bpm, bars, tracks: [ trackData, ... ] }
```

### 트랙
```js
trackData = {
  type: "melody" | "drums",
  instrument: "piano"|"synth"|"pluck"|"bass"|"custom" | null(드럼),
  name, muted,
  params: {…} | null,        // instrument==="custom"일 때만. 커스텀 음색
  grid: boolean[rows][steps], // rows: 멜로디=13(반음), 드럼=3(하이햇/스네어/킥). steps = bars*16
}
```
런타임 트랙 객체엔 추가로 `id`, `synth`(Tone 인스턴스), `cellEls`(DOM 참조)가 붙지만
**직렬화에는 넣지 않는다**(`serialize`가 골라 담는다).

### 커스텀 음색 (params)
```js
{ wave:"sine|triangle|square|sawtooth", attack, decay, sustain, release, cutoff, volume }
```
범위는 `PARAM_RANGES`. 슬라이더 편집은 `applyParamsLive`가 `poly.set`으로 **즉시 반영**(신스 재생성 없음).

---

## 재생이 도는 방식

- `Tone.Transport`가 마스터 시계, `Tone.Sequence`가 스텝 인덱스(0..steps-1)를 `"16n"` 간격으로 돈다.
- 콜백에서 **모든 트랙**의 그 열을 모아 각 트랙 신스로 울린다(멀티 트랙 동시 재생).
- 재생 위치 하이라이트는 오디오 스레드가 아니라 `Tone.Draw.schedule`로 화면 타이밍을 맞춰 칠한다.
- 구조가 바뀌면(트랙 추가/삭제, 곡 길이) `rebuildSequence`로 시퀀스를 다시 만든다.

---

## 링크 공유 코덱 (다른 기기)

- 서버 없이 곡을 **URL 해시**(`#song=<base64url>`)에 담는다. 격자가 불리언이라 그대로 JSON+base64면
  링크가 길어지므로 **비트로 패킹**한다(2트랙 2마디 ≈ 150자).
- 형식: `[버전][곡이름][bpm][bars][트랙수] 트랙마다{ [type][instr][muted][이름] (커스텀이면 음색7B) [격자비트] }`.
- **버전 2** = 커스텀 음색 지원. 커스텀 트랙은 음색을 7바이트로 양자화(`q8`/`dq8`): 파형1 + ADSR4 + 컷오프1 + 볼륨1.
  양자화 때문에 값이 아주 미세하게 바뀔 수 있으나 귀로는 구분 안 됨. **버전 1 링크도 계속 열린다(하위호환)** — `decodeShare`가 ver 1/2 모두 처리.
- 링크로 접속하면 `importFromHash`가 그 곡을 **새 세션으로 담고** 열고, 주소창의 코드는 `history.replaceState`로 정리한다.

---

## 규칙 · 이미 겪은 함정 (되풀이하지 말 것)

- **오디오는 사용자 제스처 뒤에만 시작된다.** 재생/미리듣기 클릭 핸들러에서 `await Tone.start()`를 먼저 부른다.
- **자동 저장은 디바운스(400ms)다.** `markDirty()`가 예약하고 `saveActive()`가 실제 저장.
  곡을 전환하기 전엔 `flushSave()`로 확실히 밀어 넣는다. **저장 직후 바로 localStorage를 읽으면 아직
  안 써져 있을 수 있다**(테스트할 때 디바운스만큼 기다릴 것 — 실제로 "직전 상태를 읽는" 착오를 겪었다).
- **첫 로드 때 빈 편집기를 저장해 곡을 덮지 않도록** `hasLoaded` 가드가 있다. `openSession`은
  `hasLoaded`일 때만 `flushSave`(나가는 곡 저장)를 부른다. 이 가드를 지우면 시작 시 활성 곡이 빈 곡으로 지워진다.
- **`[hidden]`이 `display:flex`를 이기게** `style.css` 맨 위에 `[hidden]{display:none !important}`가 있다.
  `.modal`·`.toast`에 `display:flex`를 줬는데 이게 UA의 `[hidden]{display:none}`을 이겨서
  **팝업이 항상 보이던 버그**를 막는다. 새로 `display`를 준 요소를 `hidden`으로 토글한다면 이 규칙에 기댄다.
- **해시만 바뀌는 이동은 리로드가 아니다**(위 "검증 방법" 참고). 임포트 테스트는 쿼리로 강제 리로드.
- **localStorage는 origin(도메인)마다 별개다.** localhost와 github.io는 저장이 공유되지 않는다.
  그래서 "내 곡 목록"은 기기·도메인 간 자동 동기화가 아니고, 곡 이동은 **공유 링크**로 한다.
- **드로어의 열기 버튼은 창이 아니라 햄버거에 붙인다**(창 안에 토글을 붙이면 닫힌 뒤 못 연다 — 게임 쪽에서 겪은 것과 같은 부류).
- 공유·음색은 **같은 `#modal`을 재사용**한다(`openShareModal`/`openSynthModal`이 `modalBody`를 갈아끼움).

---

## 로드맵 (완료/남음)

- [x] 1 피아노 롤 + 재생
- [x] 2 멀티 트랙(멜로디+드럼) + 곡 길이 + 왼쪽 햄버거 메뉴
- [x] 3 곡=세션 저장/전환 (localStorage 자동 저장, 왼쪽 목록)
- [x] 4 링크 공유 (다른 기기, 서버 없음)
- [x] 5 신디사이저(음색 편집): 커스텀 트랙 + 파형·ADSR·컷오프·볼륨
- [ ] ⚙️ 환경설정, 🎼 오선지 악보 보기, 📤 WAV 내보내기 (왼쪽 메뉴에 잠금으로 표시됨)
- [ ] (더 크게) 기기 간 진짜 동기화 = 서버/계정 필요 — 지금 구조(정적)에서 큰 도약

## 작업 방식

1. 기능 추가 전에 **"왜 + 어떻게"**를 먼저 설명하고 동의를 받은 뒤 코드를 쓴다.
2. 요청이 모호하면 추측하지 말고 되묻는다.
3. 새 상태는 **세션 저장(`serialize`/`deserialize`)과 공유 코덱(`encodeShare`/`decodeShare`) 양쪽**에
   반영해야 저장·공유가 깨지지 않는다. 코덱을 바꾸면 버전 바이트를 올리고 하위호환을 지킨다.
4. 주석은 "무엇"이 아니라 **"왜"**를 적는다.
