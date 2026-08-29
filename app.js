// music-maker — 2단계: 여러 악기 트랙 동시 재생 + 곡 길이 + 왼쪽 메뉴
// 트랙 = 악기 하나 + 자기 격자. 멜로디 트랙은 음높이 격자, 드럼 트랙은 킥·스네어·하이햇.
// 하나의 타임라인이 모든 트랙을 같은 스텝에서 함께 울린다.

// ── 음/드럼 줄 정의 ─────────────────────────────────────────────
// 위(높은 음) → 아래(낮은 음). 반음 포함 13줄.
const MELODY_NOTES = [
  "C5", "B4", "A#4", "A4", "G#4", "G4", "F#4",
  "F4", "E4", "D#4", "D4", "C#4", "C4",
];
const DRUM_ROWS = ["하이햇", "스네어", "킥"]; // 위→아래
const isSharp = (n) => n.includes("#");

const STEPS_PER_BAR = 16;
let bars = 2;
let steps = bars * STEPS_PER_BAR;

let trackSeq = 0; // 트랙 id 발급용
const tracks = []; // { id, type, instrument, name, muted, grid, synth, cellEls }

// ── 악기(신스) 만들기 ───────────────────────────────────────────
function buildSynth(track) {
  if (track.synth) disposeSynth(track.synth);

  if (track.type === "drums") {
    // 드럼은 소리마다 다른 합성기를 쓴다.
    const kick = new Tone.MembraneSynth().toDestination();
    const snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
    }).toDestination();
    // 하이햇: 짧은 노이즈를 하이패스로 걸러 '틱' 소리로
    const hatOut = new Tone.Filter(7000, "highpass").toDestination();
    const hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
    }).connect(hatOut);
    kick.volume.value = -4; snare.volume.value = -10; hat.volume.value = -14;
    return { kind: "drums", kick, snare, hat, hatOut };
  }

  // 멜로디: 여러 음이 동시에 나도록 PolySynth
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
    // "피아노" 느낌
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
  if (s.kind === "drums") {
    s.kick.dispose(); s.snare.dispose(); s.hat.dispose(); s.hatOut.dispose();
  } else {
    s.poly.dispose();
  }
}

// 한 트랙의 한 스텝을 울린다
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

// 음 하나 미리듣기(클릭 시)
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

// ── 트랙 추가/삭제 ─────────────────────────────────────────────
function addTrack(type) {
  const rows = type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  const track = {
    id: ++trackSeq,
    type,
    instrument: type === "drums" ? null : "piano",
    name: type === "drums" ? "드럼" : "멜로디 " + trackSeq,
    muted: false,
    grid: rows.map(() => new Array(steps).fill(false)),
    synth: null,
    cellEls: null,
  };
  track.synth = buildSynth(track);
  tracks.push(track);
  render();
}

function removeTrack(id) {
  const i = tracks.findIndex((t) => t.id === id);
  if (i < 0) return;
  disposeSynth(tracks[i].synth);
  tracks.splice(i, 1);
  render();
}

// 곡 길이 바뀌면 모든 트랙의 격자 폭을 맞춘다(기존 음은 보존)
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
}

// ── 화면 그리기 ─────────────────────────────────────────────────
const tracksEl = document.getElementById("tracks");

function render() {
  tracksEl.innerHTML = "";
  for (const track of tracks) tracksEl.appendChild(renderTrack(track));
}

function renderTrack(track) {
  const rows = track.type === "drums" ? DRUM_ROWS : MELODY_NOTES;

  const wrap = document.createElement("section");
  wrap.className = "track" + (track.muted ? " muted" : "");

  // 헤더
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
    });
    head.appendChild(sel);
  }

  const muteBtn = document.createElement("button");
  muteBtn.textContent = track.muted ? "음소거 해제" : "음소거";
  muteBtn.addEventListener("click", () => {
    track.muted = !track.muted;
    render();
  });
  head.appendChild(muteBtn);

  const delBtn = document.createElement("button");
  delBtn.textContent = "삭제";
  delBtn.addEventListener("click", () => removeTrack(track.id));
  head.appendChild(delBtn);

  wrap.appendChild(head);

  // 격자
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
      });
      grid.appendChild(cell);
      track.cellEls[r][c] = cell;
    }
  });

  wrap.appendChild(grid);
  return wrap;
}

// ── 재생 ────────────────────────────────────────────────────────
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

// ── 컨트롤 배선 ─────────────────────────────────────────────────
const bpm = document.getElementById("bpm");
const bpmVal = document.getElementById("bpmVal");

document.getElementById("play").addEventListener("click", async () => {
  await Tone.start(); // 사용자 클릭이 있어야 오디오 시작
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
});
document.getElementById("bars").addEventListener("change", (e) => {
  bars = Number(e.target.value);
  resizeAll();
});
document.getElementById("addMelody").addEventListener("click", () => addTrack("melody"));
document.getElementById("addDrums").addEventListener("click", () => addTrack("drums"));

// ── 왼쪽 메뉴(드로어) ───────────────────────────────────────────
// 앞으로 추가할 기능 목록. done=false면 아직 준비 중(잠금).
const MENU = [
  { ico: "🎹", name: "신디사이저 (음색 편집)", tag: "준비 중" },
  { ico: "⚙️", name: "환경설정", tag: "준비 중" },
  { ico: "💾", name: "저장 / 불러오기", tag: "3단계" },
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

function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2200);
}

// ── 시작 상태: 멜로디 1개 + 드럼 1개 ───────────────────────────
addTrack("melody");
addTrack("drums");
