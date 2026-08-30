# music-maker

**브라우저에서 여는 작곡(시퀀서) 앱.** 악기를 고르고 → 격자(피아노 롤)에 음표를 찍고 →
재생하면 곡이 흘러나온다. 곡은 "세션"처럼 저장되고, 링크로 다른 기기와 공유한다.

이 문서는 처음 이 저장소를 여는 사람/AI가 **전체 구조와 규칙을 빠르게 파악**하도록 쓴 가이드다.
대화는 한국어로 한다. (사용자는 한국어로 소통한다.) 코드를 건드리기 전에 이 문서를 끝까지 읽을 것 —
특히 "규칙·이미 겪은 함정"과 "작업 방식".

---

## 한눈에

| 항목 | 값 |
|---|---|
| 종류 | 정적 웹 앱 (프레임워크·빌드 도구 없음) |
| 소리 엔진 | [Tone.js](https://tonejs.github.io/) 14.8.49 (CDN, `index.html`에서 로드) |
| 파일 | `index.html`(구조) · `style.css`(디자인) · `app.js`(로직 전부, ~1800줄) |
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

### 배포 (변경 반영)
정적 파일뿐이라 push하면 GitHub Pages가 1~2분 뒤 자동 반영한다.
```bash
git add -A && git commit -m "..." && git push
```
- 계정 인증은 `gh`(GitHub CLI)로 로그인돼 있어야 한다(`gh auth status`로 확인).
- Pages 상태: `gh api repos/<owner>/music-maker/pages/builds/latest --jq '.status'` (`built`면 완료).
- **배포 전 반드시 `index.html`의 `?v=N`(app.js·style.css)을 올릴 것**(캐시. 아래 함정 참고).

### 검증 방법 (이 프로젝트의 원칙)
자동 테스트는 없다. **브라우저에서 직접 확인한다.** 에이전트라면 in-app 브라우저로:
로컬 서버 띄우기 → 화면·클릭·콘솔 에러(`read_console_messages` onlyErrors) 확인.
내부 상태(세션 JSON, 트랙 params)나 코덱 round-trip은 `javascript_tool`로 `localStorage`를 읽어 검증한다.
오디오 품질(클리핑/파열음/음량)은 **`Tone.Offline`로 오프라인 렌더해 파형(피크·하드클리핑 샘플 수·슬루)을 측정**하는 게
가장 확실하다 — 실시간 소리를 귀로 들을 수 없으니. `encodeShare`/`decodeShare`는 전역이 아니라 직접 호출 불가 →
공유 링크를 만들고 그 URL로 접속해 복원을 확인한다.

> **주의: 해시(`#song=...`)만 바뀌는 이동은 브라우저가 페이지를 리로드하지 않는다.**
> `importFromHash`는 로드 시 1회만 도므로, 같은 탭에서 공유 링크 임포트를 테스트하려면
> **쿼리를 붙여**(`?r=1#song=...`) 강제 리로드해야 한다. 실제 다른 기기에서는 새 로드라 문제없다.

---

## 코드 지도

`app.js` 한 파일에 전부 있고 `// ═══` 헤더로 섹션이 나뉜다. 위에서 아래로 의존한다.

| 섹션 | 핵심 함수 | 하는 일 |
|---|---|---|
| 음/드럼 줄 정의 | `buildMelodyNotes` `MELODY_NOTES` `LEGACY_MELODY_NOTES` `DRUM_ROWS` | 멜로디 음역(C6~C3 37줄), 드럼 3줄(하이햇/스네어/킥) |
| 소리 라이브러리 | `soundLib` `newSound` `findSound` `trackSound` `sampleBuffers` `loadSampleBuffer` | 곡별 커스텀 소리(신스 프리셋/오디오 샘플). 트랙은 `instrument="snd:<id>"`로 참조 |
| 마스터 | `softShape` `makeMaster` `realtimeMaster` | 헤드룸(-6dB) + 넓은범위 소프트클립. 겹쳐도 하드클리핑/파열음 없음 (아래 "오디오 체인") |
| 악기(신스) | `createVoices` `buildSynth` `disposeSynth` `defaultParams` `applyParamsLive` `applySoundToTracks` `triggerTrack` `preview` `setTrackVolume` | 트랙 종류/악기에 맞는 Tone 노드 생성·해제, 한 스텝 울리기. `createVoices`는 노드만 만들고(저장/해제 안 함) 재생·WAV 렌더 양쪽에서 재사용 |
| 드럼 | `makeNoiseBurst` `makeKickBuffer` (+ createVoices drums 분기) | 킥·스네어·하이햇 **셋 다 타격마다 새 `ToneBufferSource` 원샷(폴리포닉)** — 미리 구운 버퍼 재생 |
| 트랙 만들기/추가 | `makeTrackObj` `addTrack` `removeTrack` `moveTrack` `startTrackRename` `resizeAll` `clearTracks` | 트랙 생성/추가/삭제/순서이동/이름변경, 곡 길이 변경 시 격자 리사이즈 |
| 화면 그리기 | `render` `renderTrack` `enableDragScroll` | 트랙들을 DOM으로. 헤더(접기·이름·순서·사운드·음색·볼륨·음소거·삭제) + 격자 |
| 재생 | `rebuildSequence` `highlightColumn` `clearHighlight` | `Tone.Transport`+`Tone.Sequence`로 스텝을 돌며 모든 트랙 동시 울림 |
| 세션 저장소 | `serialize` `deserialize` `newSong` `openSession` `saveActive` `markDirty` `flushSave` `deleteSession` `renameSession` `renderSessionList` | 곡=세션을 localStorage에 자동 저장, 왼쪽 목록에서 전환 |
| 컨트롤 배선 | `setBpm` `changeBars` `syncTracksHorizontally` (+익명) | 재생/정지/템포(슬라이더+숫자입력)/트랙추가/공유/🔒트랙고정. **곡 길이(마디)는 각 트랙 격자 오른쪽 끝의 ＋/－ 세로 버튼**(`changeBars`, 상한 없음·최소 1) |
| 드로어 + 메뉴 | `MENU` `openDrawer` `showToast` | 왼쪽 "내 곡" 목록 + 기능 메뉴(신디사이저·공유·WAV·오선지) |
| 링크 공유 | `encodeShare` `decodeShare` `openShareModal` `importFromHash` | 곡을 URL에 담고/풀고 |
| 신디사이저 | `openSoundManager` `openSoundEditor` `openSampleEditor` `onSampleFile` `playSoundPreview` `playSamplePreview` | 소리(프리셋/샘플) 만들기·편집·삭제 |
| WAV 내보내기 | `exportWav` `scheduleTrackOffline` `audioBufferToWav` `downloadBlob` | `Tone.Offline`로 렌더 → 16비트 PCM WAV → 다운로드 |
| 오선지 악보 | `buildScoreSVG` `openScoreModal` `noteToStaff` `scoreToPng` | 격자를 5선 악보(SVG)로 그려 보여주고 PNG로 저장(멜로디 트랙만) |
| 시작 | (하단) | localStorage 로드 → 해시 임포트 or 지난 곡 or 새 곡 |

`index.html`: **sticky 상단바**(햄버거+제목+재생/정지/🔒트랙고정), 컨트롤 바(템포·곡길이·트랙추가·공유),
`#tracks`(트랙 컨테이너), `#drawer`(세션+메뉴), `#modal`(공유·소리·악보 공용 팝업), `#toast`.
`style.css`: 다크 테마, CSS 변수로 색을 모음.

---

## 오디오 체인 (신호 흐름)

```
각 트랙 신스/샘플러/드럼원샷 → 트랙 Volume(track.volume) → 마스터[ Gain(헤드룸) → WaveShaper(소프트클립) ] → 출력
```

- **트랙 볼륨**: `createVoices`가 트랙마다 `Tone.Volume` 노드(`vol`)를 두고 그 뒤로 신스를 연결한다.
  헤더 🔊 슬라이더 → `setTrackVolume`이 그 노드를 라이브로 조절(-30~+6dB). 세션·공유 코덱에 저장.
- **마스터**(`makeMaster`): 여러 트랙이 겹쳐도 깨끗하게.
  ① **헤드룸**(`MASTER_TRIM`=0.5, -6dB): 정상 믹스(2~4트랙)가 천장(`softShape` 0.9) 아래에 머물러 **마스터가
  손대지 않음(왜곡 0)**. ② **넓은범위 소프트클립**: 무거운 믹스가 넘쳐도 tanh로 부드럽게 포화.
  **WaveShaper는 입력 ±1 초과를 곡선 끝값에 '평평하게 잘라'(=퍼벅) 버리므로**, 입력을 `1/MASTER_DRIVE`(=1/6)로
  축소해 넣고 곡선이 실제로는 ±6까지 다루게 설계한다 → 아무리 겹쳐도 하드클리핑 없음. 재생·WAV 공용.
- **드럼**: 킥·스네어·하이햇 모두 **폴리포닉 원샷**이다. 엔벨로프를 입힌 버퍼를 미리 굽고(`makeNoiseBurst`,
  `makeKickBuffer`) **타격마다 새 `ToneBufferSource`로 재생**한다. NoiseSynth·MembraneSynth 같은 모노포닉 신스는
  가까이 재트리거하면 소스/자동화 재시작이 충돌해 에러·파열음이 나서 안 쓴다(아래 함정). 스네어는 하이패스
  350Hz로 저역(폭발음)을 걷고, 하이햇은 하이패스 7000Hz.

---

## 데이터 모델

### 세션 (곡 하나)
```js
{ id, name, updatedAt, data }   // localStorage 키 "music-maker.sessions" 배열. 활성 id는 "music-maker.activeId"
```
`data` = 곡 내용(저장·공유 대상):
```js
{ bpm, bars, sounds: [ sound, ... ], tracks: [ trackData, ... ] }
```

### 소리(라이브러리) — `data.sounds` / 런타임 `soundLib`
```js
// 신스 프리셋
{ id, name, wave:"sine|triangle|square|sawtooth", attack, decay, sustain, release, cutoff, volume }
// 오디오 샘플
{ id, name, kind:"sample", audio:<dataURL>, baseNote, volume }
```
- 사용자가 신디사이저에서 만든다. 트랙은 소리를 **id로 참조**(`instrument="snd:<id>"`) → 소리 하나를 고치면
  그 소리를 쓰는 모든 트랙이 바뀐다(`applySoundToTracks`).
- 신스 프리셋 편집은 `applyParamsLive`가 `poly.set`으로 **즉시 반영**(재생성 없음). 범위는 `PARAM_RANGES`.
- **샘플**: `Tone.Sampler`로 한 샘플을 음정 맞춰 재생. 디코드 버퍼는 `sampleBuffers`(id→ToneAudioBuffer)에
  캐시(비동기 로드, 로드 전엔 무음 폴백 후 `buildSynth` 재생성). 세션엔 data URL 저장(1.5MB 제한).
  **공유 링크엔 오디오 안 담김** — `encodeShare`가 샘플을 기본 신스 파라미터로 인코딩(수신 측은 신스로 들림).
- 신디사이저 UI: **소리 관리자**(`openSoundManager`: `＋새 소리`/`🎵 오디오 파일에서`/이름변경/삭제) +
  **편집기**(신스=`openSoundEditor` 슬라이더, 샘플=`openSampleEditor` 기준음·볼륨·교체). 모두 공유 `#modal`.
  소리를 지우면 그 소리를 쓰던 트랙은 피아노로 되돌린다.

### 트랙 — `data.tracks[i]`
```js
{
  type: "melody" | "drums",   // instrument로부터 파생(드럼이면 drums)
  instrument: "piano"|"synth"|"pluck"|"bass"|"guitar"|"wind" | "snd:<id>" | null(드럼),
  name, muted,
  collapsed,                  // 헤더만 보이고 격자 숨김
  volume,                     // 트랙 볼륨 dB
  grid: boolean[rows][steps], // rows: 멜로디=37(C6~C3 반음), 드럼=3. steps = bars*16
}
```
- 기본 악기: 피아노·신스·플럭·베이스는 `PolySynth(Tone.Synth)`, **기타(통기타)·클라리넷**은 `PolySynth(Tone.FMSynth)`.
- **사운드는 트랙 헤더 드롭다운 하나로 고른다**: 기본 악기 + 내가 만든 소리들 + `🎹 소리 만들기·편집…` + 드럼.
  바꾸면 `track.instrument`가 바뀌고, **드럼↔멜로디처럼 줄 구성이 달라지는 전환은 그 트랙 격자를 새로 시작**한다
  (줄 의미가 달라 매핑 불가). 멜로디 계열 안에서 바꾸면 격자 유지.
- 헤더: **▾/▸ 접기**, 이름 + **✎ 이름변경**(`startTrackRename`), **▲/▼ 순서**(`moveTrack`), 사운드 드롭다운,
  커스텀 소리면 **🎹 음색**, **🔊 볼륨**(숫자+↺초기화), **음소거**, **삭제**. `collapsed`/`volume`은 세션 저장.
- 멜로디 격자는 넓은 음역 중 ~13줄만 보이는 스크롤 뷰(아래 "스크롤" 함정).
- 런타임 트랙 객체엔 `id`, `synth`(Tone), `cellEls`(DOM), `_hscroll`/`_scrollTop`/`_scrollLeft`가 붙지만
  **직렬화엔 안 넣는다**(`serialize`가 골라 담음). 구버전 `instrument:"custom"+params`는 로드 시 소리로 마이그레이션.

---

## 재생이 도는 방식

- `Tone.Transport`가 마스터 시계, `Tone.Sequence`가 스텝 인덱스(0..steps-1)를 `"16n"` 간격으로 돈다.
- 콜백에서 **모든 트랙**의 그 열을 모아 각 트랙 신스로 울린다(`triggerTrack`). 재생 위치는 `Tone.Draw.schedule`로 칠함.
- 구조가 바뀌면(트랙 추가/삭제, 곡 길이) `rebuildSequence`로 시퀀스를 다시 만든다.
- 재생 시작은 `seq.start("+0.06")`·`Tone.Transport.start("+0.05")`로 살짝 뒤에서 — 시작 순간 스케줄 경합 방지.

---

## 링크 공유 코덱 (다른 기기)

- 서버 없이 곡을 **URL 해시**(`#song=<base64url>`)에 담는다. 격자가 불리언이라 **비트로 패킹**(짧게 유지).
- **버전 5**(현재, `encodeShare`가 항상 씀):
  `[5][곡이름][bpm][bars] [소리수]{ [이름][음색7B] } [트랙수]{ [instr][muted][volume][이름][격자비트] }`.
  - 음색 7바이트 = 파형1 + ADSR4 + 컷오프1 + 볼륨1 (`q8`/`dq8` 양자화).
  - 트랙 `instr`: 0~5 = 기본 악기(`BUILTIN`=`[piano,synth,pluck,bass,guitar,wind]`), 200 = 드럼, 100+idx = `sounds[idx]`.
  - 트랙 `volume` 1바이트(`TRACK_VOL` 범위). 멜로디 격자 줄 수: v4+ = 37, v1~v3 = 13(`melodyRows`).
- **하위호환**: `decodeShare`가 v1~v5를 모두 처리한다(v1/v2=소리 섹션 없음, v3=멜로디 13줄, v5=볼륨 추가).
  구버전 `custom` 트랙·13줄 멜로디는 `deserialize`→`makeTrackObj`가 소리 라이브러리·새 음역으로 마이그레이션.
  **포맷을 또 바꾸면 버전 바이트를 올리고 옛 버전 디코드를 남겨 둘 것.**
- 링크 접속 시 `importFromHash`가 그 곡을 **새 세션으로 담고** 열고, 주소창 코드는 `history.replaceState`로 정리.

---

## 규칙 · 이미 겪은 함정 (되풀이하지 말 것)

- **오디오는 사용자 제스처 뒤에만 시작된다.** 재생/미리듣기 클릭 핸들러에서 `await Tone.start()`를 먼저 부른다.
  (WAV 내보내기는 `Tone.Offline`이라 제스처 불필요.)
- **드럼은 폴리포닉 원샷으로만.** `Tone.NoiseSynth`·`Tone.MembraneSynth`는 소스/자동화가 하나뿐(모노포닉)이라
  가까이 재트리거하면 재시작이 충돌해 `Start time must be strictly greater`·`RangeError` + 파열음이 난다.
  → 미리 구운 버퍼를 타격마다 새 `ToneBufferSource`로 재생(`createVoices` drums 분기). (사용자가 실제로 겪은 버그.)
- **`PolySynth`에는 Monophonic 계열만 넣는다(Tone 14.8).** `Synth`/`FMSynth`/`AMSynth`/`MonoSynth`는 되지만
  `PluckSynth`·`NoiseSynth`는 안 된다(넣으면 "Voice must extend Monophonic"). 멜로디 악기는 전부 `PolySynth(Synth/FMSynth)`.
- **여러 트랙이 겹칠 때 파열음/찌그러짐이 나면 마스터를 의심하라.** WaveShaper는 입력 ±1 초과를 곡선 끝값에
  평평하게 잘라 버린다 → 헤드룸(`MASTER_TRIM`)으로 낮추고 곡선이 넓은 범위(±`MASTER_DRIVE`)를 다루게 해야 한다.
- **자동 저장은 디바운스(400ms)다.** `markDirty()`가 예약, `saveActive()`가 저장. 곡 전환 전 `flushSave()`.
  **저장 직후 바로 localStorage를 읽으면 아직 안 써져 있을 수 있다**(테스트 때 디바운스만큼 기다릴 것).
- **첫 로드 때 빈 편집기가 곡을 덮지 않게** `hasLoaded` 가드가 있다. `openSession`은 `hasLoaded`일 때만
  `flushSave`(나가는 곡 저장). 이 가드를 지우면 시작 시 활성 곡이 빈 곡으로 지워진다.
- **격자 가로 스크롤이 안 되면 `min-width:0`을 의심하라.** `.track`은 flex 항목이라 `min-width:auto`(=min-content)로
  격자만큼 커져 스크롤 컨테이너가 안 넘친다 → `.track`/`.tracks`에 `min-width:0` 필수.
- **격자 스크롤은 한 컨테이너(`.gridscroll`, 격자는 `.grid.in-scroller`)에서 `touch-action: pan-x pan-y`로 양축 허용.**
  가로·세로를 중첩 컨테이너로 나눠 각각 한 축만 touch-action을 주면 안쪽 컨테이너가 격자를 그 축으로 제한해
  바깥 축이 터치로 안 움직인다(겪음). 가로가 안 되던 진짜 원인은 위 `min-width:0`이었다.
- **정적 배포라 캐시가 옛 버전을 붙든다.** `index.html`의 `app.js?v=N`·`style.css?v=N`을 **바꿀 때마다 N을 올린다**
  (안 올리면 브라우저·GitHub Pages가 옛 파일을 준다 — 사용자가 새로고침해야 겨우 반영되던 문제).
- **`[hidden]`이 `display:flex`를 이기게** `style.css` 맨 위에 `[hidden]{display:none !important}`. `.modal`·`.toast`가
  `display:flex`라 이게 없으면 팝업이 항상 보인다. 새로 `display`를 준 요소를 `hidden`으로 토글하면 이 규칙에 기댄다.
- **해시만 바뀌는 이동은 리로드가 아니다**(위 "검증 방법"). 임포트 테스트는 쿼리로 강제 리로드.
- **localStorage는 origin(도메인)마다 별개다.** localhost와 github.io는 저장 공유 안 됨(곡 이동은 공유 링크로).
- **`Start time must be strictly greater`가 localhost 로드에서 8개쯤 뜰 수 있는데** 배포/실제 사용자 환경엔
  안 나는 Tone 초기화 타이밍 경합이다(기능·오디오 영향 없음). 배포본 콘솔로 판별할 것. 오디오 컨텍스트가
  처음 켜질 때 `RangeError`(-6.8e-13) 1~2개도 무해(Tone 내부, 소리 영향 없음).
- **드로어의 열기 버튼은 창이 아니라 햄버거에 붙인다**(창 안에 토글을 붙이면 닫힌 뒤 못 연다).
- 공유·소리·악보는 **같은 `#modal`을 재사용**한다(각 open 함수가 `modalBody`를 갈아끼움).

---

## 로드맵 (완료/남음)

- [x] 1 피아노 롤 + 재생  ·  2 멀티 트랙 + 곡 길이 + 왼쪽 메뉴  ·  3 곡=세션 저장/전환
- [x] 4 링크 공유(다른 기기)  ·  5 신디사이저(소리 프리셋)  ·  6 WAV 내보내기
- [x] 7 마스터 소프트클립 + 오선지 악보  ·  8 넓은 음역(C3~C6) + 세로 스크롤
- [x] 9 상단 고정 재생바 + 🔒 트랙 고정  ·  10 기타·클라리넷 악기  ·  11 오디오 파일 불러오기(샘플)
- [x] 12 트랙 접기/순서/이름  ·  13 트랙별 볼륨  ·  드럼 폴리포닉 원샷 재작성(파열음 수정)
- [ ] ⚙️ 환경설정 (왼쪽 메뉴에 잠금으로 표시됨)
- [ ] (더 크게) 기기 간 진짜 동기화 = 서버/계정 필요 — 지금 구조(정적)에서 큰 도약
- [ ] (여유되면) 멀티샘플(음마다 다른 녹음), 정식 오선지(음표 길이·쉼표·빔)

## 작업 방식

1. 기능 추가 전에 **"왜 + 어떻게"**를 먼저 설명하고 동의를 받은 뒤 코드를 쓴다. 모호하면 되묻는다.
2. **새 상태(트랙/소리 필드 등)는 세션 저장(`serialize`/`deserialize`)과 공유 코덱(`encodeShare`/`decodeShare`)
   양쪽에 반영**해야 저장·공유가 안 깨진다. 코덱을 바꾸면 버전 바이트를 올리고 하위호환 디코드를 남긴다.
3. 소리 품질 변경(악기·드럼·마스터·볼륨)은 **오프라인 렌더로 피크/하드클리핑을 측정해 검증**한다.
4. 변경 후 **`?v=N`을 올리고** 배포하며, **배포본 콘솔**로 최종 확인한다(localhost 콘솔엔 환경 노이즈가 낀다).
5. 주석은 "무엇"이 아니라 **"왜"**를 적는다.
