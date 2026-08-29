// music-maker — 1단계: 피아노 롤 + 재생
// 가로 = 시간(스텝), 세로 = 음 높이. 칸을 눌러 음을 켜고 재생하면 왼→오로 지나간다.

const STEPS = 16;

// 위(높은 음) → 아래(낮은 음). 한 옥타브 + 위 도까지 = 13줄(반음 포함).
const NOTES = [
  "C5", "B4", "A#4", "A4", "G#4", "G4", "F#4",
  "F4", "E4", "D#4", "D4", "C#4", "C4",
];
const isSharp = (n) => n.includes("#");

// 격자 상태: grid[음][스텝] = true면 그 음이 켜짐
const grid = NOTES.map(() => new Array(STEPS).fill(false));

// ── 악기(신스) 만들기 ───────────────────────────────────────────
// 여러 음이 동시에 날 수 있게 PolySynth를 쓴다. 악기 종류에 따라 음색만 바꾼다.
let synth;
function makeInstrument(kind) {
  if (synth) synth.dispose();
  if (kind === "pluck") {
    synth = new Tone.PolySynth(Tone.PluckSynth).toDestination();
  } else if (kind === "synth") {
    synth = new Tone.PolySynth(Tone.Synth).toDestination();
  } else {
    // "피아노" 느낌: 부드러운 사인 계열 + 짧은 릴리즈
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.6 },
    }).toDestination();
  }
  synth.volume.value = -6;
}
makeInstrument("piano");

// ── 격자 그리기 ─────────────────────────────────────────────────
const gridEl = document.getElementById("grid");
// 맨 앞 라벨 열 + 스텝 열들
gridEl.style.gridTemplateColumns = `auto repeat(${STEPS}, 1fr)`;

const cellEls = []; // cellEls[음][스텝] = DOM 엘리먼트

NOTES.forEach((note, r) => {
  // 라벨(음 이름)
  const label = document.createElement("div");
  label.className = "label-cell" + (isSharp(note) ? " sharp" : "");
  label.textContent = note;
  gridEl.appendChild(label);

  cellEls[r] = [];
  for (let c = 0; c < STEPS; c++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (isSharp(note)) cell.classList.add("black-key");
    if (c % 4 === 0) cell.classList.add("beat");
    cell.addEventListener("click", () => toggle(r, c));
    gridEl.appendChild(cell);
    cellEls[r][c] = cell;
  }
});

function toggle(r, c) {
  grid[r][c] = !grid[r][c];
  cellEls[r][c].classList.toggle("on", grid[r][c]);
  // 음을 찍을 때 짧게 미리듣기 (오디오가 켜져 있을 때만)
  if (grid[r][c] && Tone.context.state === "running") {
    synth.triggerAttackRelease(NOTES[r], "16n");
  }
}

// ── 재생 ────────────────────────────────────────────────────────
let step = 0;
const seq = new Tone.Sequence(
  (time, col) => {
    // 이번 스텝에서 켜진 음을 모두 울린다
    const notesOn = [];
    for (let r = 0; r < NOTES.length; r++) {
      if (grid[r][col]) notesOn.push(NOTES[r]);
    }
    if (notesOn.length) synth.triggerAttackRelease(notesOn, "16n", time);

    // 재생 위치 표시는 화면 갱신이라 Draw로 타이밍을 맞춘다
    Tone.Draw.schedule(() => highlightColumn(col), time);
  },
  [...Array(STEPS).keys()], // 0,1,2,...,STEPS-1
  "16n" // 한 스텝 = 16분음표
);

function highlightColumn(col) {
  for (let r = 0; r < NOTES.length; r++) {
    for (let c = 0; c < STEPS; c++) {
      cellEls[r][c].classList.toggle("playing", c === col);
    }
  }
}
function clearHighlight() {
  cellEls.forEach((row) => row.forEach((el) => el.classList.remove("playing")));
}

// ── 컨트롤 배선 ─────────────────────────────────────────────────
const playBtn = document.getElementById("play");
const stopBtn = document.getElementById("stop");
const clearBtn = document.getElementById("clear");
const bpm = document.getElementById("bpm");
const bpmVal = document.getElementById("bpmVal");
const instrument = document.getElementById("instrument");

playBtn.addEventListener("click", async () => {
  // 브라우저 정책: 사용자 클릭이 있어야 오디오를 시작할 수 있다
  await Tone.start();
  Tone.Transport.bpm.value = Number(bpm.value);
  seq.start(0);
  Tone.Transport.start();
});

stopBtn.addEventListener("click", () => {
  Tone.Transport.stop();
  seq.stop();
  clearHighlight();
});

clearBtn.addEventListener("click", () => {
  for (let r = 0; r < NOTES.length; r++)
    for (let c = 0; c < STEPS; c++) {
      grid[r][c] = false;
      cellEls[r][c].classList.remove("on");
    }
});

bpm.addEventListener("input", () => {
  bpmVal.textContent = bpm.value;
  Tone.Transport.bpm.value = Number(bpm.value);
});

instrument.addEventListener("change", () => makeInstrument(instrument.value));
