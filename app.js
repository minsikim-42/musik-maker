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

function disposeSynth(s) {
  if (!s) return;
  if (s.kind === "drums") { s.kick.dispose(); s.snare.dispose(); s.hat.dispose(); s.hatOut.dispose(); }
  else s.poly.dispose();
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
    name: data?.name ?? (type === "drums" ? "드럼" : "멜로디 " + trackSeq),
    muted: data?.muted ?? false,
    grid: null,
    synth: null,
    cellEls: null,
  };
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
  head.innerHTML = `<span class="kind">${track.type === "drums" ? "드럼" : "멜로디"}</span>
    <span class="name">${track.name}</span><span class="spacer"></span>`;

  if (track.type === "melody") {
    const sel = document.createElement("select");
    for (const [val, lbl] of [["piano", "피아노"], ["synth", "신스"], ["pluck", "플럭"], ["bass", "베이스"]]) {
      const o = document.createElement("option");
      o.value = val; o.textContent = lbl;
      if (track.instrument === val) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      track.instrument = sel.value;
      track.synth = buildSynth(track);
      markDirty();
    });
    head.appendChild(sel);
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
let loading = false; // 곡을 불러오는 동안 자동 저장이 끼어들지 않게

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

// 새 빈 곡의 기본 구성: 멜로디 1 + 드럼 1
function freshSongData() {
  return {
    bpm: 120,
    bars: 2,
    tracks: [
      { type: "melody", instrument: "piano", name: "멜로디 1", muted: false, grid: null },
      { type: "drums", instrument: null, name: "드럼", muted: false, grid: null },
    ],
  };
}

function newSong(switchTo = true) {
  const n = sessions.length + 1;
  const s = { id: "s" + Date.now() + Math.floor(Math.random() * 1000), name: "새 곡 " + n, updatedAt: Date.now(), data: freshSongData() };
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

function openSession(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  // 전환 전에 현재 곡을 확실히 저장
  if (saveTimer) { clearTimeout(saveTimer); saveActive(); }
  activeId = id;
  lsSet(LS_ACTIVE, id);
  deserialize(s.data);
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
document.getElementById("addMelody").addEventListener("click", () => addTrack("melody"));
document.getElementById("addDrums").addEventListener("click", () => addTrack("drums"));
document.getElementById("newSong").addEventListener("click", () => newSong(true));

// ══════════════════════════════════════════════════════════════
//  왼쪽 드로어 + 앞으로 추가할 기능
// ══════════════════════════════════════════════════════════════
const MENU = [
  { ico: "🎹", name: "신디사이저 (음색 편집)", tag: "준비 중" },
  { ico: "⚙️", name: "환경설정", tag: "준비 중" },
  { ico: "📤", name: "WAV로 내보내기", tag: "예정" },
  { ico: "🔗", name: "링크로 공유 (다른 기기)", tag: "4단계" },
  { ico: "🎼", name: "오선지 악보 보기", tag: "예정" },
];

const drawer = document.getElementById("drawer");
const scrim = document.getElementById("scrim");
const menuList = document.getElementById("menuList");
const toast = document.getElementById("toast");
let toastTimer = null;

for (const item of MENU) {
  const btn = document.createElement("button");
  btn.className = "menu-item locked";
  btn.innerHTML = `<span class="ico">${item.ico}</span>
    <span class="name">${item.name}</span>
    <span class="tag">🔒 ${item.tag}</span>`;
  btn.addEventListener("click", () => showToast(`"${item.name}"은(는) ${item.tag} — 곧 추가됩니다`));
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
//  시작
// ══════════════════════════════════════════════════════════════
loadSessionsFromStorage();
if (sessions.length === 0) {
  newSong(true);            // 처음 방문: 빈 곡 하나 만들고 연다
} else {
  const start = activeSession() ? activeId : sessions[0].id;
  openSession(start);       // 지난번 곡을 이어서 연다
}
