// music-maker — 3단계: 곡을 "세션"처럼 저장/전환 (왼쪽 드로어 = 내 곡 목록)
// 세션 = 곡 하나(트랙·악기·격자·템포·마디). 브라우저 localStorage에 자동 저장된다.
// 목록에서 곡을 누르면 그 곡이 열리고, 편집하면 활성 곡에 자동 저장된다.

// ── 음/드럼 줄 정의 ─────────────────────────────────────────────
// 멜로디 음역: C6(맨 위) ~ C3(맨 아래). 격자는 이 중 일부만 보여주고 세로 스크롤한다.
function buildMelodyNotes(lowOct, highOct) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const asc = [];
  for (let o = lowOct; o <= highOct; o++) {
    for (const n of names) { asc.push(n + o); if (n === "C" && o === highOct) break; } // highOct는 C까지만
    if (o === highOct) break;
  }
  return asc.reverse(); // 위(높은 음)부터
}
const MELODY_NOTES = buildMelodyNotes(3, 6); // C6..C3 (37음)
// 예전 저장(13줄, C5..C4)을 새 음역으로 옮길 때 쓰는 기준
const LEGACY_MELODY_NOTES = ["C5", "B4", "A#4", "A4", "G#4", "G4", "F#4", "F4", "E4", "D#4", "D4", "C#4", "C4"];
const DEFAULT_TOP_NOTE = "C5"; // 기본으로 보이는 맨 윗줄(예전 화면과 같은 위치)

const DRUM_ROWS = ["하이햇", "스네어", "킥"];
const isSharp = (n) => n.includes("#");

const STEPS_PER_BAR = 16;

// ── 현재 편집 중인 곡의 런타임 상태 ─────────────────────────────
let bars = 2;
let steps = bars * STEPS_PER_BAR;
let trackSeq = 0;
const tracks = []; // { id, type, instrument, name, muted, grid, synth, cellEls }

// 커스텀 "소리(신스 프리셋)" 라이브러리 — 현재 곡의 것. 트랙은 instrument="snd:<id>"로 참조한다.
// 소리 = { id, name, wave, attack, decay, sustain, release, cutoff, volume }
let soundLib = [];
function genSoundId() { return "snd" + Date.now() + Math.floor(Math.random() * 1000); }
function findSound(id) { return soundLib.find((s) => s.id === id) || null; }
function newSound(name) {
  const s = { id: genSoundId(), name: name || ("소리 " + (soundLib.length + 1)), ...defaultParams() };
  soundLib.push(s);
  return s;
}
// 트랙이 참조하는 소리(없으면 null). 소리 객체 자체가 params 필드를 갖는다.
function trackSound(track) {
  return track.instrument && track.instrument.startsWith("snd:") ? findSound(track.instrument.slice(4)) : null;
}

// 오디오 샘플 소리: { id, name, kind:"sample", audio:<dataURL>, baseNote:"C4", volume }
// 디코드된 버퍼는 여기 캐시한다(id → Tone.ToneAudioBuffer). 로드는 비동기.
const sampleBuffers = {};
function loadSampleBuffer(sound) {
  if (!sound || sound.kind !== "sample" || !sound.audio) return;
  const cached = sampleBuffers[sound.id];
  if (cached && cached.loaded) return;
  const buf = new Tone.ToneAudioBuffer(
    sound.audio,
    () => { // 로드되면 이 소리를 쓰는 트랙 신스를 다시 만든다(폴백 → 샘플러)
      for (const t of tracks) if (t.instrument === "snd:" + sound.id) t.synth = buildSynth(t);
    },
    (e) => console.warn("샘플 로드 실패:", e)
  );
  sampleBuffers[sound.id] = buf;
}

// ══════════════════════════════════════════════════════════════
//  악기(신스)
// ══════════════════════════════════════════════════════════════
// 마스터: 여러 트랙이 겹쳐도 깨끗하게. 두 가지가 핵심이다.
//  1) 헤드룸(TRIM -6dB): 정상 믹스(2~4트랙)가 천장(0.9) 아래에 머물러 마스터가 손대지 않음(왜곡 0).
//  2) 넓은 범위 소프트 클립: 무거운 믹스가 넘쳐도 tanh로 부드럽게 포화(하드클리핑 없음).
//     WaveShaper는 입력이 ±1을 넘으면 곡선 끝값에 '평평하게 잘라'(=퍼벅) 버리므로,
//     입력을 1/DRIVE로 축소해 넣고 곡선이 실제로는 ±DRIVE까지 다루게 설계한다.
const MASTER_TRIM = 0.5;  // -6dB 헤드룸
const MASTER_DRIVE = 6;   // 소프트 클립이 다루는 입력 범위(±6까지 매끄럽게)
function softShape(s) {    // 0.9 이하는 그대로, 그 위는 tanh로 완만히 굽혀 ~1.0에서 멈춘다
  const t = 0.9, a = Math.abs(s), sg = Math.sign(s);
  return a <= t ? s : sg * (t + (1 - t) * Math.tanh((a - t) / (1 - t)));
}
function makeMaster() {
  const ws = new Tone.WaveShaper((x) => softShape(x * MASTER_DRIVE), 4096);
  ws.oversample = "2x";
  ws.toDestination();
  // pre 게인 = TRIM/DRIVE → 출력 = softShape(TRIM * 신호). 트랙은 이 게인 입력에 붙는다.
  return new Tone.Gain(MASTER_TRIM / MASTER_DRIVE).connect(ws);
}

// 재생용 마스터: 모든 트랙이 이 소프트 클리퍼를 거쳐 출력된다.
let masterNode = null;
function realtimeMaster() {
  if (!masterNode) masterNode = makeMaster();
  return masterNode;
}

const dbToGain = (db) => Math.pow(10, db / 20);
// 엔벨로프(빠른 어택 + 지수 감쇠)를 입힌 노이즈 버스트 버퍼. 시작·끝이 0이라 클릭 없음.
// 타격마다 이 버퍼로 새 ToneBufferSource를 만들어 폴리포닉하게 재생한다(드럼 파열음/충돌 방지).
function makeNoiseBurst(seconds, tau, peak) {
  const ctx = Tone.getContext().rawContext || Tone.getContext();
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * sr));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const atk = Math.max(1, Math.floor(0.001 * sr));
  for (let i = 0; i < len; i++) {
    const env = i < atk ? i / atk : Math.exp(-((i - atk) / sr) / tau);
    d[i] = (Math.random() * 2 - 1) * env * peak;
  }
  const fade = Math.min(64, len); // 끝을 확실히 0으로
  for (let k = 0; k < fade; k++) d[len - 1 - k] *= k / fade;
  return buf;
}

// 트랙에 맞는 신스 노드를 만든다(현재 Tone 컨텍스트 기준). 저장/해제는 하지 않는다.
// out = 최종 출력 노드(마스터 리미터). → 재생용(buildSynth)과 WAV 오프라인 렌더가 공유한다.
function createVoices(track, out) {
  out = out || realtimeMaster();
  // 트랙 전용 볼륨 노드: 신스 → 트랙 볼륨 → 마스터. 트랙별 소리 크기를 라이브로 조절.
  const vol = new Tone.Volume(track.volume ?? 0).connect(out);

  if (track.type === "drums") {
    const kick = new Tone.MembraneSynth().connect(vol);
    kick.volume.value = -7;
    // 스네어·하이햇: NoiseSynth는 노이즈 소스가 하나뿐(모노포닉)이라 자주 치면 소스 재시작이
    // 충돌해 'Start time must be strictly greater' 에러 + 파열음이 난다. → 타격마다 새 원샷으로(폴리포닉).
    // 엔벨로프를 입힌 노이즈 버퍼를 미리 굽고, 하이패스로 저역(폭발음)을 걷는다.
    const snareOut = new Tone.Filter(350, "highpass").connect(vol);   // 저역 제거 → 또렷한 스네어
    const hatOut = new Tone.Filter(7000, "highpass").connect(vol);    // 고역만 → 하이햇
    const snareBuf = makeNoiseBurst(0.16, 0.032, dbToGain(-6));       // 길이, 감쇠 시정수, 피크
    const hatBuf = makeNoiseBurst(0.06, 0.010, dbToGain(-13));
    const oneShot = (buf, dest, time) => {
      try {
        const src = new Tone.ToneBufferSource(buf).connect(dest);
        const t = (time == null) ? Tone.now() : Math.max(0, time);
        src.start(t);
        src.stop(t + buf.duration + 0.02); // 명시적 정지로 내부 자동정지 계산(미세 음수) 회피
        setTimeout(() => { try { src.dispose(); } catch (e) {} }, (buf.duration + 0.4) * 1000);
      } catch (e) { /* 무시 */ }
    };
    const safeKick = (time) => { try { kick.triggerAttackRelease("C1", "8n", time); } catch (e) { /* 무시 */ } };
    return {
      kind: "drums", kick, snareOut, hatOut, vol,
      hitKick: safeKick,
      hitSnare: (time) => oneShot(snareBuf, snareOut, time),
      hitHat: (time) => oneShot(hatBuf, hatOut, time),
    };
  }

  // 커스텀 소리(라이브러리 참조)
  const snd = trackSound(track);
  if (snd && snd.kind === "sample") {
    // 오디오 샘플: 한 샘플을 음정에 맞춰 재생(Tone.Sampler). 버퍼가 준비됐을 때만.
    const buf = sampleBuffers[snd.id];
    if (buf && buf.loaded) {
      const sampler = new Tone.Sampler({ urls: { [snd.baseNote || "C4"]: buf } }).connect(vol);
      sampler.volume.value = snd.volume ?? -6;
      return { kind: "melody", poly: sampler, vol }; // Sampler도 triggerAttackRelease(note,dur,time) 동일
    }
    // 아직 로딩 전 → 조용한 폴백(로드되면 loadSampleBuffer가 재생성)
    loadSampleBuffer(snd);
    const silent = new Tone.PolySynth(Tone.Synth).connect(vol);
    silent.volume.value = -60;
    return { kind: "melody", poly: silent, vol };
  }
  if (snd) {
    // 신스 소리: 사용자가 만든 음색. 로우패스 필터로 컷오프까지 조절.
    const filt = new Tone.Filter(snd.cutoff, "lowpass").connect(vol);
    const poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: snd.wave },
      envelope: { attack: snd.attack, decay: snd.decay, sustain: snd.sustain, release: snd.release },
    }).connect(filt);
    poly.volume.value = snd.volume;
    return { kind: "melody", poly, filt, vol };
  }

  // 모든 악기는 PolySynth(Tone.Synth) 기반(화음 가능). PluckSynth/NoiseSynth는 Monophonic이 아니라
  // PolySynth에 못 넣는다(Tone 14.8) — 그래서 플럭도 Synth 엔벨로프로 '뜯는 느낌'을 흉내낸다.
  let poly;
  if (track.instrument === "pluck") {
    poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.15 },
    });
  } else if (track.instrument === "guitar") {
    // 통기타: FM으로 배음 많은 뜯는 줄. 빠른 어택 + 긴 감쇠로 자연스럽게 잦아든다.
    poly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3, modulationIndex: 14,
      oscillator: { type: "sine" },
      envelope: { attack: 0.003, decay: 1.4, sustain: 0.02, release: 0.7 },
      modulation: { type: "square" },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
    });
  } else if (track.instrument === "bass") {
    poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "square" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.4 },
    });
  } else if (track.instrument === "wind") {
    // 클라리넷: FM으로 홀수 배음의 목관 소리. 부드러운 어택 + 긴 지속.
    poly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2, modulationIndex: 6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.07, decay: 0.1, sustain: 0.85, release: 0.35 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.1, decay: 0.2, sustain: 0.9, release: 0.35 },
    });
  } else if (track.instrument === "synth") {
    poly = new Tone.PolySynth(Tone.Synth);
  } else {
    poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.6 },
    });
  }
  poly.connect(vol);
  poly.volume.value = track.instrument === "wind" ? -4 : -6; // 사인은 살짝 작게 들려 보정
  return { kind: "melody", poly, vol };
}

function buildSynth(track) {
  if (track.synth) disposeSynth(track.synth);
  return createVoices(track);
}

// 커스텀 음색 기본값
function defaultParams() {
  return { wave: "sawtooth", attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.6, cutoff: 2000, volume: -8 };
}
// 소리를 편집할 때: 그 소리를 쓰는 트랙 신스에 즉시 반영(재생성 없이)
function applyParamsLive(track) {
  const s = track.synth;
  if (!s || s.kind !== "melody" || !s.poly.set) return;
  const p = trackSound(track);
  if (!p) return;
  s.poly.set({ oscillator: { type: p.wave }, envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release } });
  s.poly.volume.value = p.volume;
  if (s.filt) s.filt.frequency.value = p.cutoff;
}
// 소리 하나를 편집하면 그 소리를 쓰는 모든 트랙에 반영
function applySoundToTracks(sound) {
  for (const t of tracks) if (t.instrument === "snd:" + sound.id) applyParamsLive(t);
}

function disposeSynth(s) {
  if (!s) return;
  if (s.kind === "drums") { s.kick.dispose(); s.snareOut.dispose(); s.hatOut.dispose(); }
  else { s.poly.dispose(); if (s.filt) s.filt.dispose(); }
  if (s.vol) s.vol.dispose();
}

// 트랙 볼륨을 라이브로 조절(재생성 없이)
function setTrackVolume(track, db) {
  track.volume = db;
  if (track.synth && track.synth.vol) track.synth.vol.volume.value = db;
}

function triggerTrack(track, col, time) {
  if (track.muted) return;
  const rows = track.type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  if (track.type === "drums") {
    for (let r = 0; r < rows.length; r++) {
      if (!track.grid[r][col]) continue;
      const s = track.synth;
      if (rows[r] === "킥") s.hitKick(time);
      else if (rows[r] === "스네어") s.hitSnare(time);
      else s.hitHat(time);
    }
  } else {
    const notesOn = [];
    for (let r = 0; r < rows.length; r++) if (track.grid[r][col]) notesOn.push(rows[r]);
    if (notesOn.length) track.synth.poly.triggerAttackRelease(notesOn, "16n", time);
  }
}

function preview(track, r) {
  if (Tone.context.state !== "running") return;
  const rows = track.type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  if (track.type === "drums") {
    const s = track.synth;
    if (rows[r] === "킥") s.hitKick();
    else if (rows[r] === "스네어") s.hitSnare();
    else s.hitHat();
  } else {
    track.synth.poly.triggerAttackRelease(rows[r], "16n");
  }
}

// ══════════════════════════════════════════════════════════════
//  트랙 만들기/추가/삭제
// ══════════════════════════════════════════════════════════════
// data가 있으면(불러오기) 그 값으로, 없으면 빈 트랙으로 만든다.
function makeTrackObj(type, data) {
  const rows = type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  let instrument = data?.instrument ?? (type === "drums" ? null : "piano");
  // 구버전 마이그레이션: instrument "custom" + params → 소리 라이브러리로 옮기고 참조로 바꾼다
  if (instrument === "custom") {
    const snd = { id: genSoundId(), name: (data?.name ? data.name + " 소리" : "소리 " + (soundLib.length + 1)),
      ...defaultParams(), ...(data?.params || {}) };
    soundLib.push(snd);
    instrument = "snd:" + snd.id;
  }
  const track = {
    id: ++trackSeq,
    type,
    instrument,
    name: data?.name ?? ("트랙 " + trackSeq),
    muted: data?.muted ?? false,
    collapsed: data?.collapsed ?? false,
    volume: data?.volume ?? 0,
    grid: null,
    synth: null,
    cellEls: null,
  };
  // 격자: 빈 격자를 만들고, 저장값이 있으면 채운다.
  track.grid = rows.map(() => new Array(steps).fill(false));
  const src = data?.grid;
  if (src) {
    // 예전 저장은 멜로디가 13줄(C5..C4)이었다. 줄 수가 다르면 음이름으로 새 음역에 맞춰 옮긴다.
    const legacy = type === "melody" && src.length === LEGACY_MELODY_NOTES.length && rows.length !== src.length;
    for (let sr = 0; sr < src.length; sr++) {
      const tr = legacy ? rows.indexOf(LEGACY_MELODY_NOTES[sr]) : sr;
      if (tr < 0 || tr >= rows.length) continue;
      const savedRow = src[sr] || [];
      for (let c = 0; c < steps && c < savedRow.length; c++) track.grid[tr][c] = !!savedRow[c];
    }
  }
  track.synth = buildSynth(track);
  return track;
}

function addTrack(type) {
  tracks.push(makeTrackObj(type));
  render();
  markDirty();
}

function removeTrack(id) {
  const i = tracks.findIndex((t) => t.id === id);
  if (i < 0) return;
  disposeSynth(tracks[i].synth);
  tracks.splice(i, 1);
  render();
  markDirty();
}

// 트랙 순서 이동(위 -1 / 아래 +1)
function moveTrack(track, dir) {
  const i = tracks.indexOf(track);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tracks.length) return;
  tracks.splice(i, 1);
  tracks.splice(j, 0, track);
  render();
  markDirty();
}

// 트랙 이름 인라인 변경
function startTrackRename(head, nameSpan, renBtn, track) {
  const input = document.createElement("input");
  input.className = "t-rename";
  input.value = track.name;
  nameSpan.replaceWith(input);
  renBtn.style.display = "none";
  input.focus(); input.select();
  const commit = () => { track.name = input.value.trim() || track.name; render(); markDirty(); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") render(); });
  input.addEventListener("blur", commit);
}

function resizeAll() {
  steps = bars * STEPS_PER_BAR;
  for (const t of tracks) {
    for (let r = 0; r < t.grid.length; r++) {
      const row = t.grid[r];
      if (row.length < steps) while (row.length < steps) row.push(false);
      else row.length = steps;
    }
  }
  render();
  rebuildSequence();
  markDirty();
}

// 런타임 트랙 전부 비우기(곡 전환 시)
function clearTracks() {
  for (const t of tracks) disposeSynth(t.synth);
  tracks.length = 0;
}

// ══════════════════════════════════════════════════════════════
//  화면 그리기
// ══════════════════════════════════════════════════════════════
const tracksEl = document.getElementById("tracks");

function render() {
  tracksEl.innerHTML = "";
  for (const track of tracks) tracksEl.appendChild(renderTrack(track));
}

function renderTrack(track) {
  const rows = track.type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  const collapsed = !!track.collapsed;
  const wrap = document.createElement("section");
  wrap.className = "track" + (track.muted ? " muted" : "") + (collapsed ? " collapsed" : "");

  const head = document.createElement("div");
  head.className = "track-head";

  // 접기/펼치기 토글
  const toggle = document.createElement("button");
  toggle.className = "t-collapse";
  toggle.textContent = collapsed ? "▸" : "▾";
  toggle.title = collapsed ? "펼치기" : "접기";
  toggle.addEventListener("click", () => { track.collapsed = !track.collapsed; render(); markDirty(); });
  head.appendChild(toggle);

  // 이름 + 이름 변경(✎)
  const nameSpan = document.createElement("span");
  nameSpan.className = "name";
  nameSpan.textContent = track.name;
  head.appendChild(nameSpan);
  if (!collapsed) {
    const renBtn = document.createElement("button");
    renBtn.className = "t-icon"; renBtn.textContent = "✎"; renBtn.title = "이름 변경";
    renBtn.addEventListener("click", () => startTrackRename(head, nameSpan, renBtn, track));
    head.appendChild(renBtn);
  }

  // 순서 이동(▲▼)
  const idx = tracks.indexOf(track);
  const up = document.createElement("button");
  up.className = "t-icon"; up.textContent = "▲"; up.title = "위로";
  up.disabled = idx <= 0;
  up.addEventListener("click", () => moveTrack(track, -1));
  const down = document.createElement("button");
  down.className = "t-icon"; down.textContent = "▼"; down.title = "아래로";
  down.disabled = idx >= tracks.length - 1;
  down.addEventListener("click", () => moveTrack(track, 1));
  head.appendChild(up);
  head.appendChild(down);

  head.appendChild(Object.assign(document.createElement("span"), { className: "spacer" }));

  // 사운드(악기) 선택 — 모든 트랙 공통. 기본 악기 + 내가 만든 소리 + 드럼.
  // 드럼↔멜로디는 격자 줄 구성이 달라서 바꾸면 그 트랙의 격자는 새로 시작된다.
  const sel = document.createElement("select");
  const curVal = track.type === "drums" ? "drums" : track.instrument;
  const addOpt = (val, lbl) => {
    const o = document.createElement("option");
    o.value = val; o.textContent = lbl;
    if (val === curVal) o.selected = true;
    sel.appendChild(o);
  };
  for (const [val, lbl] of [["piano", "피아노"], ["synth", "신스"], ["pluck", "플럭"], ["bass", "베이스"], ["guitar", "기타(통기타)"], ["wind", "클라리넷"]]) addOpt(val, lbl);
  for (const snd of soundLib) addOpt("snd:" + snd.id, (snd.kind === "sample" ? "🎵 " : "🎹 ") + snd.name);
  addOpt("__manage", "🎹 소리 만들기·편집…");
  addOpt("drums", "드럼");

  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v === "__manage") { sel.value = curVal; openSoundManager(); return; } // 관리자만 열고 트랙은 그대로
    const newType = v === "drums" ? "drums" : "melody";
    if (newType !== track.type) {
      // 줄 의미가 달라지므로 격자를 새로 시작(빈 격자)
      track.type = newType;
      const nrows = newType === "drums" ? DRUM_ROWS : MELODY_NOTES;
      track.grid = nrows.map(() => new Array(steps).fill(false));
    }
    track.instrument = newType === "drums" ? null : v; // v는 기본악기 또는 "snd:<id>"
    track.synth = buildSynth(track);
    render();       // 격자·'음색' 버튼 갱신
    markDirty();
  });
  head.appendChild(sel);

  // 커스텀 소리를 쓰는 트랙이면 그 소리를 바로 편집하는 버튼(펼친 상태에서만)
  if (!collapsed && track.type === "melody" && trackSound(track)) {
    const toneBtn = document.createElement("button");
    toneBtn.textContent = "🎹 음색";
    toneBtn.addEventListener("click", () => openSoundEditor(trackSound(track)));
    head.appendChild(toneBtn);
  }

  // 트랙 볼륨(소리 크기) — 접힘/펼침 모두 표시(믹싱). 숫자 + 초기화 버튼 포함.
  const fmtDb = (v) => (v > 0 ? "+" : "") + Math.round(v) + "dB";
  const volWrap = document.createElement("div");
  volWrap.className = "t-vol";
  volWrap.title = "트랙 소리 크기";
  const volIn = document.createElement("input");
  volIn.type = "range"; volIn.min = -30; volIn.max = 6; volIn.step = 1;
  volIn.value = track.volume ?? 0;
  const volVal = document.createElement("span");
  volVal.className = "t-vol-val";
  volVal.textContent = fmtDb(track.volume ?? 0);
  volIn.addEventListener("input", () => { setTrackVolume(track, Number(volIn.value)); volVal.textContent = fmtDb(volIn.value); markDirty(); });
  const volReset = document.createElement("button");
  volReset.className = "t-icon"; volReset.textContent = "↺"; volReset.title = "볼륨 초기화 (0dB)";
  volReset.addEventListener("click", () => { volIn.value = 0; setTrackVolume(track, 0); volVal.textContent = fmtDb(0); markDirty(); });
  volWrap.appendChild(Object.assign(document.createElement("span"), { className: "t-vol-ico", textContent: "🔊" }));
  volWrap.appendChild(volIn);
  volWrap.appendChild(volVal);
  volWrap.appendChild(volReset);
  head.appendChild(volWrap);

  const muteBtn = document.createElement("button");
  muteBtn.textContent = track.muted ? "음소거 해제" : "음소거";
  muteBtn.addEventListener("click", () => { track.muted = !track.muted; render(); markDirty(); });
  head.appendChild(muteBtn);

  if (!collapsed) {
    const delBtn = document.createElement("button");
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => removeTrack(track.id));
    head.appendChild(delBtn);
  }

  wrap.appendChild(head);

  track.cellEls = [];
  if (collapsed) return wrap; // 접힘: 헤더(이름·음원·음소거·순서)만, 격자는 그리지 않음

  const grid = document.createElement("div");
  grid.className = "grid in-scroller"; // 스크롤은 바깥 hscroll/vscroll이 맡는다
  grid.style.gridTemplateColumns = `auto repeat(${steps}, 1fr)`;

  rows.forEach((rowName, r) => {
    const label = document.createElement("div");
    label.className = "label-cell" + (track.type === "melody" && isSharp(rowName) ? " sharp" : "");
    label.textContent = rowName;
    grid.appendChild(label);

    track.cellEls[r] = [];
    for (let c = 0; c < steps; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (track.type === "drums") cell.classList.add("drum");
      else if (isSharp(rowName)) cell.classList.add("black-key");
      if (c % 4 === 0) cell.classList.add("beat");
      if (track.grid[r][c]) cell.classList.add("on");
      cell.addEventListener("click", () => {
        if (grid._dragged) return; // 방금 드래그로 스크롤했으면 클릭(음 찍기) 취소
        track.grid[r][c] = !track.grid[r][c];
        cell.classList.toggle("on", track.grid[r][c]);
        if (track.grid[r][c]) preview(track, r);
        markDirty();
      });
      grid.appendChild(cell);
      track.cellEls[r][c] = cell;
    }
  });

  // 가로·세로를 한 컨테이너에서 스크롤(양축 touch-action 허용). 멜로디는 tall(세로 스크롤).
  const box = document.createElement("div");
  box.className = "gridscroll" + (track.type === "melody" ? " tall" : "");
  box.appendChild(grid);
  track._hscroll = box; // '트랙 고정' 가로 동기화 대상(같은 요소가 세로도 스크롤)
  box.addEventListener("scroll", () => {
    track._scrollTop = box.scrollTop;
    track._scrollLeft = box.scrollLeft;
    syncTracksHorizontally(box); // '트랙 고정'이 켜져 있으면 나머지 트랙 가로도 맞춘다
  });
  if (track.type === "melody") enableDragScroll(box, grid); // 마우스 세로 드래그(grid._dragged로 클릭 취소)

  const rowH = 26; // 셀 24 + 간격 2
  const defTop = track.type === "melody" ? Math.max(0, MELODY_NOTES.indexOf(DEFAULT_TOP_NOTE) * rowH) : 0;
  requestAnimationFrame(() => {
    box.scrollTop = track._scrollTop != null ? track._scrollTop : defTop;
    if (track._scrollLeft != null) box.scrollLeft = track._scrollLeft;
  });
  wrap.appendChild(box);
  return wrap;
}

// 마우스로 세로 컨테이너를 끌면 스크롤(음역 이동). 터치는 브라우저 기본 스크롤(pan-y)에 맡긴다.
// 이동 문턱(6px)을 넘으면 드래그로 보고 셀 클릭(음 찍기)을 취소한다(flagEl._dragged).
function enableDragScroll(scrollEl, flagEl) {
  let st = null;
  scrollEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return; // 터치/펜은 기본 스크롤
    st = { y: e.clientY, top: scrollEl.scrollTop, moved: false };
    flagEl._dragged = false;
  });
  scrollEl.addEventListener("pointermove", (e) => {
    if (!st) return;
    const dy = e.clientY - st.y;
    if (!st.moved && Math.abs(dy) < 6) return;
    st.moved = true;
    flagEl._dragged = true;
    scrollEl.scrollTop = st.top - dy;
    try { scrollEl.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  const end = () => {
    if (st && st.moved) setTimeout(() => { flagEl._dragged = false; }, 0);
    st = null;
  };
  scrollEl.addEventListener("pointerup", end);
  scrollEl.addEventListener("pointercancel", end);
}

// ══════════════════════════════════════════════════════════════
//  재생
// ══════════════════════════════════════════════════════════════
let seq = null;
let prevCol = -1;

function rebuildSequence() {
  if (seq) { seq.dispose(); seq = null; }
  seq = new Tone.Sequence(
    (time, col) => {
      for (const t of tracks) triggerTrack(t, col, time);
      Tone.Draw.schedule(() => highlightColumn(col), time);
    },
    [...Array(steps).keys()],
    "16n"
  );
  if (Tone.Transport.state === "started") seq.start(0);
}

function highlightColumn(col) {
  for (const t of tracks) {
    if (!t.cellEls) continue;
    for (let r = 0; r < t.cellEls.length; r++) {
      if (prevCol >= 0 && t.cellEls[r][prevCol]) t.cellEls[r][prevCol].classList.remove("playing");
      if (t.cellEls[r][col]) t.cellEls[r][col].classList.add("playing");
    }
  }
  prevCol = col;
}
function clearHighlight() {
  for (const t of tracks)
    if (t.cellEls) t.cellEls.forEach((row) => row.forEach((el) => el.classList.remove("playing")));
  prevCol = -1;
}

// ══════════════════════════════════════════════════════════════
//  세션 저장소 (곡 목록) — localStorage
// ══════════════════════════════════════════════════════════════
const LS_SESSIONS = "music-maker.sessions";
const LS_ACTIVE = "music-maker.activeId";

let sessions = [];   // [{ id, name, updatedAt, data }]
let activeId = null;
let loading = false;   // 곡을 불러오는 동안 자동 저장이 끼어들지 않게
let hasLoaded = false; // 첫 곡을 아직 안 열었으면 flushSave가 빈 편집기를 저장하지 않게

function genId() { return "s" + Date.now() + Math.floor(Math.random() * 1000); }

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch { /* 저장 불가 시 메모리에만 */ } }

function loadSessionsFromStorage() {
  const raw = lsGet(LS_SESSIONS);
  if (raw) { try { sessions = JSON.parse(raw) || []; } catch { sessions = []; } }
  activeId = lsGet(LS_ACTIVE);
}
function persistSessions() { lsSet(LS_SESSIONS, JSON.stringify(sessions)); }

// 현재 편집 상태 → 저장용 데이터
function serialize() {
  return {
    bpm: Number(bpm.value),
    bars,
    sounds: soundLib.map((s) => ({ ...s })), // 커스텀 소리 라이브러리
    tracks: tracks.map((t) => ({
      type: t.type,
      instrument: t.instrument, // 기본악기 | null(드럼) | "snd:<id>"
      name: t.name,
      muted: t.muted,
      collapsed: !!t.collapsed,
      volume: t.volume ?? 0,
      grid: t.grid.map((row) => row.slice()),
    })),
  };
}

// 저장용 데이터 → 편집 상태로 복원
function deserialize(data) {
  loading = true;
  Tone.Transport.stop();
  if (seq) seq.stop();
  clearTracks();

  // 소리 라이브러리 먼저 복원(트랙이 참조하므로). 누락 필드는 기본값으로 채운다.
  soundLib = (data.sounds || []).map((s) => ({ ...defaultParams(), ...s }));
  for (const s of soundLib) loadSampleBuffer(s); // 오디오 샘플은 미리 디코드

  bars = data.bars || 2;
  steps = bars * STEPS_PER_BAR;
  barsSel.value = String(bars);
  setBpm(data.bpm || 120, { silent: true }); // 곡 로드 시 템포 반영(저장 유발 안 함)

  for (const td of data.tracks || []) tracks.push(makeTrackObj(td.type, td));
  render();
  rebuildSequence();
  loading = false;
}

// 새 빈 곡의 기본 구성: 트랙 하나(피아노), 소리 라이브러리는 비어 있음.
function freshSongData() {
  return {
    bpm: 120,
    bars: 2,
    sounds: [],
    tracks: [
      { type: "melody", instrument: "piano", name: "트랙 1", muted: false, grid: null },
    ],
  };
}

function newSong(switchTo = true) {
  const n = sessions.length + 1;
  const s = { id: genId(), name: "새 곡 " + n, updatedAt: Date.now(), data: freshSongData() };
  sessions.unshift(s);
  persistSessions();
  if (switchTo) openSession(s.id);
  else renderSessionList();
  return s;
}

function activeSession() { return sessions.find((s) => s.id === activeId) || null; }

// 활성 곡을 현재 편집 상태로 저장(자동 저장의 핵심)
let saveTimer = null;
function markDirty() {
  if (loading) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveActive, 400); // 연속 편집을 모아 한 번에 저장
}
function saveActive() {
  const s = activeSession();
  if (!s) return;
  s.data = serialize();
  s.updatedAt = Date.now();
  // 최근 수정한 곡을 목록 맨 위로
  sessions = [s, ...sessions.filter((x) => x.id !== s.id)];
  persistSessions();
  renderSessionList();
}

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveActive();
}

function openSession(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  // 전환 전에 '나가는' 곡을 확실히 저장(첫 로드 때는 편집기가 비어 있으므로 건너뜀)
  if (hasLoaded) flushSave();
  activeId = id;
  lsSet(LS_ACTIVE, id);
  deserialize(s.data);
  hasLoaded = true;
  songNameEl.textContent = s.name;
  renderSessionList();
}

function deleteSession(id) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const removed = sessions[idx];
  sessions.splice(idx, 1);
  persistSessions();

  // 활성 곡을 지웠으면 다른 곡으로 이동(없으면 새로 하나 만든다)
  if (activeId === id) {
    if (sessions.length === 0) newSong(true);
    else openSession(sessions[0].id);
  } else {
    renderSessionList();
  }

  // 실행취소 토스트
  showToast(`「${removed.name}」 삭제됨`, "실행취소", () => {
    sessions.splice(Math.min(idx, sessions.length), 0, removed);
    persistSessions();
    renderSessionList();
  });
}

function renameSession(id, newName) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  s.name = newName.trim() || s.name;
  s.updatedAt = Date.now();
  persistSessions();
  if (id === activeId) songNameEl.textContent = s.name;
  renderSessionList();
}

// ── 세션 목록 그리기 ────────────────────────────────────────────
const sessionListEl = document.getElementById("sessionList");

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return "방금 전";
  if (s < 60) return s + "초 전";
  const m = Math.floor(s / 60); if (m < 60) return m + "분 전";
  const h = Math.floor(m / 60); if (h < 24) return h + "시간 전";
  const d = Math.floor(h / 24); return d + "일 전";
}

function renderSessionList() {
  sessionListEl.innerHTML = "";
  if (sessions.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "color:var(--muted);font-size:13px;padding:8px;";
    empty.textContent = "곡이 없습니다. ＋ 새 곡을 눌러 시작하세요.";
    sessionListEl.appendChild(empty);
    return;
  }
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "session-item" + (s.id === activeId ? " active" : "");

    const main = document.createElement("button");
    main.className = "s-main";
    main.innerHTML = `<span class="s-name">${escapeHtml(s.name)}</span><span class="s-time">${relTime(s.updatedAt)}</span>`;
    main.addEventListener("click", () => { openSession(s.id); });
    item.appendChild(main);

    // 이름 변경(인라인)
    const renameBtn = document.createElement("button");
    renameBtn.className = "s-act";
    renameBtn.textContent = "✎";
    renameBtn.title = "이름 변경";
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startInlineRename(item, main, s);
    });
    item.appendChild(renameBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "s-act";
    delBtn.textContent = "🗑";
    delBtn.title = "삭제";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteSession(s.id); });
    item.appendChild(delBtn);

    sessionListEl.appendChild(item);
  }
}

function startInlineRename(item, mainBtn, s) {
  const input = document.createElement("input");
  input.className = "s-rename";
  input.value = s.name;
  mainBtn.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => { renameSession(s.id, input.value); };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { commit(); }
    else if (e.key === "Escape") { renderSessionList(); }
  });
  input.addEventListener("blur", commit);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ══════════════════════════════════════════════════════════════
//  컨트롤 배선
// ══════════════════════════════════════════════════════════════
const bpm = document.getElementById("bpm");
const bpmNum = document.getElementById("bpmNum");
const barsSel = document.getElementById("bars");
const songNameEl = document.getElementById("songName");

// 템포 설정: 슬라이더·숫자입력을 함께 맞추고 Transport에 반영(40~220 클램프)
function setBpm(v, opts = {}) {
  v = Math.max(40, Math.min(220, Math.round(Number(v) || 120)));
  bpm.value = String(v);
  if (!opts.keepNum) bpmNum.value = String(v);
  Tone.Transport.bpm.value = v;
  if (!opts.silent) markDirty();
}

document.getElementById("play").addEventListener("click", async () => {
  await Tone.start();
  if (Tone.Transport.state === "started") return; // 이미 재생 중이면 무시(중복 시작 방지)
  Tone.Transport.bpm.value = Number(bpm.value);
  rebuildSequence();
  seq.start(0);
  Tone.Transport.start();
});
document.getElementById("stop").addEventListener("click", () => {
  Tone.Transport.stop();
  if (seq) seq.stop();
  clearHighlight();
});
bpm.addEventListener("input", () => setBpm(bpm.value));
// 숫자 입력: 타이핑 중엔 필드를 건드리지 않고(범위 내면 반영), 확정(blur/Enter) 때 클램프
bpmNum.addEventListener("input", () => {
  const n = Number(bpmNum.value);
  if (n >= 40 && n <= 220) setBpm(n, { keepNum: true });
});
bpmNum.addEventListener("change", () => setBpm(bpmNum.value));
barsSel.addEventListener("change", (e) => { bars = Number(e.target.value); resizeAll(); });
// 트랙 추가: 일단 만들고, 사운드(악기·드럼)는 트랙에서 고른다
document.getElementById("addTrack").addEventListener("click", () => addTrack("melody"));
document.getElementById("newSong").addEventListener("click", () => newSong(true));

// ── 트랙 고정(모든 트랙 가로 이동을 함께) ──────────────────────
let syncScroll = lsGet("music-maker.syncScroll") === "1";
let syncingScroll = false;
function syncTracksHorizontally(sourceHscroll) {
  if (!syncScroll || syncingScroll) return;
  syncingScroll = true;
  const x = sourceHscroll.scrollLeft;
  for (const t of tracks) if (t._hscroll && t._hscroll !== sourceHscroll) t._hscroll.scrollLeft = x;
  syncingScroll = false;
}
const syncBtn = document.getElementById("syncScroll");
function updateSyncBtn() { syncBtn.classList.toggle("active", syncScroll); }
syncBtn.addEventListener("click", () => {
  syncScroll = !syncScroll;
  updateSyncBtn();
  lsSet("music-maker.syncScroll", syncScroll ? "1" : "0");
  if (syncScroll) { // 켜는 순간 모든 트랙을 첫 트랙 위치로 맞춘다
    const first = tracks.find((t) => t._hscroll);
    if (first) syncTracksHorizontally(first._hscroll);
  }
});
updateSyncBtn();

// ══════════════════════════════════════════════════════════════
//  왼쪽 드로어 + 앞으로 추가할 기능
// ══════════════════════════════════════════════════════════════
// action이 있으면 실제로 동작하는 항목(잠금 아님), tag만 있으면 준비 중.
const MENU = [
  { ico: "🔗", name: "링크로 공유 (다른 기기)", action: () => { closeDrawer(); openShareModal(); } },
  { ico: "🎹", name: "신디사이저 (소리 만들기·편집)", action: () => { closeDrawer(); openSoundManager(); } },
  { ico: "⚙️", name: "환경설정", tag: "준비 중" },
  { ico: "📤", name: "WAV로 내보내기", action: () => { closeDrawer(); exportWav(); } },
  { ico: "🎼", name: "오선지 악보 보기", action: () => { closeDrawer(); openScoreModal(); } },
];


const drawer = document.getElementById("drawer");
const scrim = document.getElementById("scrim");
const menuList = document.getElementById("menuList");
const toast = document.getElementById("toast");
let toastTimer = null;

for (const item of MENU) {
  const btn = document.createElement("button");
  if (item.action) {
    btn.className = "menu-item";
    btn.innerHTML = `<span class="ico">${item.ico}</span>
      <span class="name">${item.name}</span>
      <span class="tag">사용 가능</span>`;
    btn.addEventListener("click", item.action);
  } else {
    btn.className = "menu-item locked";
    btn.innerHTML = `<span class="ico">${item.ico}</span>
      <span class="name">${item.name}</span>
      <span class="tag">🔒 ${item.tag}</span>`;
    btn.addEventListener("click", () => showToast(`"${item.name}"은(는) ${item.tag} — 곧 추가됩니다`));
  }
  menuList.appendChild(btn);
}

function openDrawer() {
  renderSessionList(); // 열 때마다 시간 표시 갱신
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  scrim.hidden = false;
}
function closeDrawer() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
}
document.getElementById("hamburger").addEventListener("click", openDrawer);
document.getElementById("drawerClose").addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);

// 액션 버튼(실행취소 등)을 받을 수 있는 토스트
function showToast(msg, actionLabel, onAction) {
  toast.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  toast.appendChild(span);
  if (actionLabel && onAction) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = actionLabel;
    b.addEventListener("click", () => { onAction(); toast.hidden = true; if (toastTimer) clearTimeout(toastTimer); });
    toast.appendChild(b);
  }
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), actionLabel ? 4500 : 2200);
}

// ══════════════════════════════════════════════════════════════
//  링크 공유 (다른 기기) — 곡을 URL에 통째로 담는다 (서버 없음)
// ══════════════════════════════════════════════════════════════
// 격자가 불리언이라 그대로 JSON에 담으면 링크가 너무 길어진다.
// → 비트로 패킹해 base64로 만들어 링크를 짧게 유지한다.
const INSTR_LIST = ["piano", "synth", "pluck", "bass", "custom"]; // v1/v2 레거시 디코드용
const BUILTIN = ["piano", "synth", "pluck", "bass", "guitar", "wind"]; // v3+ 기본 악기(0..)
const WAVE_LIST = ["sine", "triangle", "square", "sawtooth"];
// 커스텀 음색 파라미터를 바이트로 양자화(공유 링크에 싣기 위해). [min,max]
const PARAM_RANGES = { attack: [0, 2], decay: [0, 2], sustain: [0, 1], release: [0, 3], cutoff: [200, 8000], volume: [-30, 0] };
const q8 = (v, [lo, hi]) => Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)));
const dq8 = (b, [lo, hi]) => lo + (b / 255) * (hi - lo);

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pushName(bytes, s) {
  const nB = Array.from(new TextEncoder().encode(s || "")).slice(0, 255);
  bytes.push(nB.length, ...nB);
}
function pushSoundParams(bytes, s) {
  bytes.push(Math.max(0, WAVE_LIST.indexOf(s.wave)));
  bytes.push(q8(s.attack, PARAM_RANGES.attack));
  bytes.push(q8(s.decay, PARAM_RANGES.decay));
  bytes.push(q8(s.sustain, PARAM_RANGES.sustain));
  bytes.push(q8(s.release, PARAM_RANGES.release));
  bytes.push(q8(s.cutoff, PARAM_RANGES.cutoff));
  bytes.push(q8(s.volume, PARAM_RANGES.volume));
}

const TRACK_VOL = [-30, 6]; // 트랙 볼륨 dB 범위(공유 링크 양자화용)

// 버전 5: 트랙 볼륨 추가. (v1~v4 링크도 decodeShare가 계속 연다)
function encodeShare(name, data) {
  const bytes = [];
  bytes.push(5);
  pushName(bytes, name);
  bytes.push(Math.max(0, Math.min(255, data.bpm || 120)));
  bytes.push(data.bars);

  // 소리 라이브러리
  const sounds = data.sounds || [];
  bytes.push(sounds.length);
  for (const s of sounds) { pushName(bytes, s.name); pushSoundParams(bytes, { ...defaultParams(), ...s }); }

  // 트랙
  bytes.push(data.tracks.length);
  for (const t of data.tracks) {
    let ib;
    if (t.type === "drums") ib = 200;
    else if (t.instrument && t.instrument.startsWith("snd:")) {
      const idx = sounds.findIndex((s) => s.id === t.instrument.slice(4));
      ib = idx < 0 ? 0 : 100 + idx;
    } else ib = Math.max(0, BUILTIN.indexOf(t.instrument));
    bytes.push(ib);
    bytes.push(t.muted ? 1 : 0);
    bytes.push(q8(t.volume ?? 0, TRACK_VOL)); // v5: 트랙 볼륨
    pushName(bytes, t.name);
    // 격자 비트 패킹
    let cur = 0, nb = 0;
    for (let r = 0; r < t.grid.length; r++)
      for (let c = 0; c < t.grid[r].length; c++) {
        cur = (cur << 1) | (t.grid[r][c] ? 1 : 0);
        if (++nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
      }
    if (nb > 0) bytes.push(cur << (8 - nb));
  }
  return bytesToB64url(Uint8Array.from(bytes));
}

function decodeShare(code) {
  const b = b64urlToBytes(code);
  let i = 0;
  const readName = () => { const l = b[i++]; const s = new TextDecoder().decode(b.slice(i, i + l)); i += l; return s; };
  const readParams = () => ({
    wave: WAVE_LIST[b[i++]] || "sawtooth",
    attack: dq8(b[i++], PARAM_RANGES.attack),
    decay: dq8(b[i++], PARAM_RANGES.decay),
    sustain: dq8(b[i++], PARAM_RANGES.sustain),
    release: dq8(b[i++], PARAM_RANGES.release),
    cutoff: dq8(b[i++], PARAM_RANGES.cutoff),
    volume: dq8(b[i++], PARAM_RANGES.volume),
  });

  const ver = b[i++];
  if (![1, 2, 3, 4, 5].includes(ver)) throw new Error("알 수 없는 공유 버전");
  const name = readName();
  const bpm = b[i++];
  const bars = b[i++];
  const steps = bars * STEPS_PER_BAR;
  // 멜로디 줄 수: v4부터 음역이 넓어졌다(37줄). 그 전 링크는 13줄로 읽고 makeTrackObj가 음이름으로 옮긴다.
  const melodyRows = ver >= 4 ? MELODY_NOTES.length : LEGACY_MELODY_NOTES.length;

  // 소리 라이브러리(v3부터)
  const sounds = [];
  if (ver >= 3) {
    const sc = b[i++];
    for (let k = 0; k < sc; k++) {
      const nm = readName();
      sounds.push({ id: genSoundId(), name: nm, ...readParams() });
    }
  }

  const readGrid = (rows) => {
    const need = Math.ceil((rows * steps) / 8);
    const gb = b.slice(i, i + need); i += need;
    const grid = []; let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < steps; c++) { row.push(!!((gb[idx >> 3] >> (7 - (idx & 7))) & 1)); idx++; }
      grid.push(row);
    }
    return grid;
  };

  const n = b[i++];
  const tracks = [];
  for (let k = 0; k < n; k++) {
    if (ver >= 3) {
      const ib = b[i++];
      let type, instrument;
      if (ib === 200) { type = "drums"; instrument = null; }
      else if (ib >= 100) { type = "melody"; const snd = sounds[ib - 100]; instrument = snd ? "snd:" + snd.id : "piano"; }
      else { type = "melody"; instrument = BUILTIN[ib] || "piano"; }
      const muted = b[i++] === 1;
      const volume = ver >= 5 ? dq8(b[i++], TRACK_VOL) : 0;
      const tname = readName();
      const grid = readGrid(type === "drums" ? DRUM_ROWS.length : melodyRows);
      tracks.push({ type, instrument, name: tname, muted, volume, grid });
    } else {
      // v1/v2 레거시: [type][instr][muted][name] (v2 custom이면 음색 7B) [grid]
      const type = b[i++] === 1 ? "drums" : "melody";
      const instr = b[i++];
      const muted = b[i++] === 1;
      const tname = readName();
      let params = null;
      if (ver >= 2 && type === "melody" && INSTR_LIST[instr] === "custom") params = readParams();
      const grid = readGrid(type === "drums" ? DRUM_ROWS.length : melodyRows);
      // 레거시 custom → makeTrackObj가 소리로 마이그레이션(instrument "custom"+params 유지)
      const instrument = type === "drums" ? null : (INSTR_LIST[instr] || "piano");
      tracks.push({ type, instrument, name: tname, muted, params, grid });
    }
  }
  return { name, bpm, bars, sounds, tracks };
}

// 공유 모달
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");

function openShareModal() {
  const s = activeSession();
  if (!s) return;
  if (hasLoaded) flushSave(); // 최신 편집을 반영
  let code, url, err = null;
  try {
    code = encodeShare(s.name, s.data);
    url = location.origin + location.pathname + "#song=" + code;
  } catch (e) { err = e; }

  modalTitle.textContent = "「" + s.name + "」 공유";
  modalBody.innerHTML = "";
  if (err) {
    const p = document.createElement("p");
    p.textContent = "링크를 만들지 못했습니다: " + err.message;
    modalBody.appendChild(p);
  } else {
    const p = document.createElement("p");
    p.textContent = "이 링크를 열면 지금 이 곡이 그대로 열립니다. 나에게(카톡·메일 등) 보내 다른 기기에서 열어 보세요.";
    modalBody.appendChild(p);

    const row = document.createElement("div");
    row.className = "share-row";
    const input = document.createElement("input");
    input.className = "share-url";
    input.readOnly = true;
    input.value = url;
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "복사";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(url, input);
      copyBtn.textContent = ok ? "복사됨 ✓" : "직접 복사하세요";
      setTimeout(() => (copyBtn.textContent = "복사"), 1800);
    });
    row.appendChild(input);
    row.appendChild(copyBtn);
    modalBody.appendChild(row);

    // 오디오 샘플이 있으면 링크에 안 담긴다는 안내
    if (soundLib.some((s) => s.kind === "sample")) {
      const sn = document.createElement("p");
      sn.className = "share-note";
      sn.textContent = "⚠ 오디오 샘플 소리는 용량이 커서 링크에 담기지 않습니다. 링크를 연 기기에서는 그 소리가 신스 소리로 대체됩니다.";
      modalBody.appendChild(sn);
    }

    // localhost면 다른 기기에서 안 열린다는 안내
    if (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) || location.protocol === "file:") {
      const note = document.createElement("p");
      note.className = "share-note";
      note.textContent = "⚠ 지금은 이 컴퓨터에서만 열리는 주소(localhost)입니다. 다른 기기에서 열려면 앱을 공개 주소(예: GitHub Pages)에 올려야 합니다. 링크의 #song= 뒤 코드는 그대로 옮겨서 씁니다.";
      modalBody.appendChild(note);
    }
  }
  modal.hidden = false;
}
function closeModal() { modal.hidden = true; }

// ── 신디사이저: 소리 관리자 + 음색 편집기 ─────────────────────
const WAVE_LABEL = { sine: "사인 ∿", triangle: "삼각 △", square: "사각 ⊓", sawtooth: "톱니 ◺" };

// 소리 목록 관리자: 추가/편집/이름변경/삭제
function openSoundManager() {
  modalTitle.textContent = "🎹 소리 (신디사이저)";
  modalBody.innerHTML = "";

  const intro = document.createElement("p");
  intro.textContent = "소리를 만들어 트랙에 끼울 수 있어요. 소리를 누르면 음색을 편집합니다. 만든 소리는 저장·공유에 함께 담깁니다.";
  modalBody.appendChild(intro);

  const addBtn = document.createElement("button");
  addBtn.className = "new-song"; // 전체폭 강조 버튼 스타일 재사용
  addBtn.textContent = "＋ 새 소리";
  addBtn.addEventListener("click", () => { const s = newSound(); markDirty(); render(); openSoundEditor(s); });
  modalBody.appendChild(addBtn);

  // 오디오 파일에서 소리 만들기
  const upRow = document.createElement("div");
  upRow.className = "share-row";
  const upBtn = document.createElement("button");
  upBtn.textContent = "🎵 오디오 파일에서";
  upBtn.style.flex = "1";
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "audio/*"; fileInput.style.display = "none";
  fileInput.addEventListener("change", (e) => { onSampleFile(e.target.files && e.target.files[0]); e.target.value = ""; });
  upBtn.addEventListener("click", () => fileInput.click());
  upRow.appendChild(upBtn);
  upRow.appendChild(fileInput);
  modalBody.appendChild(upRow);

  const list = document.createElement("div");
  list.className = "session-list";
  if (soundLib.length === 0) {
    const e = document.createElement("p");
    e.style.cssText = "color:var(--muted);font-size:13px;padding:8px;";
    e.textContent = "아직 만든 소리가 없습니다. ＋ 새 소리를 눌러 만들어 보세요.";
    list.appendChild(e);
  }
  for (const snd of soundLib) {
    const item = document.createElement("div");
    item.className = "session-item";
    const main = document.createElement("button");
    main.className = "s-main";
    const usedBy = tracks.filter((t) => t.instrument === "snd:" + snd.id).length;
    const usedTxt = usedBy ? ` · 트랙 ${usedBy}개 사용` : "";
    const sub = snd.kind === "sample"
      ? `오디오 샘플 · 기준 ${snd.baseNote || "C4"}${usedTxt}`
      : `${WAVE_LABEL[snd.wave] || snd.wave} · 컷오프 ${Math.round(snd.cutoff)}Hz${usedTxt}`;
    main.innerHTML = `<span class="s-name">${snd.kind === "sample" ? "🎵" : "🎹"} ${escapeHtml(snd.name)}</span>
      <span class="s-time">${sub}</span>`;
    main.addEventListener("click", () => openSoundEditor(snd));
    item.appendChild(main);

    const ren = document.createElement("button");
    ren.className = "s-act"; ren.textContent = "✎"; ren.title = "이름 변경";
    ren.addEventListener("click", (e) => { e.stopPropagation(); startSoundRename(item, main, snd); });
    item.appendChild(ren);

    const del = document.createElement("button");
    del.className = "s-act"; del.textContent = "🗑"; del.title = "삭제";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteSound(snd); });
    item.appendChild(del);

    list.appendChild(item);
  }
  modalBody.appendChild(list);
  modal.hidden = false;
}

function startSoundRename(item, mainBtn, snd) {
  const input = document.createElement("input");
  input.className = "s-rename";
  input.value = snd.name;
  mainBtn.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    snd.name = input.value.trim() || snd.name;
    markDirty(); render(); openSoundManager();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") openSoundManager();
  });
  input.addEventListener("blur", commit);
}

function deleteSound(snd) {
  soundLib = soundLib.filter((s) => s.id !== snd.id);
  // 이 소리를 쓰던 트랙은 피아노로 되돌린다
  for (const t of tracks) if (t.instrument === "snd:" + snd.id) { t.instrument = "piano"; t.synth = buildSynth(t); }
  markDirty(); render(); openSoundManager();
  showToast(`「${snd.name}」 삭제됨`);
}

// 오디오 파일 → 샘플 소리
function onSampleFile(file) {
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) { showToast("오디오 파일이 너무 큽니다 (1.5MB 이하)"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const name = (file.name || "샘플").replace(/\.[^.]+$/, "").slice(0, 40) || "샘플";
    const s = { id: genSoundId(), name, kind: "sample", audio: reader.result, baseNote: "C4", volume: -6 };
    soundLib.push(s);
    loadSampleBuffer(s);
    markDirty(); render();
    openSoundEditor(s);
  };
  reader.onerror = () => showToast("오디오 파일을 읽지 못했습니다");
  reader.readAsDataURL(file);
}

// 소리 편집기 진입 — 샘플이면 전용 편집기로
function openSoundEditor(sound) {
  if (sound.kind === "sample") return openSampleEditor(sound);
  modalTitle.textContent = "🎹 " + sound.name;
  modalBody.innerHTML = "";

  const back = document.createElement("button");
  back.textContent = "‹ 소리 목록";
  back.style.marginBottom = "10px";
  back.addEventListener("click", openSoundManager);
  modalBody.appendChild(back);

  const intro = document.createElement("p");
  intro.textContent = "슬라이더를 움직이면 이 소리를 쓰는 트랙에 바로 반영됩니다. 미리듣기로 확인하세요.";
  modalBody.appendChild(intro);

  const waveRow = document.createElement("div");
  waveRow.className = "wave-row";
  for (const w of WAVE_LIST) {
    const b = document.createElement("button");
    b.className = "wave-btn" + (sound.wave === w ? " on" : "");
    b.textContent = WAVE_LABEL[w];
    b.addEventListener("click", () => {
      sound.wave = w;
      waveRow.querySelectorAll(".wave-btn").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      applySoundToTracks(sound); markDirty(); playSoundPreview(sound);
    });
    waveRow.appendChild(b);
  }
  addField("파형", waveRow);

  slider("어택 (시작 빠르기)", "attack", 0, 2, 0.005, "s", (v) => v.toFixed(3));
  slider("디케이 (감쇠)", "decay", 0, 2, 0.005, "s", (v) => v.toFixed(3));
  slider("서스테인 (지속 크기)", "sustain", 0, 1, 0.01, "", (v) => v.toFixed(2));
  slider("릴리스 (여운)", "release", 0, 3, 0.01, "s", (v) => v.toFixed(2));
  slider("컷오프 (밝기)", "cutoff", 200, 8000, 10, "Hz", (v) => Math.round(v));
  slider("볼륨", "volume", -30, 0, 1, "dB", (v) => Math.round(v));

  const btnRow = document.createElement("div");
  btnRow.className = "share-row";
  const prev = document.createElement("button");
  prev.textContent = "▶ 미리듣기";
  prev.addEventListener("click", () => playSoundPreview(sound));
  const reset = document.createElement("button");
  reset.textContent = "기본값";
  reset.addEventListener("click", () => {
    Object.assign(sound, defaultParams());
    applySoundToTracks(sound); markDirty();
    openSoundEditor(sound); // 슬라이더 위치 갱신
    playSoundPreview(sound);
  });
  btnRow.appendChild(prev);
  btnRow.appendChild(reset);
  modalBody.appendChild(btnRow);

  modal.hidden = false;

  function addField(label, control) {
    const wrap = document.createElement("label");
    wrap.className = "synth-field";
    const head = document.createElement("div");
    head.className = "synth-label";
    head.textContent = label;
    wrap.appendChild(head);
    wrap.appendChild(control);
    modalBody.appendChild(wrap);
  }
  function slider(label, key, min, max, step, unit, fmt) {
    const control = document.createElement("div");
    control.className = "synth-slider";
    const input = document.createElement("input");
    input.type = "range";
    input.min = min; input.max = max; input.step = step;
    input.value = sound[key];
    const val = document.createElement("span");
    val.className = "synth-val";
    val.textContent = fmt(sound[key]) + unit;
    input.addEventListener("input", () => {
      sound[key] = Number(input.value);
      val.textContent = fmt(sound[key]) + unit;
      applySoundToTracks(sound); markDirty();
    });
    control.appendChild(input);
    control.appendChild(val);
    addField(label, control);
  }
}

// 소리 미리듣기: 그 소리로 임시 신스를 만들어 짧은 코드 한 번
async function playSoundPreview(sound) {
  await Tone.start();
  const filt = new Tone.Filter(sound.cutoff, "lowpass").connect(realtimeMaster());
  const poly = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: sound.wave },
    envelope: { attack: sound.attack, decay: sound.decay, sustain: sound.sustain, release: sound.release },
  }).connect(filt);
  poly.volume.value = sound.volume;
  poly.triggerAttackRelease(["C4", "E4", "G4"], "8n");
  setTimeout(() => { poly.dispose(); filt.dispose(); }, 1500);
}

// ── 오디오 샘플 소리 편집기 ────────────────────────────────────
const SAMPLE_BASE_NOTES = ["C3", "E3", "G3", "A3", "C4", "E4", "G4", "A4", "C5"];
function rebuildTracksUsing(sound) {
  for (const t of tracks) if (t.instrument === "snd:" + sound.id) t.synth = buildSynth(t);
}
function openSampleEditor(sound) {
  modalTitle.textContent = "🎵 " + sound.name;
  modalBody.innerHTML = "";

  const back = document.createElement("button");
  back.textContent = "‹ 소리 목록"; back.style.marginBottom = "10px";
  back.addEventListener("click", openSoundManager);
  modalBody.appendChild(back);

  const intro = document.createElement("p");
  intro.textContent = "불러온 오디오를 음정에 맞춰 재생합니다. '기준 음'은 이 파일이 원래 내는 음(그 음에서 원본 그대로 나고, 다른 음은 올리거나 내려서 냅니다).";
  modalBody.appendChild(intro);

  // 기준 음
  const baseWrap = document.createElement("label");
  baseWrap.className = "synth-field";
  baseWrap.innerHTML = `<div class="synth-label">기준 음</div>`;
  const baseSel = document.createElement("select");
  for (const n of SAMPLE_BASE_NOTES) {
    const o = document.createElement("option"); o.value = n; o.textContent = n;
    if ((sound.baseNote || "C4") === n) o.selected = true;
    baseSel.appendChild(o);
  }
  baseSel.addEventListener("change", () => { sound.baseNote = baseSel.value; rebuildTracksUsing(sound); markDirty(); });
  baseWrap.appendChild(baseSel);
  modalBody.appendChild(baseWrap);

  // 볼륨
  const volWrap = document.createElement("label");
  volWrap.className = "synth-field";
  volWrap.innerHTML = `<div class="synth-label">볼륨</div>`;
  const volCtl = document.createElement("div"); volCtl.className = "synth-slider";
  const vol = document.createElement("input");
  vol.type = "range"; vol.min = -30; vol.max = 6; vol.step = 1; vol.value = sound.volume ?? -6;
  const volVal = document.createElement("span"); volVal.className = "synth-val"; volVal.textContent = (sound.volume ?? -6) + "dB";
  vol.addEventListener("input", () => { sound.volume = Number(vol.value); volVal.textContent = sound.volume + "dB"; rebuildTracksUsing(sound); markDirty(); });
  volCtl.appendChild(vol); volCtl.appendChild(volVal);
  volWrap.appendChild(volCtl);
  modalBody.appendChild(volWrap);

  // 버튼: 미리듣기 · 다른 파일로 교체
  const btnRow = document.createElement("div");
  btnRow.className = "share-row";
  const prev = document.createElement("button");
  prev.textContent = "▶ 미리듣기";
  prev.addEventListener("click", () => playSamplePreview(sound));
  const replace = document.createElement("button");
  replace.textContent = "다른 파일로 교체";
  const fin = document.createElement("input");
  fin.type = "file"; fin.accept = "audio/*"; fin.style.display = "none";
  fin.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (f.size > 1.5 * 1024 * 1024) { showToast("오디오 파일이 너무 큽니다 (1.5MB 이하)"); return; }
    const rd = new FileReader();
    rd.onload = () => { sound.audio = rd.result; delete sampleBuffers[sound.id]; loadSampleBuffer(sound); rebuildTracksUsing(sound); markDirty(); showToast("오디오 교체됨"); };
    rd.readAsDataURL(f);
  });
  replace.addEventListener("click", () => fin.click());
  btnRow.appendChild(prev); btnRow.appendChild(replace); btnRow.appendChild(fin);
  modalBody.appendChild(btnRow);

  const note = document.createElement("p");
  note.className = "share-note";
  note.textContent = "⚠ 오디오 파일은 용량이 커서 공유 링크에는 담기지 않습니다(공유하면 이 소리는 신스 소리로 대체됩니다). 이 브라우저에는 저장됩니다.";
  modalBody.appendChild(note);

  modal.hidden = false;
}

async function playSamplePreview(sound) {
  await Tone.start();
  const buf = sampleBuffers[sound.id];
  if (!buf || !buf.loaded) { showToast("샘플을 불러오는 중입니다…"); return; }
  const sampler = new Tone.Sampler({ urls: { [sound.baseNote || "C4"]: buf } }).connect(realtimeMaster());
  sampler.volume.value = sound.volume ?? -6;
  sampler.triggerAttackRelease(["C4", "E4", "G4"], 0.8);
  setTimeout(() => sampler.dispose(), 2200);
}

async function copyText(text, inputEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 폴백: 입력창 선택 후 execCommand
    try {
      inputEl.focus(); inputEl.select();
      return document.execCommand("copy");
    } catch { return false; }
  }
}

document.getElementById("modalClose").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.getElementById("share").addEventListener("click", openShareModal);

// ══════════════════════════════════════════════════════════════
//  WAV로 내보내기 — 오프라인 렌더링 후 파일 다운로드 (서버 없음)
// ══════════════════════════════════════════════════════════════
// 한 트랙의 모든 음을 절대 시각(초)으로 오프라인 신스에 예약한다.
function scheduleTrackOffline(track, voices, secondsPerStep) {
  if (track.muted) return;
  const rows = track.type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  for (let c = 0; c < steps; c++) {
    const time = c * secondsPerStep + 0.001; // 0에 딱 붙이면 첫 음이 씹혀서 살짝 민다
    if (track.type === "drums") {
      for (let r = 0; r < rows.length; r++) {
        if (!track.grid[r][c]) continue;
        if (rows[r] === "킥") voices.hitKick(time);
        else if (rows[r] === "스네어") voices.hitSnare(time);
        else voices.hitHat(time);
      }
    } else {
      const notes = [];
      for (let r = 0; r < rows.length; r++) if (track.grid[r][c]) notes.push(rows[r]);
      if (notes.length) voices.poly.triggerAttackRelease(notes, secondsPerStep, time);
    }
  }
}

// AudioBuffer → 16비트 PCM WAV Blob
function audioBufferToWav(buf) {
  const numCh = buf.numberOfChannels;
  const sampleRate = buf.sampleRate;
  const frames = buf.length;
  const blockAlign = numCh * 2;
  const dataSize = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  let p = 0;
  const wStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); };
  const wU32 = (v) => { view.setUint32(p, v, true); p += 4; };
  const wU16 = (v) => { view.setUint16(p, v, true); p += 2; };
  wStr("RIFF"); wU32(36 + dataSize); wStr("WAVE");
  wStr("fmt "); wU32(16); wU16(1); wU16(numCh); wU32(sampleRate); wU32(sampleRate * blockAlign); wU16(blockAlign); wU16(16);
  wStr("data"); wU32(dataSize);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true); p += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

let exporting = false;
async function exportWav() {
  if (exporting) return;
  const anyNote = tracks.some((t) => t.grid.some((row) => row.some(Boolean)));
  if (!anyNote) { showToast("먼저 음을 찍어 주세요"); return; }
  exporting = true;
  showToast("WAV 만드는 중…");
  try {
    const secondsPerStep = (60 / Number(bpm.value)) / 4; // 16분음표 길이
    const duration = steps * secondsPerStep + 2;         // 뒤에 여운 2초
    const buffer = await Tone.Offline(() => {
      // 콜백 안에서 만든 Tone 노드는 오프라인 컨텍스트에 붙는다(재생용 신스는 안 건드림)
      const out = makeMaster(); // 재생과 동일한 마스터 소프트 클리퍼
      for (const t of tracks) scheduleTrackOffline(t, createVoices(t, out), secondsPerStep);
    }, duration);
    const audioBuf = buffer.get ? buffer.get() : buffer; // ToneAudioBuffer → AudioBuffer
    const blob = audioBufferToWav(audioBuf);
    const s = activeSession();
    const base = (s ? s.name : "song").replace(/[\\/:*?"<>|]+/g, "_").trim() || "song";
    console.log("[wav]", base + ".wav", blob.size, "bytes", duration.toFixed(2) + "s");
    downloadBlob(blob, base + ".wav");
    showToast("WAV 내보내기 완료 ✓");
  } catch (e) {
    console.error("WAV 내보내기 실패:", e);
    showToast("WAV 내보내기 실패: " + e.message);
  } finally {
    exporting = false;
  }
}

// ══════════════════════════════════════════════════════════════
//  오선지 악보 보기 — 격자를 5선 악보(SVG)로 그린다 (읽기 전용 + PNG 저장)
// ══════════════════════════════════════════════════════════════
// 높은음자리표 기준. 음이름 → 오선 위치(diatonic step). B4를 가운데 줄(0)로 둔다.
const LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
function noteToStaff(note) {
  const sharp = note.includes("#");
  const octave = parseInt(note[note.length - 1], 10);
  const dia = octave * 7 + LETTER_IDX[note[0]];
  return { staffStep: dia - 34, sharp }; // B4 = 0 (가운데 줄)
}
function soundLabel(track) {
  const s = trackSound(track);
  if (s) return "🎹 " + s.name;
  return { piano: "피아노", synth: "신스", pluck: "플럭", bass: "베이스" }[track.instrument] || track.instrument;
}

// 곡 전체를 하나의 SVG로(멜로디 트랙을 위아래로 쌓음). 흰 바탕·검은 음표(인쇄용).
function buildScoreSVG() {
  const gap = 12, clefW = 46, stepW = 18, blockH = 214; // 넓어진 음역(C3~C6)을 담도록 키움
  const width = clefW + steps * stepW + 24;
  const melodyTracks = tracks.filter((t) => t.type !== "drums");
  const height = Math.max(1, melodyTracks.length) * blockH + 12;
  const esc = (s) => escapeHtml(String(s));
  let body = "";

  melodyTracks.forEach((track, ti) => {
    const top = 12 + ti * blockH;
    const midY = top + 110;                     // 가운데 줄(B4) — 위아래 여유
    const staffTop = midY - 2 * gap;            // 맨 위 줄(F5)
    const yFor = (s) => midY - s * (gap / 2);
    const lineYs = [4, 2, 0, -2, -4].map(yFor);
    const yTop = yFor(4), yBot = yFor(-4);

    // 트랙 이름 + 악기
    body += `<text x="8" y="${top + 20}" font-family="sans-serif" font-size="13" fill="#111">${esc(track.name)} · ${esc(soundLabel(track))}</text>`;
    // 5선
    for (const y of lineYs) body += `<line x1="${clefW}" y1="${y}" x2="${width - 10}" y2="${y}" stroke="#111" stroke-width="1"/>`;
    // 높은음자리표
    body += `<text x="${clefW - 40}" y="${yBot + 3}" font-family="serif" font-size="${gap * 4.2}" fill="#111">𝄞</text>`;
    // 시작 세로줄
    body += `<line x1="${clefW}" y1="${yTop}" x2="${clefW}" y2="${yBot}" stroke="#111" stroke-width="1.4"/>`;
    // 박자/마디 세로줄
    for (let step = 1; step <= steps; step++) {
      const x = clefW + step * stepW;
      if (step % 16 === 0) body += `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="#111" stroke-width="1.4"/>`;
      else if (step % 4 === 0) body += `<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yBot}" stroke="#ccc" stroke-width="1"/>`;
    }
    // 마디 번호
    for (let m = 0; m * 16 < steps; m++) {
      const x = clefW + m * 16 * stepW + 3;
      body += `<text x="${x}" y="${yTop - 5}" font-family="sans-serif" font-size="10" fill="#888">${m + 1}</text>`;
    }
    // 음표
    for (let c = 0; c < steps; c++) {
      for (let r = 0; r < MELODY_NOTES.length; r++) {
        if (!track.grid[r][c]) continue;
        const { staffStep, sharp } = noteToStaff(MELODY_NOTES[r]);
        const cx = clefW + c * stepW + stepW / 2;
        const cy = yFor(staffStep);
        // 보조선(오선 밖 음): 아래로 벗어난 짝수 칸마다
        if (staffStep <= -6) for (let k = -6; k >= staffStep; k -= 2) body += `<line x1="${cx - 9}" y1="${yFor(k)}" x2="${cx + 9}" y2="${yFor(k)}" stroke="#111" stroke-width="1"/>`;
        if (staffStep >= 6) for (let k = 6; k <= staffStep; k += 2) body += `<line x1="${cx - 9}" y1="${yFor(k)}" x2="${cx + 9}" y2="${yFor(k)}" stroke="#111" stroke-width="1"/>`;
        // 기둥(가운데 줄 아래는 위로, 위는 아래로)
        if (staffStep < 0) body += `<line x1="${cx + 5.5}" y1="${cy}" x2="${cx + 5.5}" y2="${cy - 30}" stroke="#111" stroke-width="1.3"/>`;
        else body += `<line x1="${cx - 5.5}" y1="${cy}" x2="${cx - 5.5}" y2="${cy + 30}" stroke="#111" stroke-width="1.3"/>`;
        // 머리
        body += `<ellipse cx="${cx}" cy="${cy}" rx="6" ry="4.2" fill="#111"/>`;
        // 올림표
        if (sharp) body += `<text x="${cx - 17}" y="${cy + 5}" font-family="serif" font-size="16" fill="#111">♯</text>`;
      }
    }
  });

  if (melodyTracks.length === 0) body += `<text x="20" y="46" font-family="sans-serif" font-size="14" fill="#111">멜로디 트랙이 없습니다.</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>${body}</svg>`;
  return { svg, drumCount: tracks.filter((t) => t.type === "drums").length };
}

function openScoreModal() {
  const { svg, drumCount } = buildScoreSVG();
  modalTitle.textContent = "🎼 악보";
  modalBody.innerHTML = "";

  const intro = document.createElement("p");
  intro.textContent = "지금 곡을 오선지로 본 모습입니다. 음표 세로 위치 = 음높이, 가로 = 시간(세로줄 = 마디). 읽기 전용.";
  modalBody.appendChild(intro);

  const scroll = document.createElement("div");
  scroll.style.cssText = "overflow-x:auto; background:#fff; border:1px solid var(--line); border-radius:8px; padding:6px;";
  scroll.innerHTML = svg;
  modalBody.appendChild(scroll);

  if (drumCount > 0) {
    const note = document.createElement("p");
    note.style.cssText = "font-size:12px; margin-top:10px;";
    note.textContent = `※ 드럼 트랙 ${drumCount}개는 오선지 악보에 표시하지 않습니다(타악기는 표기 방식이 다름).`;
    modalBody.appendChild(note);
  }

  const btnRow = document.createElement("div");
  btnRow.className = "share-row";
  btnRow.style.marginTop = "12px";
  const png = document.createElement("button");
  png.textContent = "📷 PNG로 저장";
  png.addEventListener("click", () => scoreToPng(scroll.querySelector("svg")));
  btnRow.appendChild(png);
  modalBody.appendChild(btnRow);

  modal.hidden = false;
}

// SVG 악보 → PNG (흰 바탕). 인쇄·공유용.
function scoreToPng(svgEl) {
  if (!svgEl) return;
  const w = svgEl.width.baseVal.value, h = svgEl.height.baseVal.value;
  const xml = new XMLSerializer().serializeToString(svgEl);
  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((b) => {
      const s = activeSession();
      const base = (s ? s.name : "score").replace(/[\\/:*?"<>|]+/g, "_").trim() || "score";
      downloadBlob(b, base + "_악보.png");
      showToast("악보 PNG 저장 완료 ✓");
    }, "image/png");
  };
  img.onerror = () => showToast("PNG 변환 실패");
  img.src = src;
}

// 링크(#song=...)로 들어왔으면 새 곡으로 가져온다
function importFromHash() {
  const m = (location.hash || "").match(/^#song=(.+)$/);
  if (!m) return null;
  try {
    const d = decodeShare(m[1]);
    const s = { id: genId(), name: d.name || "공유받은 곡", updatedAt: Date.now(),
      data: { bpm: d.bpm, bars: d.bars, sounds: d.sounds || [], tracks: d.tracks } };
    sessions.unshift(s);
    persistSessions();
    history.replaceState(null, "", location.pathname); // 주소창의 코드 정리
    return s.id;
  } catch (e) {
    console.warn("공유 링크 해석 실패:", e);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  시작
// ══════════════════════════════════════════════════════════════
loadSessionsFromStorage();
const importedId = importFromHash();
if (importedId) {
  openSession(importedId);          // 공유 링크로 들어옴 → 그 곡을 연다
  setTimeout(() => showToast("공유받은 곡을 내 곡 목록에 담았습니다"), 300);
} else if (sessions.length === 0) {
  newSong(true);                    // 처음 방문: 빈 곡 하나 만들고 연다
} else {
  openSession(activeSession() ? activeId : sessions[0].id); // 지난번 곡 이어서
}
