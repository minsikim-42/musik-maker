# musik-maker

**브라우저에서 여는 작곡(시퀀서) 앱.** 악기를 고르고 → 격자(피아노 롤)에 음표를 찍고 →
재생하면 곡이 흘러나온다. 곡은 "세션"처럼 저장되고, 링크로 다른 기기와 공유한다.

이 문서는 처음 이 저장소를 여는 사람/AI가 **전체 구조와 규칙을 빠르게 파악**하도록 쓴 가이드다.
대화는 한국어로 한다. 코드를 건드리기 전에 이 문서를 끝까지 읽을 것 — 특히 "규칙·이미 겪은 함정"과 "작업 방식".

> **두 기계(Windows·macOS)를 오가며 작업한다.** 손대기 전에 `git pull` 해서 최신을 받고 시작할 것.
> (원격에 사용자가 직접 올린 커밋이 로컬보다 앞서 있을 수 있다 — 실제로 겪음.) push는 fast-forward가 되게 유지한다.

---

## 한눈에

| 항목 | 값 |
|---|---|
| 종류 | 정적 웹 앱 (프레임워크·빌드 도구 없음) |
| 소리 엔진 | [Tone.js](https://tonejs.github.io/) 14.8.49 (CDN, `index.html`에서 로드) |
| 파일 | `index.html`(구조) · `style.css`(디자인) · `app.js`(로직 전부, ~2850줄) |
| 실행 | `python3 -m http.server` 후 브라우저 접속. **빌드 없음** |
| 라이브 | https://minsikim-42.github.io/musik-maker/ (GitHub Pages, `main`/root) |
| 원격 | https://github.com/minsikim-42/musik-maker (public) |
| 저장 | 브라우저 `localStorage` (곡=세션). **서버·DB·계정 없음** |
| 저장 방식 | **수동** — `💾 저장` 버튼을 눌러야 저장(자동 저장 아님) |
| 기기 간 이동 | 곡을 URL 해시에 통째로 담아 공유(자동 동기화 아님, 아래 코덱) |

**이 앱은 별도 프로젝트다.** 같은 사용자의 Unity 게임(`InuYashaProject`)과 무관하며 코드를 공유하지 않는다.
루트 대문 `minsikim-42.github.io`(별도 저장소 "sik world")에서 이 앱으로 링크한다.

---

## 실행 · 배포 · 검증

### 로컬 실행
```bash
cd musik-maker
python3 -m http.server 8000
# → http://localhost:8000  (첫 ▶ 재생/클릭 때 오디오가 켜진다: 브라우저 정책상 사용자 제스처 필요)
```

### 배포 (변경 반영)
정적 파일뿐이라 push하면 GitHub Pages가 1~2분 뒤 자동 반영한다.
```bash
git add -A && git commit -m "..." && git push
```
- 계정 인증은 `gh`(GitHub CLI). Pages 상태: `gh api repos/<owner>/musik-maker/pages/builds/latest --jq '.status'`.
- **배포 전 반드시 `index.html`의 `?v=N`(app.js·style.css 둘 다)을 올릴 것**(캐시. 아래 함정). 현재 v 번호는 `index.html`에서 확인.

### 검증 (자동 테스트 없음 — 브라우저에서 직접 확인)
에이전트라면 in-app 브라우저로: 로컬 서버 → 화면·클릭·콘솔 에러(`read_console_messages` onlyErrors) 확인.
- 내부 상태(세션 JSON, 트랙/소리 필드)·로직은 `javascript_tool`로 전역 함수를 직접 부르고 `localStorage`를 읽어 검증한다
  (대부분 전역이라 `playFrom`, `moveNudge`, `serialize()`, `finalizeSelection` 등을 직접 호출 가능).
- 오디오는 귀로 못 들으니 **`Tone.Offline`로 오프라인 렌더해 파형(피크·하드클리핑 샘플 수)** 을 재거나,
  `triggerTrack`을 래핑해 **트리거 횟수**를 세어 "소리가 나는지"를 확인한다.
- **숨은 탭에선 `Tone.Draw`(RAF)가 스로틀돼 재생 위치(playhead)가 안 움직인다** — 재생 여부는 `Tone.Transport.state`로 판별.
- 공유 코덱 round-trip은 `#song=`/`#songz=` 링크를 만들고 그 URL(쿼리로 강제 리로드)로 접속해 확인.

> **해시(`#song=...`)만 바뀌는 이동은 리로드가 아니다.** `importFromHash`는 로드 시 1회만 도므로,
> 같은 탭에서 임포트를 테스트하려면 **쿼리를 붙여**(`?r=1#song=...`) 강제 리로드한다. 다른 기기에선 새 로드라 문제없다.

---

## 코드 지도

`app.js` 한 파일에 전부 있고 `// ═══` 헤더로 섹션이 나뉜다. 위에서 아래로 의존한다.

| 섹션(대략 줄) | 핵심 | 하는 일 |
|---|---|---|
| 상수·음역 | `buildMelodyNotes` `MELODY_NOTES`(C6~C3 37줄) `DRUM_ROWS`(하이햇/스네어/킥) `beatUnit` `barBeats` `barCells()` `steps` | 음/드럼 줄 정의. **박자 = n×m**: 한 박=`beatUnit`칸(얕은 선), 한 마디=`barBeats`박(굵은 선), `steps=bars*barCells()` |
| 소리 라이브러리·프리셋 | `soundLib` `INSTRUMENT_PRESETS`(8종) `addPresetSound` `newSound` `defaultParams` `PARAM_RANGES` `findSound` `trackSound` `sampleBuffers` `loadSampleBuffer` | 곡별 커스텀 소리(신스/샘플). 트랙은 `instrument="snd:<id>"`로 참조 |
| 마스터 | `softShape` `makeMaster` `realtimeMaster` | 헤드룸(-6dB)+넓은범위 소프트클립(겹쳐도 하드클리핑/파열음 없음. "오디오 체인") |
| 악기(신스) | `createVoices` `buildSynth` `disposeSynth` `applyParamsLive` `applySoundToTracks` `triggerTrack` `preview` `setTrackVolume` `setTrackReverb` | 트랙에 맞는 Tone 노드 생성·해제, 한 스텝 울리기. 커스텀 신스는 **필터/이펙트/모듈레이션 내장**(아래 소리 모델) |
| 드럼 | `makeNoiseBurst` `makeKickBuffer` | 킥·스네어·하이햇 **셋 다 타격마다 새 `ToneBufferSource` 원샷(폴리포닉)** |
| 반칸 재생 | `HALF_STEP` `playCellsAt` | 반칸(32분음표) 노트는 `grid`를 `time`, `half`를 `time+32n`에 울린다 |
| 트랙 만들기/추가 | `makeTrackObj` `addTrack` `removeTrack`(삭제 확인) `moveTrack` `startTrackRename` `resizeAll` | 트랙 생성/삭제/순서/이름, 곡 길이·박자 변경 시 격자 리사이즈 |
| 화면 그리기 | `render` `renderTrack` `enableDragScroll` `enableCellTap` `noteAt` | 트랙 DOM. 헤더+격자. 탭=노트 찍기, 라벨 클릭=그 음 미리듣기 |
| 편집 모드 | `editMode` `setEditMode` (`body.locked`) | **시작은 잠금.** `✏️ 편집`을 켜야 노트·트랙 수정 가능(실수 편집 방지). 재생·스크롤·공유·저장·음소거는 잠금에도 허용 |
| 가로·세로 줌 | `ZOOM_WIDTHS` `zoomW` `zoomStep` · `ZOOM_HEIGHTS` `zoomH` `zoomVStep` `splitOn` `SPLIT_MIN` | 칸 너비/높이 조절(뷰 상태). `zoomW>=SPLIT_MIN`이면 **반칸(32분음표) 넣기 활성**(`.zoomed`, 가운데 분할선) |
| 노트 이동 모드(선택이동) | `enterMoveMode` `exitMoveMode` `moveDown/Move/Up` `applyDragAt` `moveNudge` `finalizeSelection` `stampBlock` `selectAllInMove` `edgeTick` | 트랙별 `✥ 선택이동` — 사각 범위 선택 → 드래그/화살표 이동, 가장자리 자동 스크롤, 확인/취소. 밖으로 밀린 노트는 잘림. `mvHalf`로 1노트↔반박자 단위 |
| 단일 노트 드래그 | (enableCellTap 안 `noteDrag*`) | 이동 모드 아니어도 **기존 노트를 눌러 드래그하면 그 노트만** 옮김(미리보기 `.note-target`) |
| 재생 | `playFrom` `togglePlay` `pausePlayback` `rebuildSequence` `highlightColumn` `updateTimeline` `setPlayhead` `markPlayheadColumn` `showEditMarker` `markEditColumn` | `Transport`+`Sequence`로 스텝을 돌며 전 트랙 동시 울림. **재생/정지(=일시정지) 버튼 하나**(아래) |
| 세션 저장소 | `serialize` `deserialize` `newSong` `openSession` `saveActive` `markDirty` `updateSaveButton` `deleteSession` `renameSession` | 곡=세션을 localStorage에. **수동 저장**(`markDirty`는 표시만, `저장` 버튼이 `saveActive`) |
| 컨트롤 배선 | `setBpm` `changeBars` `setBeatUnit` `setBarBeats` `syncTracksHorizontally` | 재생/템포/박자(박·마디)/트랙추가/공유/🔒트랙고정/줌. **곡 길이(마디)는 격자 오른쪽 끝 ＋/－** (`changeBars`) |
| 드로어+메뉴 | `MENU` `openDrawer` `showToast` | 왼쪽 "내 곡" 목록 + 기능 메뉴 |
| 링크 공유 | `encodeShare` `decodeShare` `gzipBytes` `openShareModal` `importFromHash` | 곡을 URL에 비트패킹(길면 gzip `#songz=`) |
| JSON(AI용) ★ | `songToJSON` `friendlyToData` `validateFriendlyJSON` `loadFriendlyJSON` `openJsonModal` | 곡을 **음이름 목록 JSON**으로 주고받기(AI가 곡을 읽고 쓰기 쉬움. 드롭 리포트+dry-run 검증. 아래 전용 섹션) |
| WAV 내보내기 | `exportWav` `scheduleTrackOffline` `audioBufferToWav` | `Tone.Offline` 렌더 → 16비트 PCM WAV |
| MIDI ★ | `exportMidi` `parseMidi` `midiToSongData` `loadMidiArrayBuffer` `openMidiModal` `noteNameToMidi` | 표준 SMF 직접 읽고 쓰기(라이브러리 없음). 1칸=16분음표(PPQ480→120틱), 드럼=GM 채널10. 불러오기는 32분음표에 양자화(약간 손실) |
| 오선지 악보 | `buildScoreSVG` `openScoreModal` `noteToStaff` `scoreToPng` | 격자를 5선 악보(SVG)로 + PNG 저장(멜로디만) |
| 시작 | (하단) | localStorage 로드 → 해시 임포트 or 지난 곡 or 새 곡 |

`index.html`: **sticky 상단바**(햄버거·제목 · `저장`·`편집`·`재생`·`트랙고정`·가로/세로 줌) + 타임라인 · 컨트롤 바(템포·박·마디·트랙추가·공유) · `#tracks` · `#moveBar`(이동 툴바) · `#drawer` · `#modal`(공유·소리·악보 공용) · `#toast`.

---

## 재생 (재생/정지 = 일시정지)

- **재생 버튼 하나**(`#playHere`, `togglePlay`): 멈춰 있으면 재생(라벨 `▶ 재생`), 재생 중이면 **일시정지**(라벨 `⏸ 정지`).
- **정지 = 일시정지**(`pausePlayback` → `Tone.Transport.pause()`): 위치를 유지한 채 멈춘다. 다시 재생하면 **그 자리부터 이어서**
  (핸들 안 옮겼으면 `Transport.start()`로 끊김 없이, 옮겼으면 그 위치부터 새로). `pausedStep`으로 판별.
- `Tone.Transport`=시계, `Tone.Sequence`가 스텝(0..steps-1)을 `"16n"` 간격으로 돈다. 콜백에서 **모든 트랙**의 그 열을
  `triggerTrack`으로 울리고, 반칸은 32분음표 뒤에. 구조가 바뀌면(`rebuildSequence`) 시퀀스를 다시 만든다.
- 시작은 `seq.start("+0.06")`·`Transport.start("+0.05", N*16n초)`로 살짝 뒤에서 — 시작 순간 스케줄 경합 방지.
- **타임라인**(`#timeline`, 상단바와 함께 `.topsticky` 고정): 핸들 드래그로 시작 위치 지정, 재생 중엔 `highlightColumn`이 핸들을
  진행 위치로 옮김. 핸들 위치 열은 **노란 `.playhead-col`**(`markPlayheadColumn`). **찍는 위치(편집)는 별개**: 초록 타임라인
  마커(`.tl-edit`, `showEditMarker`) + 마지막 클릭 열을 **옅은 초록 `.edit-col`**(`markEditColumn`)으로 칠함(핸들은 안 옮김).

---

## 오디오 체인 (신호 흐름)

```
각 트랙 신스/샘플러/드럼원샷 → 트랙 Volume(track.volume) → [트랙 Reverb(선택)] → 마스터[ Gain(헤드룸) → WaveShaper(소프트클립) ] → 출력
```
- **트랙 볼륨**: `createVoices`가 트랙마다 `Tone.Volume`(`vol`) 노드를 둔다. 헤더 🔊 슬라이더 → `setTrackVolume`(라이브, -30~+6dB).
- **트랙 잔향**: 트랙별 `Tone.Reverb`(`setTrackReverb`). 세션·공유(v7) 저장.
- **마스터**(`makeMaster`): ① 헤드룸(`MASTER_TRIM`=0.5, -6dB) → 정상 믹스는 천장(`softShape` 0.9) 아래라 왜곡 0.
  ② 넓은범위 소프트클립 → 무거운 믹스도 tanh로 포화. **WaveShaper는 입력 ±1 초과를 곡선 끝값에 평평히 잘라(=퍼벅)** 버리므로,
  입력을 `1/MASTER_DRIVE`(=1/6)로 축소해 넣고 곡선이 ±6까지 다루게 설계 → 아무리 겹쳐도 하드클리핑 없음. 재생·WAV 공용.
- **드럼**: 킥·스네어·하이햇 모두 **폴리포닉 원샷**(미리 구운 버퍼를 타격마다 새 `ToneBufferSource`). 모노포닉 신스는 안 씀(함정).

---

## 데이터 모델

### 세션 (곡 하나)
```js
{ id, name, updatedAt, data }   // localStorage: "musik-maker.sessions" 배열, 활성 id "musik-maker.activeId", "musik-maker.syncScroll"
```
`data` = 곡 내용(저장 대상, `serialize`):
```js
{ bpm, bars, beatUnit, barBeats, zoom, zoomV, sounds:[sound,...], tracks:[trackData,...] }
// zoom/zoomV=줌 단계(뷰). beatUnit/barBeats=박자(n×m).
```

### 소리 — `data.sounds` / 런타임 `soundLib`
```js
// 신스(커스텀): 기본형에 필터·이펙트·모듈레이션까지
{ id, name, wave, attack, decay, sustain, release, cutoff, volume,
  filterType, resonance, filterEnvAmount, filterDecay,   // 필터(로우/하이/밴드패스, 공명, 필터 엔벨로프)
  detune,                                                // 유니즌 두께(fat 오실레이터)
  distortion, bitcrush, chorus,                          // 이펙트(0=끔)
  vibrato, tremolo }                                     // 모듈레이션(0=끔)
// 오디오 샘플
{ id, name, kind:"sample", audio:<dataURL>, baseNote, baseAuto, volume }
```
- **프리셋 8종**(`INSTRUMENT_PRESETS`: 피아노·베이스·바이올린·첼로·플루트·금관·오르간·팀파니) → `addPresetSound`가 위 필드로 새 소리 생성.
- 트랙은 소리를 **id로 참조**(`instrument="snd:<id>"`) → 하나 고치면 그 소리를 쓰는 모든 트랙이 바뀜(`applySoundToTracks`, `applyParamsLive`로 즉시).
- **샘플**: `Tone.Sampler`로 음정 맞춰 재생. `baseNote`(그 파일이 원래 무슨 음)는 로드 시 **자동 감지**(`baseAuto`)·수동 수정 가능.
  디코드 버퍼는 `sampleBuffers`(비동기, 로드 전 무음 후 재생성). 세션엔 data URL(1.5MB 제한). **공유 링크엔 오디오 안 담김**(신스로 대체).

### 트랙 — `data.tracks[i]`
```js
{
  type: "melody" | "drums",   // instrument로 파생
  instrument: "piano"|"synth"|"pluck"|"bass"|"guitar"|"wind" | "snd:<id>" | null(드럼),
  name, muted, collapsed,     // collapsed=헤더만
  volume, reverb,             // 트랙 볼륨(dB)·잔향(bool)
  grid: boolean[rows][steps], // rows: 멜로디=37(C6~C3 반음), 드럼=3. steps=bars*barCells()
  half: boolean[rows][steps], // 반칸(32분음표) 노트: 칸 c의 중간에 시작
}
```
- 기본 악기: 피아노·신스·플럭·베이스=`PolySynth(Tone.Synth)`, 기타·클라리넷=`PolySynth(Tone.FMSynth)`. 커스텀 신스=`PolySynth(Tone.MonoSynth)`+이펙트 체인.
- **사운드는 트랙 헤더 드롭다운 하나로** 고른다(기본 악기 + 내 소리들 + `🎹 소리 만들기·편집…` + 드럼). 드럼↔멜로디처럼 줄 의미가 달라지는 전환은 격자를 새로 시작.
- 헤더: 접기 · 이름/✎이름변경 · ▲▼순서 · 사운드 드롭다운 · (커스텀이면)🎹음색 · 🔊볼륨 · 잔향 · **✥선택이동** · 음소거 · 삭제(확인).
- 런타임 트랙 객체엔 `id·synth·cellEls·_hscroll` 등이 붙지만 **직렬화엔 안 넣는다**(`serialize`가 골라 담음).

---

## 링크 공유 코덱 (다른 기기)

- 서버 없이 곡을 **URL 해시**에 담는다. 격자가 불리언이라 **비트 패킹**. 짧으면 `#song=<base64url>`(무압축),
  길면(>1200자) **gzip**(브라우저 `CompressionStream`) `#songz=`로 링크를 확 줄인다.
- **버전 7**(현재, `encodeShare`가 항상 씀):
  `[7][곡이름][bpm][bars] [소리수]{ [이름][음색7B] } [트랙수]{ [instr][muted][volume][reverb][이름][격자비트][반칸비트] }`.
  - **음색 7바이트 = 파형1 + ADSR4 + 컷오프1 + 볼륨1**(`q8`/`dq8` 양자화). **⚠ 확장 신스 파라미터(필터/이펙트/모듈레이션/디튠)는
    공유 코덱에 안 담긴다** — 링크로 받으면 그 값들은 기본값(0/중립). localStorage 세션엔 전부 저장됨(`serialize`).
  - 트랙 `instr`: 0~5=기본 악기(`BUILTIN`), 200=드럼, 100+idx=`sounds[idx]`. `volume`·`muted`·`reverb` 각 1바이트.
  - 멜로디 줄 수: v4+ = 37, v1~v3 = 13. **v6 반칸**: `grid` 뒤에 같은 크기 `half` 격자를 이어 붙임. **v7 잔향**: `reverb` 1바이트.
- **하위호환**: `decodeShare`가 v1~v7 모두 처리(v5 이하 `half=null`, v6 이하 `reverb=false`). 구버전 custom·13줄 멜로디는 `makeTrackObj`가 마이그레이션.
  **포맷을 또 바꾸면 버전 바이트를 올리고 옛 디코드를 남길 것.**
- 링크 접속 시 `importFromHash`가 그 곡을 **새 세션으로 담고** 열고, 주소창 코드는 `history.replaceState`로 정리.

---

## JSON 내보내기/불러오기 (AI·사람이 읽고 쓰는 포맷) ★

**AI가 곡을 만들어 주거나 읽을 때 이 포맷을 쓴다.** 왼쪽 드로어 → `📋 JSON 내보내기/불러오기 (AI용)`(`openJsonModal`).
비트 코덱(공유 링크)과 달리 **음이름 목록**이라 사람이 바로 읽고 쓴다.

```jsonc
{
  "name": "곡 이름", "bpm": 120, "bars": 2, "beatUnit": 4, "barBeats": 4,
  "steps": 32,   // 내보내기에만 붙는 정보용 힌트(=t 최댓값+1). 불러오기는 무시하고 다시 계산
  "sounds": [ /* 커스텀 소리(신스/샘플) 객체 그대로. 선택 */ ],
  "tracks": [
    { "instrument": "piano",              // 멜로디: piano|synth|pluck|bass|guitar|wind, 또는 "sound":"<소리이름>"
      "name": "멜로디", "volume": 0, "muted": false, "reverb": false,
      "notes": [ {"n":"C5","t":0}, {"n":"E5","t":4}, {"n":"G5","t":8,"h":true} ] },
    { "type": "drums", "name": "드럼",     // 드럼 트랙은 type:"drums"
      "notes": [ {"n":"킥","t":0}, {"n":"스네어","t":4}, {"n":"하이햇","t":2} ] }
  ]
}
```
- **음(note)** = `{ n: 음이름, t: 칸번호(0부터), h?: true }`. `n`은 멜로디는 `"C5"`/`"F#4"`(C6~C3), 드럼은 `킥`/`스네어`/`하이햇`
  (`DRUM_ALIASES`로 kick/snare/hihat/hh 등도 받음). `h:true`면 그 칸의 **반박자(32분음표) 뒤**에 찍힌다.
- **칸 수** = `bars * beatUnit * barBeats`(내보내기의 `steps`). 즉 `t`는 `0 ~ steps-1`. **범위 밖 `t`·모르는 음이름은 배치되지 않고 리포트에 집계된다**(아래).
- `songToJSON()`=내보내기, `friendlyToData(obj, report?)`/`loadFriendlyJSON()`=불러오기(**새 세션으로** 담고 연다). 커스텀 소리는 `sounds`에
  넣고 트랙에서 `"sound":"<그 소리 name>"`으로 참조. **오디오 샘플의 실제 오디오는 JSON에 안 담긴다**(파라미터만).
- **조용히 삼키지 않는다**: `loadFriendlyJSON`은 `{ placed, bad:[{track,n}], oob:[{track,n,t}] }` 리포트를 반환하고, 모달은
  "음 N개 배치, M개 무시(음이름 X종 인식 실패, Y개 칸 범위 초과)" 토스트를 띄운다 → **AI가 자기 실수를 즉시 인지**.
- **`validateFriendlyJSON(obj)` = 상태를 안 바꾸는 dry-run 검증**. `{ ok, placed, dropped, badNames, oob, steps, errors }` 반환.
  AI가 불러오기 전 유효성·드롭 여부를 확인하는 용도(세션·소리·격자를 만들지 않음).
- 곡을 코드로 만들어 검증할 때: `validateFriendlyJSON(obj)`로 먼저 점검하거나, `loadFriendlyJSON(obj)`를 직접 호출, 또는 모달 textarea에 붙여 "불러오기".

---

## MIDI 내보내기/불러오기 (표준 SMF, 라이브러리 없음)

왼쪽 드로어 → `🎵 MIDI 내보내기/불러오기`(`openMidiModal`). 다른 DAW와 호환되는 표준 MIDI 파일을 손으로 직접 읽고 쓴다.

- **타이밍**: 격자 1칸 = 16분음표(재생과 동일: `(60/bpm)/4`초). **PPQ 480 → 1칸=120틱, 반칸(32분음표)=+60틱**. 박자표 분모는 4분음표 고정.
- **내보내기**(`exportMidi`) — 포맷 1(지휘 트랙[템포·박자·이름] + 트랙별 1개). 노트마다 노트온/오프, 같은 틱은 오프 먼저. 멜로디는 채널 0부터(채널 10 건너뜀),
  **드럼은 GM 채널 10**(`DRUM_GM`: 킥36·스네어38·하이햇42). `downloadBlob`로 `.mid` 저장. 거의 무손실.
- **불러오기**(`parseMidi`→`midiToSongData`→`loadMidiArrayBuffer`) — VLQ·러닝스테이터스·메타(템포/이름) 파싱, 노트온만 모음. **가장 가까운 32분음표에 양자화**(약간 손실),
  채널 10=드럼(`GM_TO_DRUM`), 멜로디 음역(C3~C6=MIDI 48~84) 밖은 옥타브 이동(`midiToMelodyName`). 리포트 `{ placed, dropped, transposed }`를 토스트로 안내.
  파일 선택(사용자 제스처) 후 `openSession`이 신스를 만들므로 **`await Tone.start()` 먼저**. bars는 내용 길이로 자동(최대 64마디, 넘치면 드롭).
- **한계**: 노트 길이·벨로시티·프로그램은 왕복에서 무시(격자 모델엔 길이 개념 없음, 1칸 고정). SMPTE 타임코드 division은 미지원(에러).
- 코드로 검증: `midiToSongData(parseMidi(arrayBuffer))`로 상태 안 바꾸고 `{data, report}` 확인, 또는 `exportMidi`의 `downloadBlob`를 잠깐 가로채 blob→`parseMidi` 왕복.

---

## 규칙 · 이미 겪은 함정 (되풀이하지 말 것)

- **오디오는 사용자 제스처 뒤에만.** 재생/미리듣기/노트 탭 핸들러에서 `await Tone.start()`를 먼저. (WAV=`Tone.Offline`이라 불필요.)
- **드럼은 폴리포닉 원샷으로만.** `NoiseSynth`·`MembraneSynth`는 모노포닉이라 가까이 재트리거하면 `Start time must be strictly greater`·`RangeError`+파열음. → 미리 구운 버퍼를 타격마다 새 `ToneBufferSource`로.
- **`PolySynth`엔 Monophonic 계열만(Tone 14.8).** `Synth`/`FMSynth`/`AMSynth`/`MonoSynth`는 OK, `PluckSynth`·`NoiseSynth`는 "Voice must extend Monophonic".
- **겹칠 때 파열음/찌그러짐이면 마스터를 의심.** WaveShaper 입력 ±1 초과를 평평히 자름 → 헤드룸으로 낮추고 곡선이 넓은 범위를 다루게.
- **저장은 수동이다.** `markDirty()`는 dirty 표시만(`💾 저장 *` 파랑), `저장` 버튼이 `saveActive()`로 실제 저장. 저장 실패(용량 초과 등)면 dirty 유지+빨강 경고(속이지 않음). 곡 전환·창 닫기 때 미저장이면 `confirm`/`beforeunload`로 경고.
- **첫 로드 때 빈 편집기가 곡을 덮지 않게** `hasLoaded` 가드. `openSession`은 `hasLoaded`일 때만 미저장 확인. 이 가드를 지우면 시작 시 활성 곡이 지워진다.
- **격자 가로 스크롤이 안 되면 `min-width:0`을 의심.** `.track`은 flex 항목이라 `min-width:auto`면 격자만큼 커져 안 넘침 → `.track`/`.tracks`에 `min-width:0`.
- **격자 스크롤은 한 컨테이너(`.gridscroll`)에서 `touch-action: pan-x pan-y`.** 축을 중첩 컨테이너로 나누면 한 축이 막힌다. **이동 모드/노트 위 터치는 `touch-action:none`** 으로 스크롤 대신 선택/이동.
- **정적 배포라 캐시가 옛 버전을 붙든다.** `index.html`의 `?v=N`을 **바꿀 때마다 올린다**(app.js·style.css 둘 다).
- **`[hidden]`이 `display:flex`를 이기게** `style.css` 맨 위 `[hidden]{display:none !important}`. `.modal`·`.toast`가 flex라 없으면 팝업이 항상 보인다.
- **해시만 바뀌는 이동은 리로드가 아니다.** 임포트 테스트는 쿼리로 강제 리로드. **localStorage는 origin마다 별개**(localhost↔github.io 공유 안 됨).
- **`Start time must be strictly greater`가 localhost 로드에서 몇 개 뜰 수 있으나** 배포/실사용엔 안 나는 Tone 초기화 경합(무해). 컨텍스트 켜질 때 `RangeError`(-6.8e-13) 1~2개도 무해. **배포본 콘솔로 판별.**
- **숨은 탭에선 `Tone.Draw`(RAF)가 스로틀** — playhead가 안 움직여도 재생은 됨. 상태는 `Tone.Transport.state`로 본다.
- **상태 변수 이름이 기존 함수와 겹치지 않게.** 이동 모드 상태는 트랙 재정렬 함수 `moveTrack()`과 겹쳐 `mvTrack`으로 뒀다(SyntaxError "already declared" 겪음).
- **드로어 열기 버튼은 창이 아니라 햄버거에.** 공유·소리·악보는 **같은 `#modal` 재사용**(각 open이 `modalBody` 교체).

---

## 로드맵 (완료/남음)

- [x] 피아노 롤+재생 · 멀티 트랙+곡 길이 · 곡=세션 · 링크 공유(gzip) · WAV · 오선지
- [x] 넓은 음역(C3~C6)+세로 스크롤 · 상단 고정 재생바 · 기타·클라리넷 · 오디오 샘플 · 트랙 접기/순서/이름/볼륨/잔향
- [x] 드럼 폴리포닉 원샷 · **신디사이저 대폭 확장**(필터·이펙트·모듈레이션+프리셋 8종) · **가로·세로 줌 + 반칸(32분음표)**
- [x] **박자 n×m(박자선·마디선)** · **편집 모드(잠금)** · **노트 이동 모드(선택이동) + 단일 노트 드래그** · **재생/정지=일시정지** · 수동 저장 · **JSON 내보내기/불러오기(AI용, 드롭 리포트+dry-run 검증)** · **MIDI 내보내기/불러오기(표준 SMF)**
- [ ] ⚙️ 환경설정(왼쪽 메뉴 잠금 표시) · (더 크게) 기기 간 진짜 동기화 = 서버/계정 필요 · 멀티샘플 · 정식 오선지(음표 길이·쉼표·빔)
- [ ] (알아둘 한계) **확장 신스 파라미터·줌은 공유 코덱에 안 담김** — 담으려면 코덱 버전 올려야

## 작업 방식

1. **손대기 전 `git pull`.** 기능 추가 전엔 **"왜 + 어떻게"**를 먼저 설명·동의받고 코드. 모호하면 되묻는다.
2. **새 상태(트랙/소리 필드 등)는 `serialize`/`deserialize` + `encodeShare`/`decodeShare` 양쪽에 반영**해야 저장·공유가 안 깨진다. 코덱 바꾸면 버전 바이트↑ + 하위호환 디코드 유지.
3. 소리 품질 변경은 **오프라인 렌더로 피크/하드클리핑 측정**해 검증.
4. 변경 후 **`?v=N`↑ 배포**하고 **배포본 콘솔**로 최종 확인(localhost 콘솔엔 환경 노이즈).
5. 주석은 "무엇"이 아니라 **"왜"**.
