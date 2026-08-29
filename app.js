// music-maker — 3단계: 곡을 "세션"처럼 저장/전환 (왼쪽 드로어 = 내 곡 목록)
// 세션 = 곡 하나(트랙·악기·격자·템포·마디). 브라우저 localStorage에 자동 저장된다.
// 목록에서 곡을 누르면 그 곡이 열리고, 편집하면 활성 곡에 자동 저장된다.

// ── 음/드럼 줄 정의 ─────────────────────────────────────────────
const MELODY_NOTES = [
  "C5", "B4", "A#4", "A4", "G#4", "G4", "F#4",
  "F4", "E4", "D#4", "D4", "C#4", "C4",
];
const DRUM_ROWS = ["하이햇", "스네어", "킥"];
const isSharp = (n) => n.includes("#");

const STEPS_PER_BAR = 16;

// ── 현재 편집 중인 곡의 런타임 상태 ─────────────────────────────
let bars = 2;
let steps = bars * STEPS_PER_BAR;
let trackSeq = 0;
const tracks = []; // { id, type, instrument, name, muted, grid, synth, cellEls }

// ══════════════════════════════════════════════════════════════
//  악기(신스)
// ══════════════════════════════════════════════════════════════
function buildSynth(track) {
  if (track.synth) disposeSynth(track.synth);

  if (track.type === "drums") {
    const kick = new Tone.MembraneSynth().toDestination();
    const snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
    }).toDestination();
    const hatOut = new Tone.Filter(7000, "highpass").toDestination();
    const hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
    }).connect(hatOut);
    kick.volume.value = -4; snare.volume.value = -10; hat.volume.value = -14;
    return { kind: "drums", kick, snare, hat, hatOut };
  }

  // 커스텀: 사용자가 만든 음색(파라미터). 로우패스 필터를 거쳐 컷오프까지 조절.
  if (track.instrument === "custom") {
    const p = track.params || defaultParams();
    const filt = new Tone.Filter(p.cutoff, "lowpass").toDestination();
    const poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: p.wave },
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
    }).connect(filt);
    poly.volume.value = p.volume;
    return { kind: "melody", poly, filt };
  }

  let poly;
  if (track.instrument === "pluck") {
    poly = new Tone.PolySynth(Tone.PluckSynth);
  } else if (track.instrument === "bass") {
    poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "square" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.4 },
    });
  } else if (track.instrument === "synth") {
    poly = new Tone.PolySynth(Tone.Synth);
  } else {
    poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.6 },
    });
  }
  poly.toDestination();
  poly.volume.value = -6;
  return { kind: "melody", poly };
}

// 커스텀 음색 기본값
function defaultParams() {
  return { wave: "sawtooth", attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.6, cutoff: 2000, volume: -8 };
}
// 편집기에서 슬라이더를 움직일 때: 트랙 신스에 즉시 반영(재생성 없이)
function applyParamsLive(track) {
  const s = track.synth;
  if (!s || s.kind !== "melody" || !s.poly.set) return;
  const p = track.params;
  s.poly.set({ oscillator: { type: p.wave }, envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release } });
  s.poly.volume.value = p.volume;
  if (s.filt) s.filt.frequency.value = p.cutoff;
}

function disposeSynth(s) {
  if (!s) return;
  if (s.kind === "drums") { s.kick.dispose(); s.snare.dispose(); s.hat.dispose(); s.hatOut.dispose(); }
  else { s.poly.dispose(); if (s.filt) s.filt.dispose(); }
}

function triggerTrack(track, col, time) {
  if (track.muted) return;
  const rows = track.type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  if (track.type === "drums") {
    for (let r = 0; r < rows.length; r++) {
      if (!track.grid[r][col]) continue;
      const s = track.synth;
      if (rows[r] === "킥") s.kick.triggerAttackRelease("C1", "8n", time);
      else if (rows[r] === "스네어") s.snare.triggerAttackRelease("16n", time);
      else s.hat.triggerAttackRelease("32n", time);
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
    if (rows[r] === "킥") s.kick.triggerAttackRelease("C1", "8n");
    else if (rows[r] === "스네어") s.snare.triggerAttackRelease("16n");
    else s.hat.triggerAttackRelease("32n");
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
  const track = {
    id: ++trackSeq,
    type,
    instrument: data?.instrument ?? (type === "drums" ? null : "piano"),
    name: data?.name ?? ("트랙 " + trackSeq),
    muted: data?.muted ?? false,
    // 커스텀 음색 파라미터(악기가 custom일 때만 의미. 저장된 값이 있으면 채운다)
    params: data?.params ? { ...defaultParams(), ...data.params } : null,
    grid: null,
    synth: null,
    cellEls: null,
  };
  if (track.instrument === "custom" && !track.params) track.params = defaultParams();
  // 격자: 저장된 값이 있으면 현재 steps에 맞춰 정규화, 없으면 빈 격자
  track.grid = rows.map((_, r) => {
    const row = new Array(steps).fill(false);
    const saved = data?.grid?.[r];
    if (saved) for (let c = 0; c < steps && c < saved.length; c++) row[c] = !!saved[c];
    return row;
  });
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
  const wrap = document.createElement("section");
  wrap.className = "track" + (track.muted ? " muted" : "");

  const head = document.createElement("div");
  head.className = "track-head";
  head.innerHTML = `<span class="name">${track.name}</span><span class="spacer"></span>`;

  // 사운드(악기) 선택 — 모든 트랙 공통. '드럼'도 하나의 사운드다.
  // 드럼↔멜로디는 격자 줄 구성이 달라서 바꾸면 그 트랙의 격자는 새로 시작된다.
  const sel = document.createElement("select");
  const SOUNDS = [["piano", "피아노"], ["synth", "신스"], ["pluck", "플럭"], ["bass", "베이스"], ["custom", "커스텀 🎹"], ["drums", "드럼"]];
  const curVal = track.type === "drums" ? "drums" : track.instrument;
  for (const [val, lbl] of SOUNDS) {
    const o = document.createElement("option");
    o.value = val; o.textContent = lbl;
    if (val === curVal) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    const v = sel.value;
    const newType = v === "drums" ? "drums" : "melody";
    if (newType !== track.type) {
      // 줄 의미가 달라지므로 격자를 새로 시작(빈 격자)
      track.type = newType;
      const nrows = newType === "drums" ? DRUM_ROWS : MELODY_NOTES;
      track.grid = nrows.map(() => new Array(steps).fill(false));
    }
    track.instrument = newType === "drums" ? null : v;
    if (track.instrument === "custom" && !track.params) track.params = defaultParams();
    track.synth = buildSynth(track);
    render();       // 격자·'음색' 버튼 갱신
    markDirty();
  });
  head.appendChild(sel);

  // 커스텀 음색일 때만 음색 편집 버튼
  if (track.type === "melody" && track.instrument === "custom") {
    const toneBtn = document.createElement("button");
    toneBtn.textContent = "🎹 음색";
    toneBtn.addEventListener("click", () => openSynthModal(track));
    head.appendChild(toneBtn);
  }

  const muteBtn = document.createElement("button");
  muteBtn.textContent = track.muted ? "음소거 해제" : "음소거";
  muteBtn.addEventListener("click", () => { track.muted = !track.muted; render(); markDirty(); });
  head.appendChild(muteBtn);

  const delBtn = document.createElement("button");
  delBtn.textContent = "삭제";
  delBtn.addEventListener("click", () => removeTrack(track.id));
  head.appendChild(delBtn);

  wrap.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "grid";
  grid.style.gridTemplateColumns = `auto repeat(${steps}, 1fr)`;

  track.cellEls = [];
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
        track.grid[r][c] = !track.grid[r][c];
        cell.classList.toggle("on", track.grid[r][c]);
        if (track.grid[r][c]) preview(track, r);
        markDirty();
      });
      grid.appendChild(cell);
      track.cellEls[r][c] = cell;
    }
  });

  wrap.appendChild(grid);
  return wrap;
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
    tracks: tracks.map((t) => ({
      type: t.type,
      instrument: t.instrument,
      name: t.name,
      muted: t.muted,
      params: t.instrument === "custom" && t.params ? { ...t.params } : null,
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

  bars = data.bars || 2;
  steps = bars * STEPS_PER_BAR;
  barsSel.value = String(bars);
  bpm.value = String(data.bpm || 120);
  bpmVal.textContent = bpm.value;
  Tone.Transport.bpm.value = Number(bpm.value);

  for (const td of data.tracks || []) tracks.push(makeTrackObj(td.type, td));
  render();
  rebuildSequence();
  loading = false;
}

// 새 빈 곡의 기본 구성: 트랙 하나(피아노). 사운드는 트랙에서 바꾼다.
function freshSongData() {
  return {
    bpm: 120,
    bars: 2,
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
const bpmVal = document.getElementById("bpmVal");
const barsSel = document.getElementById("bars");
const songNameEl = document.getElementById("songName");

document.getElementById("play").addEventListener("click", async () => {
  await Tone.start();
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
bpm.addEventListener("input", () => {
  bpmVal.textContent = bpm.value;
  Tone.Transport.bpm.value = Number(bpm.value);
  markDirty();
});
barsSel.addEventListener("change", (e) => { bars = Number(e.target.value); resizeAll(); });
// 트랙 추가: 일단 만들고, 사운드(악기·드럼)는 트랙에서 고른다
document.getElementById("addTrack").addEventListener("click", () => addTrack("melody"));
document.getElementById("newSong").addEventListener("click", () => newSong(true));

// ══════════════════════════════════════════════════════════════
//  왼쪽 드로어 + 앞으로 추가할 기능
// ══════════════════════════════════════════════════════════════
// action이 있으면 실제로 동작하는 항목(잠금 아님), tag만 있으면 준비 중.
const MENU = [
  { ico: "🔗", name: "링크로 공유 (다른 기기)", action: () => { closeDrawer(); openShareModal(); } },
  { ico: "🎹", name: "신디사이저 (음색 편집)", action: () => { closeDrawer(); openSynthFromMenu(); } },
  { ico: "⚙️", name: "환경설정", tag: "준비 중" },
  { ico: "📤", name: "WAV로 내보내기", tag: "예정" },
  { ico: "🎼", name: "오선지 악보 보기", tag: "예정" },
];

// 메뉴에서 열면: 커스텀 트랙이 있으면 그 음색을, 없으면 안내
function openSynthFromMenu() {
  const custom = tracks.find((t) => t.type === "melody" && t.instrument === "custom");
  if (custom) openSynthModal(custom);
  else showToast("멜로디 트랙 악기를 '커스텀 🎹'으로 바꾸면 음색을 편집할 수 있어요");
}

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
const INSTR_LIST = ["piano", "synth", "pluck", "bass", "custom"];
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

function encodeShare(name, data) {
  const bytes = [];
  bytes.push(2); // 버전 2: 커스텀 음색 파라미터 지원(v1은 커스텀 없음, 하위호환)
  const nameB = Array.from(new TextEncoder().encode(name)).slice(0, 255);
  bytes.push(nameB.length, ...nameB);
  bytes.push(Math.max(0, Math.min(255, data.bpm || 120)));
  bytes.push(data.bars);
  bytes.push(data.tracks.length);
  for (const t of data.tracks) {
    bytes.push(t.type === "drums" ? 1 : 0);
    const instr = t.type === "drums" ? 0 : Math.max(0, INSTR_LIST.indexOf(t.instrument));
    bytes.push(instr);
    bytes.push(t.muted ? 1 : 0);
    const tnB = Array.from(new TextEncoder().encode(t.name)).slice(0, 255);
    bytes.push(tnB.length, ...tnB);
    // 커스텀 음색: 파라미터 7바이트(파형 + ADSR + 컷오프 + 볼륨)
    if (t.type === "melody" && t.instrument === "custom") {
      const p = { ...defaultParams(), ...(t.params || {}) };
      bytes.push(Math.max(0, WAVE_LIST.indexOf(p.wave)));
      bytes.push(q8(p.attack, PARAM_RANGES.attack));
      bytes.push(q8(p.decay, PARAM_RANGES.decay));
      bytes.push(q8(p.sustain, PARAM_RANGES.sustain));
      bytes.push(q8(p.release, PARAM_RANGES.release));
      bytes.push(q8(p.cutoff, PARAM_RANGES.cutoff));
      bytes.push(q8(p.volume, PARAM_RANGES.volume));
    }
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
  const ver = b[i++];
  if (ver !== 1 && ver !== 2) throw new Error("알 수 없는 공유 버전");
  const nlen = b[i++];
  const name = new TextDecoder().decode(b.slice(i, i + nlen)); i += nlen;
  const bpm = b[i++];
  const bars = b[i++];
  const steps = bars * STEPS_PER_BAR;
  const n = b[i++];
  const tracks = [];
  for (let k = 0; k < n; k++) {
    const type = b[i++] === 1 ? "drums" : "melody";
    const instr = b[i++];
    const muted = b[i++] === 1;
    const tnlen = b[i++];
    const tname = new TextDecoder().decode(b.slice(i, i + tnlen)); i += tnlen;
    // 커스텀 음색 파라미터(v2에서, 커스텀 멜로디 트랙만)
    let params = null;
    if (ver >= 2 && type === "melody" && INSTR_LIST[instr] === "custom") {
      params = {
        wave: WAVE_LIST[b[i++]] || "sawtooth",
        attack: dq8(b[i++], PARAM_RANGES.attack),
        decay: dq8(b[i++], PARAM_RANGES.decay),
        sustain: dq8(b[i++], PARAM_RANGES.sustain),
        release: dq8(b[i++], PARAM_RANGES.release),
        cutoff: dq8(b[i++], PARAM_RANGES.cutoff),
        volume: dq8(b[i++], PARAM_RANGES.volume),
      };
    }
    const rows = type === "drums" ? DRUM_ROWS.length : MELODY_NOTES.length;
    const total = rows * steps;
    const need = Math.ceil(total / 8);
    const gb = b.slice(i, i + need); i += need;
    const grid = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < steps; c++) {
        const bit = (gb[idx >> 3] >> (7 - (idx & 7))) & 1;
        row.push(!!bit); idx++;
      }
      grid.push(row);
    }
    tracks.push({ type, instrument: type === "drums" ? null : (INSTR_LIST[instr] || "piano"), name: tname, muted, params, grid });
  }
  return { name, bpm, bars, tracks };
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

// ── 신디사이저(음색 편집) 모달 ─────────────────────────────────
function openSynthModal(track) {
  if (!track.params) track.params = defaultParams();
  const p = track.params;

  modalTitle.textContent = "🎹 「" + track.name + "」 음색";
  modalBody.innerHTML = "";

  const intro = document.createElement("p");
  intro.textContent = "슬라이더를 움직이면 소리에 바로 반영됩니다. 미리듣기로 확인하세요. (저장·공유에도 함께 담깁니다)";
  modalBody.appendChild(intro);

  // 파형 고르기
  const waveRow = document.createElement("div");
  waveRow.className = "wave-row";
  const WAVE_LABEL = { sine: "사인 ∿", triangle: "삼각 △", square: "사각 ⊓", sawtooth: "톱니 ◺" };
  for (const w of WAVE_LIST) {
    const b = document.createElement("button");
    b.className = "wave-btn" + (p.wave === w ? " on" : "");
    b.textContent = WAVE_LABEL[w];
    b.addEventListener("click", () => {
      p.wave = w;
      waveRow.querySelectorAll(".wave-btn").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      applyParamsLive(track); markDirty(); playPreview(track);
    });
    waveRow.appendChild(b);
  }
  addField("파형", waveRow);

  // ADSR + 필터 + 볼륨 슬라이더
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
  prev.addEventListener("click", () => playPreview(track));
  const reset = document.createElement("button");
  reset.textContent = "기본값";
  reset.addEventListener("click", () => {
    track.params = defaultParams();
    applyParamsLive(track); markDirty();
    openSynthModal(track); // 슬라이더 위치 갱신
    playPreview(track);
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
    input.value = p[key];
    const val = document.createElement("span");
    val.className = "synth-val";
    val.textContent = fmt(p[key]) + unit;
    input.addEventListener("input", () => {
      p[key] = Number(input.value);
      val.textContent = fmt(p[key]) + unit;
      applyParamsLive(track); markDirty();
    });
    control.appendChild(input);
    control.appendChild(val);
    addField(label, control);
  }
}

// 커스텀 트랙 음색 미리듣기: 짧은 코드 한 번
async function playPreview(track) {
  await Tone.start();
  if (track.synth && track.synth.poly) {
    track.synth.poly.triggerAttackRelease(["C4", "E4", "G4"], "8n");
  }
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

// 링크(#song=...)로 들어왔으면 새 곡으로 가져온다
function importFromHash() {
  const m = (location.hash || "").match(/^#song=(.+)$/);
  if (!m) return null;
  try {
    const d = decodeShare(m[1]);
    const s = { id: genId(), name: d.name || "공유받은 곡", updatedAt: Date.now(),
      data: { bpm: d.bpm, bars: d.bars, tracks: d.tracks } };
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
