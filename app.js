// musik-maker — 3단계: 곡을 "세션"처럼 저장/전환 (왼쪽 드로어 = 내 곡 목록)
// 세션 = 곡 하나(트랙·악기·격자·템포·마디). 브라우저 localStorage에 저장된다.
// 목록에서 곡을 누르면 그 곡이 열린다. 저장은 '저장' 버튼을 누를 때만 한다(자동 저장 없음).

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

// ── 현재 편집 중인 곡의 런타임 상태 ─────────────────────────────
// 박자 = n×m: 한 박 = beatUnit칸(얕은 선), 한 마디 = barBeats박(굵은 선). 셀 타이밍(16분음표)은 그대로.
let bars = 2;
let beatUnit = 4;   // n: 한 박이 몇 칸인지
let barBeats = 4;   // m: 한 마디에 몇 박인지
const barCells = () => beatUnit * barBeats; // 한 마디 = 몇 칸
let steps = bars * barCells();
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

// 오디오 샘플 소리: { id, name, kind:"sample", audio:<dataURL>, baseNote:"C4", baseAuto, volume }
// 디코드된 버퍼는 여기 캐시한다(id → Tone.ToneAudioBuffer). 로드는 비동기.
// 재생은 샘플러(Tone.Sampler): baseNote = 이 파일이 원래 내는 음. 그 음에 찍으면 원본 그대로,
// 다른 음은 그만큼 올려/내려 재생. baseNote가 실제 음과 맞아야 하므로 로드 시 자동 감지로 채운다
// (baseAuto=true). 자동 감지가 틀리면 편집기에서 사용자가 고칠 수 있다(그때 baseAuto=false).
const sampleBuffers = {};
function loadSampleBuffer(sound) {
  if (!sound || sound.kind !== "sample" || !sound.audio) return;
  const cached = sampleBuffers[sound.id];
  if (cached && cached.loaded) return;
  const buf = new Tone.ToneAudioBuffer(
    sound.audio,
    () => { // 로드되면: (1) 음높이 자동 감지 (2) 이 소리를 쓰는 트랙 신스를 다시 만든다
      if (sound.baseAuto !== false) {
        const nm = freqToNoteName(detectSampleFreq(buf));
        if (nm) sound.baseNote = nm;
      }
      for (const t of tracks) if (t.instrument === "snd:" + sound.id) t.synth = buildSynth(t);
      if (sampleEditorOpenId === sound.id) openSampleEditor(sound); // 편집기 열려 있으면 갱신
    },
    (e) => console.warn("샘플 로드 실패:", e)
  );
  sampleBuffers[sound.id] = buf;
}

// ── 음높이(기준 음) 자동 감지 ──────────────────────────────────
// 자기상관으로 기본 주파수를 찾는다. 피아노처럼 배음이 강하면 옥타브가 흔들릴 수 있지만,
// 재생은 원본 그대로라 이 값은 '참고 라벨'일 뿐이라 정확도가 소리를 좌우하지 않는다(사용자가 수정 가능).
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function freqToNoteName(f) {
  if (!f || f <= 0) return null;
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
function detectSampleFreq(toneBuf) {
  let ab = null;
  try { ab = toneBuf && toneBuf.get ? toneBuf.get() : toneBuf; } catch (e) {}
  if (!ab || !ab.getChannelData) return null;
  const sr = ab.sampleRate, ch = ab.getChannelData(0), N = ch.length;
  const s = Math.min(Math.floor(0.15 * sr), Math.max(0, N - 1)); // 어택 뒤 안정 구간
  const e = Math.min(Math.floor(0.55 * sr), N);
  if (e - s < sr / 50) return null;
  let mean = 0; for (let i = s; i < e; i++) mean += ch[i]; mean /= (e - s);
  const minLag = Math.max(2, Math.floor(sr / 1000)), maxLag = Math.floor(sr / 60); // 60~1000Hz
  let best = -Infinity, bestLag = 0;
  for (let lag = minLag; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = s; i + lag < e; i += 2) sum += (ch[i] - mean) * (ch[i + lag] - mean);
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return (bestLag > 0 && best > 0) ? sr / bestLag : null;
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
const REVERB_WET = 0.55;  // 트랙 잔향 켰을 때 젖음 비율(0=드라이, 1=완전 잔향)
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
// 킥 버퍼: 사인이 고→저로 떨어지는 스윕 + 지수 감쇠(MembraneSynth를 폴리포닉 원샷으로 대체)
function makeKickBuffer(peak) {
  const ctx = Tone.getContext().rawContext || Tone.getContext();
  const sr = ctx.sampleRate;
  const len = Math.floor(0.34 * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const f0 = 150, f1 = 50, pitchTau = 0.03, ampTau = 0.11;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / pitchTau);
    phase += (2 * Math.PI * f) / sr;
    d[i] = Math.sin(phase) * Math.exp(-t / ampTau) * peak;
  }
  const fade = Math.min(128, len);
  for (let k = 0; k < fade; k++) d[len - 1 - k] *= k / fade;
  return buf;
}

// 트랙에 맞는 신스 노드를 만든다(현재 Tone 컨텍스트 기준). 저장/해제는 하지 않는다.
// out = 최종 출력 노드(마스터 리미터). → 재생용(buildSynth)과 WAV 오프라인 렌더가 공유한다.
function createVoices(track, out) {
  out = out || realtimeMaster();
  // 체인: 신스 → 트랙 볼륨 → 트랙 잔향(리버브) → 마스터.
  // 리버브 wet=0이면 완전 드라이(꺼짐), 켜면 꼬리가 붙어 소리가 더 오래 울린다.
  // 라이브 토글·해제 때 접근하려고 vol에 리버브 참조를 달아 둔다(반환 객체마다 안 달아도 되게).
  const reverb = new Tone.Reverb({ decay: 3.6, preDelay: 0.02, wet: track.reverb ? REVERB_WET : 0 }).connect(out);
  const vol = new Tone.Volume(track.volume ?? 0).connect(reverb);
  vol._reverb = reverb;

  if (track.type === "drums") {
    // 세 드럼 모두 '타격마다 새 원샷(폴리포닉)'으로 재생한다.
    // 모노포닉 신스(NoiseSynth·MembraneSynth)를 자주 치면 소스/자동화 재시작이 충돌해
    // 'Start time...'·RangeError + 파열음이 났다 → 미리 구운 버퍼를 매 타격마다 새 소스로 재생.
    const snareOut = new Tone.Filter(350, "highpass").connect(vol);   // 저역(폭발음) 제거 → 또렷한 스네어
    const hatOut = new Tone.Filter(7000, "highpass").connect(vol);    // 고역만 → 하이햇
    const kickBuf = makeKickBuffer(dbToGain(5)); // 킥을 더 크게
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
    return {
      kind: "drums", snareOut, hatOut, vol,
      hitKick: (time) => oneShot(kickBuf, vol, time),
      hitSnare: (time) => oneShot(snareBuf, snareOut, time),
      hitHat: (time) => oneShot(hatBuf, hatOut, time),
    };
  }

  // 커스텀 소리(라이브러리 참조)
  const snd = trackSound(track);
  if (snd && snd.kind === "sample") {
    // 오디오 샘플: 한 녹음을 '기준음' 기준으로 음정 이식(Tone.Sampler = 샘플러).
    // 기준음에 찍으면 원본 그대로, 다른 음은 그만큼 빨리/느리게 감아 올리거나 내려 재생한다.
    // 기준음은 로드 시 자동 감지로 채워지므로 '기준음에 찍으면 원본'이 실제로 맞는다.
    const buf = sampleBuffers[snd.id];
    if (buf && buf.loaded) {
      const sampler = new Tone.Sampler({ urls: { [snd.baseNote || "C4"]: buf } }).connect(vol);
      sampler.volume.value = snd.volume ?? -6;
      // 각 음을 16분음표로 자르지 않고 '녹음 전체 길이'만큼 울리게 한다(피아노가 자연 감쇠하도록).
      // noteDur가 있는 보이스는 트리거 시 이 길이를 쓴다.
      return { kind: "melody", poly: sampler, vol, noteDur: buf.duration };
    }
    loadSampleBuffer(snd); // 아직 로딩 전 → 무음, 로드되면 재생성
    const silent = new Tone.PolySynth(Tone.Synth).connect(vol);
    silent.volume.value = -60;
    return { kind: "melody", poly: silent, vol };
  }
  if (snd) {
    // 신스 소리: 사용자가 만든 음색. MonoSynth로 필터(공명)+필터엔벨로프를 내장으로 얻고,
    // 뒤에 이펙트 체인(디스토션·비트크러셔·코러스·비브라토·트레모로)을 단다.
    const poly = new Tone.PolySynth(Tone.MonoSynth, monoSynthOpts(snd));
    poly.volume.value = snd.volume;
    const fx = buildFxChain(poly, snd, vol);
    return { kind: "melody", poly, fx, vol };
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

// 커스텀 음색 기본값. 새 필드는 모두 0/중립값이라, 예전에 만든 소리는 소리가 그대로 유지된다.
function defaultParams() {
  return {
    wave: "sawtooth", attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.6,
    cutoff: 2000, volume: -8,
    // 필터
    filterType: "lowpass", resonance: 1, filterEnvAmount: 0, filterDecay: 0.3,
    // 두께(유니즌 디튠, 0=끔)
    detune: 0,
    // 이펙트 (0=끔)
    distortion: 0, bitcrush: 0, chorus: 0,
    // 모듈레이션 (0=끔)
    vibrato: 0, tremolo: 0,
  };
}
// ── 오케스트라 대표 악기 근사 프리셋 ──────────────────────────
// 빼기식 신스(MonoSynth) 파라미터로 각 악기의 '느낌'을 흉내낸다(진짜 샘플이 아니라 근사).
// 참고: 공유 링크(코덱 v5)엔 파형·ADSR·컷오프·볼륨만 실린다 → 링크로 열면 고급 필드
// (필터 엔벨로프·비브라토·코러스·디튠 등)는 빠지고 기본 신스로 들린다. 세션 저장엔 전부 담긴다.
const INSTRUMENT_PRESETS = [
  { emoji: "🎹", name: "피아노",       p: { wave: "triangle", attack: 0.004, decay: 1.4,  sustain: 0.0,  release: 0.9,  cutoff: 4200, resonance: 0.6, filterEnvAmount: 1.2, filterDecay: 1.1, volume: -7 } },
  { emoji: "🎸", name: "베이스",       p: { wave: "sawtooth", attack: 0.02,  decay: 0.25, sustain: 0.55, release: 0.25, cutoff: 700,  resonance: 1.2, filterEnvAmount: 0.5, filterDecay: 0.2, volume: -5 } },
  { emoji: "🎻", name: "바이올린",     p: { wave: "sawtooth", attack: 0.16,  decay: 0.2,  sustain: 0.9,  release: 0.4,  cutoff: 3200, resonance: 0.8, vibrato: 0.35, chorus: 0.25, detune: 8, volume: -10 } },
  { emoji: "🎻", name: "첼로",         p: { wave: "sawtooth", attack: 0.12,  decay: 0.2,  sustain: 0.85, release: 0.5,  cutoff: 1600, resonance: 0.9, vibrato: 0.25, detune: 6, volume: -8 } },
  { emoji: "🎵", name: "플루트",       p: { wave: "sine",     attack: 0.09,  decay: 0.1,  sustain: 0.92, release: 0.3,  cutoff: 5000, resonance: 0.4, vibrato: 0.18, volume: -7 } },
  { emoji: "🎺", name: "금관(트럼펫)", p: { wave: "sawtooth", attack: 0.05,  decay: 0.18, sustain: 0.85, release: 0.22, cutoff: 2600, resonance: 1.4, filterEnvAmount: 1.6, filterDecay: 0.14, volume: -9 } },
  { emoji: "🎹", name: "오르간",       p: { wave: "square",   attack: 0.01,  decay: 0.05, sustain: 1.0,  release: 0.08, cutoff: 3500, resonance: 0.5, chorus: 0.15, volume: -12 } },
  { emoji: "🥁", name: "팀파니",       p: { wave: "sine",     attack: 0.003, decay: 0.7,  sustain: 0.0,  release: 0.5,  cutoff: 900,  resonance: 1.5, filterEnvAmount: 0.8, filterDecay: 0.3, distortion: 0.08, volume: -3 } },
];
// 프리셋으로 새 소리 하나 만들고 편집기를 연다(만든 뒤 슬라이더로 더 다듬을 수 있게).
function addPresetSound(preset) {
  const s = { id: genSoundId(), name: preset.name, ...defaultParams(), ...preset.p };
  soundLib.push(s);
  markDirty(); render();
  openSoundEditor(s);
}

const FILTER_TYPES = [["lowpass", "로우패스 (두껍게)"], ["highpass", "하이패스 (얇게)"], ["bandpass", "밴드패스 (가운데)"]];
// 커스텀 소리 → Tone.MonoSynth 옵션. detune>0면 fat 오실레이터(유니즌)로 두껍게.
function synthOscOpts(s) {
  const det = s.detune ?? 0;
  return det > 0 ? { type: "fat" + s.wave, count: 3, spread: det } : { type: s.wave };
}
function monoSynthOpts(s) {
  return {
    oscillator: synthOscOpts(s),
    envelope: { attack: s.attack, decay: s.decay, sustain: s.sustain, release: s.release },
    filter: { type: s.filterType || "lowpass", Q: s.resonance ?? 1, rolloff: -12 },
    // 필터 엔벨로프: octaves=0이면 컷오프가 고정(=예전 동작), >0면 소리 나는 동안 밝기가 열림
    filterEnvelope: {
      attack: 0.01, decay: s.filterDecay ?? 0.3, sustain: 0.35, release: s.release,
      baseFrequency: s.cutoff ?? 2000, octaves: s.filterEnvAmount ?? 0, exponent: 2,
    },
  };
}
// 이펙트 체인 노드 5개를 만들어 poly 뒤에 잇는다(항상 존재, 값 0이면 사실상 통과).
// 반환: {vib, dist, crush, chorus, trem} — 값 갱신·해제에 쓴다.
function buildFxChain(poly, s, out) {
  const vib = new Tone.Vibrato({ frequency: 5.5, depth: s.vibrato ?? 0 });
  const dist = new Tone.Distortion(0.6); dist.wet.value = s.distortion ?? 0;
  const crush = new Tone.BitCrusher({ bits: 4 }); crush.wet.value = s.bitcrush ?? 0;
  const chorus = new Tone.Chorus({ frequency: 2.2, delayTime: 3.2, depth: 0.7, wet: s.chorus ?? 0 }).start();
  const trem = new Tone.Tremolo({ frequency: 6, depth: s.tremolo ?? 0 }).start();
  poly.chain(vib, dist, crush, chorus, trem, out);
  return { vib, dist, crush, chorus, trem };
}
function applyFxValues(fx, s) {
  fx.vib.depth.value = s.vibrato ?? 0;
  fx.dist.wet.value = s.distortion ?? 0;
  fx.crush.wet.value = s.bitcrush ?? 0;
  fx.chorus.wet.value = s.chorus ?? 0;
  fx.trem.depth.value = s.tremolo ?? 0;
}
// 소리를 편집할 때: 그 소리를 쓰는 트랙 신스에 즉시 반영(재생성 없이)
function applyParamsLive(track) {
  const s = track.synth;
  if (!s || s.kind !== "melody" || !s.poly.set) return;
  const p = trackSound(track);
  if (!p || p.kind === "sample") return;
  s.poly.set(monoSynthOpts(p));
  s.poly.volume.value = p.volume;
  if (s.fx) applyFxValues(s.fx, p);
}
// 소리 하나를 편집하면 그 소리를 쓰는 모든 트랙에 반영
function applySoundToTracks(sound) {
  for (const t of tracks) if (t.instrument === "snd:" + sound.id) applyParamsLive(t);
}

function disposeSynth(s) {
  if (!s) return;
  if (s.kind === "drums") { s.snareOut.dispose(); s.hatOut.dispose(); }
  else {
    s.poly.dispose();
    if (s.filt) s.filt.dispose();
    if (s.fx) for (const k in s.fx) { try { s.fx[k].dispose(); } catch (e) {} }
  }
  const rv = s.vol && s.vol._reverb;
  if (s.vol) s.vol.dispose();
  if (rv) rv.dispose();
}

// 트랙 볼륨을 라이브로 조절(재생성 없이)
function setTrackVolume(track, db) {
  track.volume = db;
  if (track.synth && track.synth.vol) track.synth.vol.volume.value = db;
}

// 트랙 잔향(리버브) 켜고 끄기를 라이브로(재생성 없이). wet만 바꾼다.
function setTrackReverb(track, on) {
  track.reverb = !!on;
  const rv = track.synth && track.synth.vol && track.synth.vol._reverb;
  if (rv) rv.wet.value = on ? REVERB_WET : 0;
}

// 한 격자(grid 또는 half)의 col 열에 켜진 노트를 time에 울린다.
function playCellsAt(track, gridArr, col, time) {
  const rows = track.type === "drums" ? DRUM_ROWS : MELODY_NOTES;
  if (track.type === "drums") {
    for (let r = 0; r < rows.length; r++) {
      if (!gridArr[r][col]) continue;
      const s = track.synth;
      if (rows[r] === "킥") s.hitKick(time);
      else if (rows[r] === "스네어") s.hitSnare(time);
      else s.hitHat(time);
    }
  } else {
    const notesOn = [];
    for (let r = 0; r < rows.length; r++) if (gridArr[r][col]) notesOn.push(rows[r]);
    if (notesOn.length) track.synth.poly.triggerAttackRelease(notesOn, track.synth.noteDur || "16n", time);
  }
}
const HALF_STEP = () => Tone.Time("32n").toSeconds(); // 반칸 = 한 칸(16분음표)의 절반(32분음표)
function triggerTrack(track, col, time) {
  if (track.muted) return;
  playCellsAt(track, track.grid, col, time);
  if (track.half) playCellsAt(track, track.half, col, time + HALF_STEP()); // 반칸 노트는 32분음표 뒤에
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
    track.synth.poly.triggerAttackRelease(rows[r], track.synth.noteDur || "16n");
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
    reverb: data?.reverb ?? false,
    grid: null,
    half: null,          // 반칸(32분음표) 노트: half[r][c] = 칸 c의 중간(32분음표 뒤)에 노트 시작
    synth: null,
    cellEls: null,
  };
  // 격자: 빈 격자를 만들고, 저장값이 있으면 채운다.
  track.grid = rows.map(() => new Array(steps).fill(false));
  track.half = rows.map(() => new Array(steps).fill(false));
  const src = data?.grid;
  if (src) {
    // 예전 저장은 멜로디가 13줄(C5..C4)이었다. 줄 수가 다르면 음이름으로 새 음역에 맞춰 옮긴다.
    const legacy = type === "melody" && src.length === LEGACY_MELODY_NOTES.length && rows.length !== src.length;
    const sh = data?.half; // 반칸 격자(있으면 grid와 같은 줄 배치). 레거시 곡엔 없음.
    for (let sr = 0; sr < src.length; sr++) {
      const tr = legacy ? rows.indexOf(LEGACY_MELODY_NOTES[sr]) : sr;
      if (tr < 0 || tr >= rows.length) continue;
      const savedRow = src[sr] || [];
      for (let c = 0; c < steps && c < savedRow.length; c++) track.grid[tr][c] = !!savedRow[c];
      const savedHalf = (sh && sh[sr]) || null;
      if (savedHalf) for (let c = 0; c < steps && c < savedHalf.length; c++) track.half[tr][c] = !!savedHalf[c];
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
  steps = bars * barCells();
  for (const t of tracks) {
    for (const g of [t.grid, t.half]) {
      if (!g) continue;
      for (let r = 0; r < g.length; r++) {
        const row = g[r];
        if (row.length < steps) while (row.length < steps) row.push(false);
        else row.length = steps;
      }
    }
  }
  render();
  rebuildSequence();
  updateTimeline(); // 마디 수가 바뀌면 타임라인 눈금도 갱신
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
  prevPlayheadCol = -1;         // 셀이 새로 그려졌으니 노란 열 다시 칠한다
  if (typeof markPlayheadColumn === "function") markPlayheadColumn();
  prevEditCol = -1;             // 초록 편집 열도 다시 칠한다
  if (typeof markEditColumn === "function") markEditColumn();
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
      track.half = nrows.map(() => new Array(steps).fill(false));
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
  muteBtn.className = "t-mute"; // 음소거는 편집 잠금 상태에서도 쓸 수 있게(재생/믹싱 컨트롤)
  muteBtn.textContent = track.muted ? "음소거 해제" : "음소거";
  muteBtn.addEventListener("click", () => { track.muted = !track.muted; render(); markDirty(); });
  head.appendChild(muteBtn);

  // 트랙 잔향(리버브) 토글 — 켜면 소리에 꼬리가 붙어 더 오래 울린다. 재생성 없이 라이브 적용.
  const revBtn = document.createElement("button");
  const setRevLabel = () => {
    revBtn.textContent = track.reverb ? "잔향 ●" : "잔향 ○";
    revBtn.style.background = track.reverb ? "#3b6ef0" : "";
    revBtn.style.color = track.reverb ? "#fff" : "";
  };
  setRevLabel();
  revBtn.title = "이 트랙에 잔향(리버브)을 켜고 끕니다";
  revBtn.addEventListener("click", () => { setTrackReverb(track, !track.reverb); setRevLabel(); markDirty(); });
  head.appendChild(revBtn);

  if (!collapsed) {
    // 이 트랙만의 노트 이동 모드. 다른 트랙이 이동 모드면 이 버튼은 잠근다(한 번에 한 트랙).
    const moveTBtn = document.createElement("button");
    const activeHere = moveMode && mvTrack === track;
    moveTBtn.className = "t-move" + (activeHere ? " active" : "");
    moveTBtn.textContent = activeHere ? "✥ 선택이동 중" : "✥ 선택이동";
    moveTBtn.title = "이 트랙에서 노트 범위를 골라 옮깁니다";
    if (moveMode && !activeHere) moveTBtn.disabled = true; // 다른 트랙 이동 중
    moveTBtn.addEventListener("click", () => {
      if (moveMode && mvTrack === track) exitMoveMode(true);
      else if (!moveMode) enterMoveMode(track);
    });
    head.appendChild(moveTBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => { if (confirm("정말 트랙을 제거하시겠습니까?")) removeTrack(track.id); });
    head.appendChild(delBtn);
  }

  wrap.appendChild(head);

  track.cellEls = [];
  if (collapsed) return wrap; // 접힘: 헤더(이름·음원·음소거·순서)만, 격자는 그리지 않음

  const grid = document.createElement("div");
  grid.className = "grid in-scroller" + (splitOn() ? " zoomed" : ""); // 스크롤은 바깥 hscroll/vscroll이 맡는다
  grid.style.gridTemplateColumns = `auto repeat(${steps}, ${zoomW}px)`; // 가로 줌: 칸 너비 고정 → 넘치면 가로 스크롤
  grid.style.setProperty("--cell-h", zoomH + "px"); // 세로 줌: 칸 높이

  rows.forEach((rowName, r) => {
    const label = document.createElement("div");
    label.className = "label-cell playable" + (track.type === "melody" && isSharp(rowName) ? " sharp" : "");
    label.textContent = rowName;
    label.title = "눌러서 이 음 소리 듣기";
    // 음 이름을 누르면 그 줄의 소리를 미리 듣는다(편집 잠금과 무관 — 수정이 아니라 소리 확인).
    label.addEventListener("click", async () => { await Tone.start(); preview(track, r); });
    grid.appendChild(label);

    track.cellEls[r] = [];
    for (let c = 0; c < steps; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (track.type === "drums") cell.classList.add("drum");
      else if (isSharp(rowName)) cell.classList.add("black-key");
      // 마디선(굵게, barCells칸마다)이 박자선(얕게, beatUnit칸마다)보다 우선
      if (c % barCells() === 0) cell.classList.add("bar");
      else if (c % beatUnit === 0) cell.classList.add("beat");
      if (track.grid[r][c]) cell.classList.add("on");
      if (track.half && track.half[r][c]) cell.classList.add("half-on"); // 반칸(32분음표) 노트 — 줌과 무관하게 항상 표시
      cell._r = r; cell._c = c; cell._track = track; // 탭 위임·이동 모드에서 좌표/트랙 조회
      grid.appendChild(cell);
      track.cellEls[r][c] = cell;
    }
  });

  // 격자 오른쪽 끝: 곡 길이(마디) ＋/－. 오른쪽으로 스크롤하면 나온다. 위에 고정(sticky)돼 세로로 스크롤해도 보임.
  const barCtl = document.createElement("div");
  barCtl.className = "bar-ctl";
  const barPlus = document.createElement("button");
  barPlus.textContent = "＋"; barPlus.title = "1마디 늘리기";
  barPlus.addEventListener("click", () => changeBars(1));
  const barLabel = document.createElement("span");
  barLabel.className = "bar-ctl-label";
  barLabel.textContent = bars + "마디";
  const barMinus = document.createElement("button");
  barMinus.textContent = "－"; barMinus.title = "1마디 줄이기"; barMinus.disabled = bars <= 1;
  barMinus.addEventListener("click", () => changeBars(-1));
  barCtl.append(barPlus, barLabel, barMinus);

  // 가로·세로를 한 컨테이너에서 스크롤(양축 touch-action 허용). 멜로디는 tall(세로 스크롤).
  const box = document.createElement("div");
  box.className = "gridscroll" + (track.type === "melody" ? " tall" : "") + (moveMode && mvTrack === track ? " move-active" : "");
  box.appendChild(grid);
  box.appendChild(barCtl); // 격자 오른쪽에 이어 붙음(flex row)
  track._hscroll = box; // '트랙 고정' 가로 동기화 대상(같은 요소가 세로도 스크롤)
  box.addEventListener("scroll", () => {
    track._scrollTop = box.scrollTop;
    track._scrollLeft = box.scrollLeft;
    syncTracksHorizontally(box); // '트랙 고정'이 켜져 있으면 나머지 트랙 가로도 맞춘다
  });
  if (track.type === "melody") enableDragScroll(box, grid, track); // 마우스 세로 드래그(grid._dragged로 클릭 취소)
  enableCellTap(grid, track); // 관대한 탭으로 음 찍기(살짝 움직이거나 오래 눌러도 인식)

  const rowH = zoomH + 2; // 셀 높이 + 간격 2 (세로 줌 반영)
  const defTop = track.type === "melody" ? Math.max(0, MELODY_NOTES.indexOf(DEFAULT_TOP_NOTE) * rowH) : 0;
  requestAnimationFrame(() => {
    box.scrollTop = track._scrollTop != null ? track._scrollTop : defTop;
    if (track._scrollLeft != null) box.scrollLeft = track._scrollLeft;
  });
  wrap.appendChild(box);
  return wrap;
}

// 마우스로 세로 컨테이너를 끌면 스크롤(음역 이동). 터치는 브라우저 기본 스크롤(pan-y)에 맡긴다.
// 이동 문턱(10px)을 넘어야 드래그로 보고 셀 탭(음 찍기)을 취소한다(flagEl._dragged).
// 문턱을 6→10으로 키운 이유: 클릭할 때 손이 살짝 흔들려도(≤10px) 음이 찍히도록.
function enableDragScroll(scrollEl, flagEl, track) {
  let st = null;
  scrollEl.addEventListener("pointerdown", (e) => {
    if (moveMode && mvTrack === track) return;             // 이동 중인 트랙만 드래그=선택/이동(다른 트랙은 정상 스크롤)
    if (noteAt(e.clientX, e.clientY, track)) return; // 노트(한 칸/반칸, 반칸 넘침 영역 포함) 위에서 시작 → 노트 끌기(스크롤 안 함)
    if (e.pointerType !== "mouse" || e.button !== 0) return; // 터치/펜은 기본 스크롤
    st = { y: e.clientY, top: scrollEl.scrollTop, moved: false };
    flagEl._dragged = false;
  });
  scrollEl.addEventListener("pointermove", (e) => {
    if (!st) return;
    const dy = e.clientY - st.y;
    if (!st.moved && Math.abs(dy) < 10) return;
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

// 셀 '탭'으로 음 찍기 — 네이티브 click 대신 포인터로 판정해 관대하게 인식한다.
// grid에 위임: pointerdown에서 셀을 기억 → pointerup 때 이동이 TAP_SLOP 이내면 그 셀을 토글.
// 이 방식의 장점: (1) 홀드 시간 제한 없음(오래 눌러도 찍힘), (2) 살짝 움직여도(≤슬롭) 찍힘,
// (3) 터치에서 실제 스크롤이 시작되면 브라우저가 pointercancel을 주므로 스크롤과 확실히 구분된다.
// ══════════════════════════════════════════════════════════════
//  편집 모드 — 켜야만 노트/트랙을 수정할 수 있다(실수 편집 방지). 시작은 잠금.
//  재생·스크롤·공유·저장은 잠금 상태에서도 된다. 곡 내용엔 저장하지 않는 UI 상태.
// ══════════════════════════════════════════════════════════════
let editMode = false;
const editBtn = document.getElementById("editMode");
function setEditMode(on) {
  editMode = !!on;
  document.body.classList.toggle("locked", !editMode);
  editBtn.classList.toggle("active", editMode);
  editBtn.textContent = editMode ? "✏️ 편집 중" : "✏️ 편집";
  editBtn.title = editMode ? "편집 모드 켜짐 — 눌러서 잠급니다" : "편집 모드 꺼짐 — 눌러서 수정 허용";
  if (!editMode && moveMode) exitMoveMode(false); // 잠그면 진행 중인 이동 모드는 취소
}
editBtn.addEventListener("click", () => setEditMode(!editMode));
let _lockHintAt = 0;
function hintLocked() { // 잠금 상태에서 편집을 시도하면 안내(과도한 토스트 방지로 스로틀)
  const now = Date.now();
  if (now - _lockHintAt < 2000) return;
  _lockHintAt = now;
  showToast("편집모드 비활성화");
}

// ══════════════════════════════════════════════════════════════
//  가로 줌 — 칸(노트) 너비를 조절. 일정 이상 확대되면 칸을 반으로 쪼개(32분음표)
//  '반칸' 노트를 넣을 수 있다(칸 가운데 얇은 선 + 오른쪽 절반 클릭). 곡 내용 아닌 뷰 상태.
// ══════════════════════════════════════════════════════════════
const ZOOM_WIDTHS = [28, 36, 44, 60, 84, 120]; // 칸 너비 단계(px)
const SPLIT_MIN = 60;   // 이 너비 이상이면 반칸 분할이 켜진다
let zoomIdx = 2;        // 기본 44px
let zoomW = ZOOM_WIDTHS[zoomIdx];
const splitOn = () => zoomW >= SPLIT_MIN; // 반칸(32분음표) 넣기 가능 여부
function applyZoom() {
  zoomW = ZOOM_WIDTHS[zoomIdx];
  render();
  updateZoomUI();
  markDirty();
}
function zoomStep(dir) {
  const ni = Math.max(0, Math.min(ZOOM_WIDTHS.length - 1, zoomIdx + dir));
  if (ni === zoomIdx) return;
  zoomIdx = ni;
  applyZoom();
}
const zoomOutBtn = document.getElementById("zoomOut");
const zoomInBtn = document.getElementById("zoomIn");
const zoomLbl = document.getElementById("zoomLbl");
function updateZoomUI() {
  if (zoomOutBtn) zoomOutBtn.disabled = zoomIdx <= 0;
  if (zoomInBtn) zoomInBtn.disabled = zoomIdx >= ZOOM_WIDTHS.length - 1;
  if (zoomLbl) zoomLbl.textContent = splitOn() ? "반박자 ✓" : "노트 폭";
}
if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => zoomStep(-1));
if (zoomInBtn) zoomInBtn.addEventListener("click", () => zoomStep(1));

// ── 세로 줌 — 칸(노트) 높이를 조절(음역을 더 크게 보거나, 더 많은 음을 한눈에). 뷰 상태.
const ZOOM_HEIGHTS = [16, 20, 24, 30, 38, 48]; // 칸 높이 단계(px)
let zoomHIdx = 2;      // 기본 24px
let zoomH = ZOOM_HEIGHTS[zoomHIdx];
function applyZoomV() {
  zoomH = ZOOM_HEIGHTS[zoomHIdx];
  render();
  updateZoomVUI();
  markDirty();
}
function zoomStepV(dir) {
  const ni = Math.max(0, Math.min(ZOOM_HEIGHTS.length - 1, zoomHIdx + dir));
  if (ni === zoomHIdx) return;
  zoomHIdx = ni;
  applyZoomV();
}
const zoomVOutBtn = document.getElementById("zoomVOut");
const zoomVInBtn = document.getElementById("zoomVIn");
function updateZoomVUI() {
  if (zoomVOutBtn) zoomVOutBtn.disabled = zoomHIdx <= 0;
  if (zoomVInBtn) zoomVInBtn.disabled = zoomHIdx >= ZOOM_HEIGHTS.length - 1;
}
if (zoomVOutBtn) zoomVOutBtn.addEventListener("click", () => zoomStepV(-1));
if (zoomVInBtn) zoomVInBtn.addEventListener("click", () => zoomStepV(1));

const TAP_SLOP = 12; // 이 픽셀 이내로 움직인 손뗌은 탭으로 본다(스크롤/드래그와 구분).
const HOLD_MS = 600; // 기존 노트를 이만큼 '길게 눌러야' 드래그 이동(수정)이 켜진다(실수 이동 방지).
function clearHold(tap) { // 길게누르기 타이머 해제 + '이동 준비' 표시 제거
  if (!tap) return;
  if (tap.holdTimer) { clearTimeout(tap.holdTimer); tap.holdTimer = null; }
  if (tap.cell) tap.cell.classList.remove("note-armed");
}
function enableCellTap(grid, track) {
  let tap = null;
  grid.addEventListener("pointerdown", (e) => {
    if (moveMode && mvTrack === track) { moveDown(e, grid, track); return; } // 이 트랙 이동 모드
    const cell = e.target.closest(".cell");
    // 잠금 상태에서도 탭을 추적한다(스크롤과 구분) — 실제로 찍으려 한 탭에서만 pointerup에서 안내한다.
    // 누른 위치의 '노트'를 콕 집는다(반칸이 다음 칸으로 넘쳐 보이는 것까지 감안). 없으면 null.
    const hit = cell ? noteAt(e.clientX, e.clientY, track) : null;
    tap = cell ? { id: e.pointerId, x: e.clientX, y: e.clientY, cell, moved: false, hit, armed: false, holdTimer: null } : null;
    // 노트 위(한 칸/반칸)를 누르면 HOLD_MS 뒤 '이동 준비'(armed) — 그때부터 드래그하면 그 노트만 옮겨진다. (편집 모드에서만)
    if (editMode && tap && tap.hit && !moveMode) {
      tap.holdTimer = setTimeout(() => { if (tap) { tap.armed = true; tap.cell.classList.add("note-armed"); } }, HOLD_MS);
    }
  });
  grid.addEventListener("pointermove", (e) => {
    if (moveDrag && moveDrag.grid === grid) { moveMoveEv(e); return; }
    if (noteDrag && noteDrag.grid === grid && noteDrag.id === e.pointerId) { noteDragMove(e); return; }
    if (!tap || e.pointerId !== tap.id) return;
    if (Math.abs(e.clientX - tap.x) > TAP_SLOP || Math.abs(e.clientY - tap.y) > TAP_SLOP) {
      // 잡은 노트를 '길게 누른 뒤(armed)' 드래그하면 그 노트 하나만 끌어 옮긴다.
      if (tap.hit && !moveMode && tap.armed) {
        clearHold(tap);
        startNoteDrag(e, grid, track, tap.hit); // 잡은 노트({r,c,isHalf})를 끈다
        tap = null;
      }
      else { clearHold(tap); tap.moved = true; } // 아직 준비 전 움직임 → 스크롤로 취급(노트 안 옮김)
    }
  });
  grid.addEventListener("pointercancel", () => { clearHold(tap); tap = null; }); // 스크롤 시작 등 → 탭 취소
  grid.addEventListener("pointerup", async (e) => {
    if (moveDrag && moveDrag.grid === grid) { moveUpEv(e, grid); return; }
    if (noteDrag && noteDrag.grid === grid && noteDrag.id === e.pointerId) { noteDragUp(e, grid); return; }
    if (!tap || e.pointerId !== tap.id) return;
    const t = tap; clearHold(t); tap = null;
    if (t.armed) return; // 길게 눌러 '집었다가' 제자리에서 뗌 → 삭제/토글 없이 그대로 둔다
    if (t.moved || grid._dragged) return; // 드래그(스크롤)면 음 안 찍음
    const cell = t.cell, r = cell._r, c = cell._c;
    if (r == null || c == null) return;
    // 진짜 탭(움직임 없는 손뗌)인데 편집이 잠겨 있으면 → 여기서만 안내(스크롤/터치엔 안 뜸).
    if (!editMode) { hintLocked(); return; }
    // 1) 누른 자리에 '보이는 노트'가 있으면 그 노트를 지운다(반칸 넘침까지 정확히 판정).
    if (t.hit) {
      (t.hit.isHalf ? track.half : track.grid)[t.hit.r][t.hit.c] = false;
      const hc = track.cellEls[t.hit.r] && track.cellEls[t.hit.r][t.hit.c];
      if (hc) hc.classList.toggle(t.hit.isHalf ? "half-on" : "on", false);
      markDirty();
      return;
    }
    // 2) 빈 자리 → 놓기. 반박자 분할(splitOn)이고 칸 오른쪽 절반이면 반칸, 아니면 한 칸.
    const rect = cell.getBoundingClientRect();
    const useHalf = splitOn() && (t.x >= rect.left + rect.width / 2);
    const arr = useHalf ? track.half : track.grid;
    arr[r][c] = true;
    cell.classList.toggle(useHalf ? "half-on" : "on", true);
    showEditMarker(c); // 찍은 칸이 플레이바 어디인지 별도 표식(재생 핸들은 안 옮김)
    // pointerup은 사용자 제스처 → 오디오 컨텍스트를 켠 뒤 미리듣기(첫 음 무음 방지).
    await Tone.start(); preview(track, r);
    markDirty();
  });
}

// ── 기존 노트 한 개를 끌어 옮기기(일반 모드) ──────────────────
// 잡은 노트(hit)를 들어내고, 끄는 동안 현재 위치에 '실제로' 다시 찍어 미리보기한다(반박자 위치까지).
// gridSnap/halfSnap은 드래그 시작 시점의 격자 복사 — 매 이동마다 복원 후 다시 찍어 지나온 자리를 안 망친다.
let noteDrag = null; // { id, grid, track, srcR, srcC, srcHalf, curR, curC, curHalf, gridSnap, halfSnap }
function startNoteDrag(e, grid, track, hit) {
  noteDrag = {
    id: e.pointerId, grid, track,
    srcR: hit.r, srcC: hit.c, srcHalf: hit.isHalf,
    curR: hit.r, curC: hit.c, curHalf: hit.isHalf,
    gridSnap: track.grid.map((row) => row.slice()),
    halfSnap: track.half ? track.half.map((row) => row.slice()) : null,
  };
  try { grid.setPointerCapture(e.pointerId); } catch (x) {}
  e.preventDefault();
  stampNoteDrag(); // 시작 즉시 미리보기(원 위치에 그대로) 렌더
}
// 스냅샷 복원 → 원래 노트 들어냄 → 현재 위치에 다시 찍기 → 화면 갱신
function stampNoteDrag() {
  const t = noteDrag.track;
  for (let r = 0; r < t.grid.length; r++) for (let c = 0; c < t.grid[r].length; c++) {
    t.grid[r][c] = noteDrag.gridSnap[r][c];
    if (t.half && noteDrag.halfSnap) t.half[r][c] = noteDrag.halfSnap[r][c];
  }
  (noteDrag.srcHalf ? t.half : t.grid)[noteDrag.srcR][noteDrag.srcC] = false; // 원래 노트 들어냄
  const rr = noteDrag.curR, cc = noteDrag.curC;
  if (rr >= 0 && rr < t.grid.length && cc >= 0 && cc < steps) {
    (noteDrag.curHalf ? t.half : t.grid)[rr][cc] = true; // 현재 위치에 놓기(겹치면 덮어씀)
  }
  refreshTrackCells(t);
}
function noteDragMove(e) {
  const at = cellAt(e.clientX, e.clientY, noteDrag.track);
  if (!at) return; // 격자 밖·스크롤바 위 → 마지막 위치 유지
  // 반박자 활성(splitOn)이면 칸 오른쪽 절반=반칸 위치로 → 반박자 단위 미리보기. 아니면 한 칸.
  let half = false;
  if (splitOn()) {
    const cel = noteDrag.track.cellEls[at.r] && noteDrag.track.cellEls[at.r][at.c];
    if (cel) { const rc = cel.getBoundingClientRect(); half = e.clientX >= rc.left + rc.width / 2; }
  }
  if (at.r === noteDrag.curR && at.c === noteDrag.curC && half === noteDrag.curHalf) return;
  noteDrag.curR = at.r; noteDrag.curC = at.c; noteDrag.curHalf = half;
  stampNoteDrag(); // 현재 위치에 실제로 다시 찍어(반박자 포함) 미리보기
}
function noteDragUp(e, grid) {
  try { grid.releasePointerCapture(e.pointerId); } catch (x) {}
  const nd = noteDrag; noteDrag = null;
  // 미리보기 stamp가 이미 최종 위치에 노트를 놓아 둔 상태 → 그대로 확정만 하면 된다.
  showEditMarker(nd.curC);
  markDirty();
}

// ══════════════════════════════════════════════════════════════
//  노트 이동 모드 — 사각 범위 선택 → 드래그/화살표로 이동, 확인/취소로 종료
// ══════════════════════════════════════════════════════════════
// 모델: 선택하면 그 사각 안의 '켜진 노트'를 들어올리고(notes), 원본에서 지운 격자를 base로 둔다.
// 이동할 때마다 track.grid = base + notes를 (r,c) 위치에 다시 찍는다 → 격자가 바로 갱신돼 재생도 옮긴 대로 난다.
let moveMode = false;
let mvTrack = null; // 이동 모드가 적용되는 '한 트랙'(이 트랙 안에서만 선택/이동)
// 노트를 [행오프셋, 반박자오프셋(dh)]로 들어올린다. dh=짝수→한 칸(grid), 홀수→반칸(half) 위치.
// 블록 왼쪽 위치 cHalf(반박자 단위)를 옮기면 각 노트가 cHalf+dh에 다시 찍힌다(짝/홀로 grid/half 결정).
let moveSel = null;   // { track, notes:[[dr,dh]], h, w, r, cHalf, c, base, halfBase }
let moveDrag = null;  // { mode:'select'|'move', grid, id, lastX, lastY, ... }
let moveHalfStep = false; // 이동 단위 토글: false=1노트(한 칸), true=반박자(반 칸)
let moveSnapshot = null;     // mvTrack.grid 복사 — 취소 복원용
let moveSnapshotHalf = null; // mvTrack.half 복사 — 취소 복원용(반박자)
const clampi = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const trackRowCount = (t) => (t.type === "drums" ? DRUM_ROWS : MELODY_NOTES).length;

function clearMoveSelClasses(track) {
  if (!track.cellEls) return;
  for (const row of track.cellEls) for (const el of row) if (el) el.classList.remove("move-sel");
}
function paintSelRect(track, r0, c0, r1, c1) {
  clearMoveSelClasses(track);
  const ra = Math.min(r0, r1), rb = Math.max(r0, r1), ca = Math.min(c0, c1), cb = Math.max(c0, c1);
  for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) {
    const el = track.cellEls[r] && track.cellEls[r][c];
    if (el) el.classList.add("move-sel");
  }
}
function refreshTrackCells(t) {
  if (!t.cellEls) return;
  for (let r = 0; r < t.cellEls.length; r++) for (let c = 0; c < steps; c++) {
    const el = t.cellEls[r] && t.cellEls[r][c];
    if (!el) continue;
    el.classList.toggle("on", !!t.grid[r][c]);
    el.classList.toggle("half-on", !!(t.half && t.half[r][c])); // 반박자도 함께 갱신
  }
}
// 들어올린 블록을 base 위에 현재 (r,c)로 다시 찍는다(격자 데이터 갱신 → 재생 반영).
function stampBlock() {
  if (!moveSel) return;
  const t = moveSel.track, g = t.grid, base = moveSel.base, hg = t.half, hbase = moveSel.halfBase;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) {
    g[r][c] = base[r][c];
    if (hg && hbase) hg[r][c] = hbase[r][c];
  }
  for (const [dr, dh] of moveSel.notes) {
    const H = moveSel.cHalf + dh;            // 절대 반박자 위치
    const rr = moveSel.r + dr, cc = Math.floor(H / 2), isHalf = H & 1; // 짝수=한 칸, 홀수=반칸
    if (rr < 0 || rr >= g.length || cc < 0 || cc >= steps) continue;   // 밖으로 나간 노트는 버림(잘림)
    if (isHalf) { if (hg) hg[rr][cc] = true; } else g[rr][cc] = true;  // 겹치면 덮어씀(합쳐짐)
  }
  refreshTrackCells(t);
  const c0 = Math.floor(moveSel.cHalf / 2);
  moveSel.c = c0; // 파생: 강조·경계 계산용 셀 왼쪽
  paintSelRect(t, moveSel.r, c0, moveSel.r + moveSel.h - 1, c0 + moveSel.w - 1 + (moveSel.cHalf & 1));
}
function finalizeSelection(d) {
  const r0 = Math.min(d.r0, d.r1), r1 = Math.max(d.r0, d.r1);
  const c0 = Math.min(d.c0, d.c1), c1 = Math.max(d.c0, d.c1);
  const t = mvTrack, notes = [];
  const base = t.grid.map((row) => row.slice());
  const halfBase = t.half ? t.half.map((row) => row.slice()) : null;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (t.grid[r][c]) { notes.push([r - r0, 2 * (c - c0)]); base[r][c] = false; }        // 한 칸 → 짝수 dh
    if (t.half && t.half[r][c]) { notes.push([r - r0, 2 * (c - c0) + 1]); halfBase[r][c] = false; } // 반칸 → 홀수 dh
  }
  moveSel = { track: t, notes, h: r1 - r0 + 1, w: c1 - c0 + 1, r: r0, cHalf: 2 * c0, c: c0, base, halfBase };
  stampBlock();
}
function cellAt(x, y, track) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest(".cell") : null;
  return (cell && cell._track === track && cell._r != null) ? { r: cell._r, c: cell._c } : null;
}
// 포인터 위치 아래의 '노트'를 콕 집는다 → {r, c, isHalf} 또는 null.
// 반칸 노트는 칸 중앙에서 시작해 다음 칸 절반까지(보이는 대로) 그려지므로, 그 시각 영역으로 판정한다.
// 칸 안 위치 frac(0~1): frac≥0.5면 이 칸(c)의 반칸, frac<0.5면 이전 칸(c-1)의 반칸이 여기까지 넘쳐 보임.
// 반칸(위에 그려짐)을 한 칸 노트보다 우선한다.
function noteAt(x, y, track) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest(".cell") : null;
  if (!cell || cell._track !== track || cell._r == null) return null;
  const r = cell._r, c = cell._c;
  const rect = cell.getBoundingClientRect();
  const frac = rect.width > 0 ? (x - rect.left) / rect.width : 0;
  const hc = frac >= 0.5 ? c : c - 1; // 이 위치에 보이는 반칸의 실제 칸
  if (track.half && hc >= 0 && track.half[r] && track.half[r][hc]) return { r, c: hc, isHalf: true };
  if (track.grid[r] && track.grid[r][c]) return { r, c, isHalf: false };
  return null;
}
function moveDown(e, grid, track) {
  const cell = e.target.closest(".cell");
  if (!cell || cell._r == null) return;
  e.preventDefault();
  try { grid.setPointerCapture(e.pointerId); } catch (x) {}
  const r = cell._r, c = cell._c;
  const wCells = moveSel ? moveSel.w + (moveSel.cHalf & 1) : 0; // 반박자로 밀리면 한 칸 더 걸침
  const inBlock = moveSel &&
    r >= moveSel.r && r < moveSel.r + moveSel.h && c >= moveSel.c && c < moveSel.c + wCells;
  if (inBlock) {
    let startHalf = 2 * c;
    if (moveHalfStep) { const rc = cell.getBoundingClientRect(); if (e.clientX >= rc.left + rc.width / 2) startHalf += 1; }
    moveDrag = { mode: "move", grid, id: e.pointerId, startR: r, startHalf, origR: moveSel.r, origCHalf: moveSel.cHalf, lastX: e.clientX, lastY: e.clientY };
  } else {
    moveSel = null; clearMoveSelClasses(track);
    moveDrag = { mode: "select", grid, id: e.pointerId, r0: r, c0: c, r1: r, c1: c, lastX: e.clientX, lastY: e.clientY };
    paintSelRect(track, r, c, r, c);
  }
}
// 포인터 위치로 선택/이동을 갱신. 트랙 뷰포트 밖으로 나가면 가장자리 칸으로 물려 계산한다.
function applyDragAt(x, y) {
  if (!moveDrag || !mvTrack || !mvTrack._hscroll) return;
  const r = mvTrack._hscroll.getBoundingClientRect();
  // 오른쪽·아래 24px는 스크롤바 영역이라 elementFromPoint가 셀을 못 잡는다 → 그만큼 안으로 물려 조회
  const cx = clampi(x, r.left + LABEL_W, r.right - 24), cy = clampi(y, r.top + 3, r.bottom - 24);
  const at = cellAt(cx, cy, mvTrack);
  if (!at) return;
  if (moveDrag.mode === "select") {
    moveDrag.r1 = at.r; moveDrag.c1 = at.c;
    paintSelRect(mvTrack, moveDrag.r0, moveDrag.c0, at.r, at.c);
  } else {
    // 포인터의 반박자 위치(반박자 모드면 칸 오른쪽 절반=+1). delta만큼 블록을 옮긴다.
    let curHalf = 2 * at.c;
    if (moveHalfStep) {
      const cel = mvTrack.cellEls[at.r] && mvTrack.cellEls[at.r][at.c];
      if (cel) { const rc = cel.getBoundingClientRect(); if (cx >= rc.left + rc.width / 2) curHalf += 1; }
    }
    const newCHalf = moveDrag.origCHalf + (curHalf - moveDrag.startHalf);
    const p = clampBlockPosHalf(moveDrag.origR + (at.r - moveDrag.startR), newCHalf);
    moveSel.r = p.r; moveSel.cHalf = p.cHalf;
    stampBlock();
    markDirty();
  }
}
// 이동 위치 클램프: 블록이 가장자리를 넘어가는 것을 허용하되(밖으로 나간 노트는 stampBlock이 버려 '잘림'),
// 최소 1칸은 격자에 남겨 다시 잡을 수 있게 한다.
function clampBlockPosHalf(r, cHalf) {
  const rows = trackRowCount(mvTrack);
  return { r: clampi(r, 1 - moveSel.h, rows - 1), cHalf: clampi(cHalf, 1 - 2 * moveSel.w, 2 * steps - 1) };
}
function moveMoveEv(e) {
  if (!moveDrag || e.pointerId !== moveDrag.id) return;
  moveDrag.lastX = e.clientX; moveDrag.lastY = e.clientY;
  applyDragAt(e.clientX, e.clientY);
  updateEdgeScroll(e.clientX, e.clientY); // 가장자리면 자동 스크롤 시작/정지
}
function moveUpEv(e, grid) {
  if (!moveDrag || e.pointerId !== moveDrag.id) return;
  try { grid.releasePointerCapture(e.pointerId); } catch (x) {}
  stopEdgeScroll();
  if (moveDrag.mode === "select") finalizeSelection(moveDrag);
  moveDrag = null;
}

// ── 드래그가 트랙 가장자리에 닿으면 그쪽으로 자동 스크롤(넘어가며 선택/이동 확장) ──
let edgeTimer = null;
const EDGE = 34, EDGE_SPEED = 16, LABEL_W = 60; // LABEL_W: 왼쪽 고정 라벨 폭 보정
function updateEdgeScroll(x, y) {
  const box = mvTrack && mvTrack._hscroll; if (!box) { stopEdgeScroll(); return; }
  const r = box.getBoundingClientRect();
  const near = x < r.left + LABEL_W + EDGE || x > r.right - EDGE || y < r.top + EDGE || y > r.bottom - EDGE;
  if (near) startEdgeScroll(); else stopEdgeScroll();
}
function startEdgeScroll() { if (!edgeTimer) edgeTimer = setInterval(edgeTick, 30); }
function stopEdgeScroll() { if (edgeTimer) { clearInterval(edgeTimer); edgeTimer = null; } }
function edgeTick() {
  if (!moveDrag || !mvTrack || !mvTrack._hscroll) { stopEdgeScroll(); return; }
  const box = mvTrack._hscroll, r = box.getBoundingClientRect();
  const x = moveDrag.lastX, y = moveDrag.lastY;
  let vx = 0, vy = 0;
  if (x < r.left + LABEL_W + EDGE) vx = -EDGE_SPEED;
  else if (x > r.right - EDGE) vx = EDGE_SPEED;
  if (y < r.top + EDGE) vy = -EDGE_SPEED;
  else if (y > r.bottom - EDGE) vy = EDGE_SPEED;
  if (!vx && !vy) { stopEdgeScroll(); return; }
  const bl = box.scrollLeft, bt = box.scrollTop;
  box.scrollLeft += vx; box.scrollTop += vy;
  if (box.scrollLeft === bl && box.scrollTop === bt) { stopEdgeScroll(); return; } // 더 못 감
  applyDragAt(x, y); // 새로 드러난 칸까지 선택/이동을 이어간다
}
// 전체 선택: 이 트랙 전 범위를 골라 모든 노트를 들어올린다.
function selectAllInMove() {
  if (!moveMode || !mvTrack) return;
  finalizeSelection({ r0: 0, c0: 0, r1: trackRowCount(mvTrack) - 1, c1: steps - 1 });
}
// dcHalf = 가로 이동량(반박자 단위). 화살표는 1노트=±2, 반박자모드=±1을 넘긴다.
function moveNudge(dr, dcHalf) {
  if (!moveMode || !moveSel) return;
  const p = clampBlockPosHalf(moveSel.r + dr, moveSel.cHalf + dcHalf);
  moveSel.r = p.r; moveSel.cHalf = p.cHalf;
  stampBlock();
  ensureBlockVisible();
  markDirty();
}
// 화살표로 시야 밖까지 옮겨도 따라가 보이게
function ensureBlockVisible() {
  const t = mvTrack; if (!t || !t._hscroll || !moveSel) return;
  const rr = clampi(moveSel.r, 0, trackRowCount(t) - 1), cc = clampi(moveSel.c, 0, steps - 1);
  const el = t.cellEls && t.cellEls[rr] && t.cellEls[rr][cc]; if (!el) return;
  const sc = t._hscroll, cr = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  if (cr.left < sr.left + LABEL_W) sc.scrollLeft -= (sr.left + LABEL_W - cr.left);
  else {
    const right = cr.left + cr.width * moveSel.w;
    if (right > sr.right - 8) sc.scrollLeft += (right - (sr.right - 8));
  }
  if (cr.top < sr.top) sc.scrollTop -= (sr.top - cr.top);
  else {
    const bottom = cr.top + cr.height * moveSel.h;
    if (bottom > sr.bottom) sc.scrollTop += (bottom - sr.bottom);
  }
}
function enterMoveMode(track) {
  if (moveMode) return;
  moveMode = true; mvTrack = track; moveSel = null; moveDrag = null;
  moveSnapshot = track.grid.map((row) => row.slice()); // 이 트랙만 스냅샷(취소 복원)
  moveSnapshotHalf = track.half ? track.half.map((row) => row.slice()) : null;
  if (moveBar) moveBar.hidden = false;
  if (typeof updateMvHalfLabel === "function") updateMvHalfLabel(); // 토글 라벨을 현재 상태와 맞춤
  render(); // 활성 트랙 버튼·스타일 반영(다른 트랙 이동 버튼 잠금 포함)
}
function exitMoveMode(commit) {
  if (!moveMode) return;
  const t = mvTrack;
  if (!commit && moveSnapshot && t) { // 취소: 복원(반박자 포함)
    t.grid = moveSnapshot.map((row) => row.slice());
    if (moveSnapshotHalf) t.half = moveSnapshotHalf.map((row) => row.slice());
  }
  moveMode = false; mvTrack = null; moveSel = null; moveDrag = null; moveSnapshot = null; moveSnapshotHalf = null;
  stopEdgeScroll();
  if (moveBar) moveBar.hidden = true;
  render(); // 격자 다시 그려 선택 표시·버튼 상태 정리
  if (commit) markDirty();
}

// ══════════════════════════════════════════════════════════════
//  재생
// ══════════════════════════════════════════════════════════════
let seq = null;

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

// 재생 중 매 스텝(Tone.Draw로 화면 타이밍에 맞춰) 호출 — 현재 위치를 플레이헤드로 옮긴다.
function highlightColumn(col) {
  playheadStep = col;
  updateTimeline(); // 핸들 이동 + 노란 열 표시
}

// ── 재생 위치(플레이헤드) + 타임라인 ────────────────────────────
let playheadStep = 0;   // '현재 시점' — 여기서 재생 시작. 재생 중엔 진행 위치를 따라 움직인다.
let playing = false;
let paused = false;   // 일시정지 상태(Transport.pause, 위치 유지). '현재' 버튼으로 이어재생.
let pausedStep = -1;  // 일시정지한 스텝. 이어서 할 때 핸들이 이 자리 그대로면 끊김 없이, 옮겼으면 그 자리에서 새로.
const timelineEl = document.getElementById("timeline");
const tlFill = document.getElementById("tlFill");
const tlHandle = document.getElementById("tlHandle");
const tlPos = document.getElementById("tlPos");
const tlEdit = document.getElementById("tlEdit");
// 노트 찍는(편집) 위치: 플레이바 초록 표식 + 격자에서 그 열을 옅은 초록으로 칠한다(재생 핸들은 안 건드림).
let editCol = -1, prevEditCol = -1;
function markEditColumn() {
  const col = editCol;
  for (const t of tracks) {
    if (!t.cellEls) continue;
    for (let r = 0; r < t.cellEls.length; r++) {
      if (prevEditCol >= 0 && t.cellEls[r][prevEditCol]) t.cellEls[r][prevEditCol].classList.remove("edit-col");
      if (col >= 0 && t.cellEls[r][col]) t.cellEls[r][col].classList.add("edit-col");
    }
  }
  prevEditCol = col;
}
function showEditMarker(col) {
  const pct = steps > 0 ? (col / steps) * 100 : 0;
  if (tlEdit) { tlEdit.style.left = pct + "%"; tlEdit.hidden = false; }
  editCol = col; markEditColumn();
}
function hideEditMarker() {
  if (tlEdit) tlEdit.hidden = true;
  editCol = -1; markEditColumn();
}

function stepToPos(step) {
  const bc = barCells();
  const bar = Math.floor(step / bc) + 1;
  const beat = Math.floor((step % bc) / beatUnit) + 1; // 한 박 = beatUnit칸, 한 마디 = bc칸
  return `${bar}마디 ${beat}박`;
}
let prevPlayheadCol = -1;
// 핸들 위치 열을 노란색으로(정지·재생 모두). 바뀐 두 열만 갱신.
function markPlayheadColumn() {
  const col = playheadStep;
  for (const t of tracks) {
    if (!t.cellEls) continue;
    for (let r = 0; r < t.cellEls.length; r++) {
      if (prevPlayheadCol >= 0 && t.cellEls[r][prevPlayheadCol]) t.cellEls[r][prevPlayheadCol].classList.remove("playhead-col");
      if (t.cellEls[r][col]) t.cellEls[r][col].classList.add("playhead-col");
    }
  }
  prevPlayheadCol = col;
}
function updateTimeline() {
  if (playheadStep > steps - 1) playheadStep = 0;
  const pct = steps > 0 ? (playheadStep / steps) * 100 : 0;
  tlHandle.style.left = pct + "%";
  tlFill.style.width = pct + "%";
  tlPos.textContent = stepToPos(playheadStep);
  markPlayheadColumn();
}
function setPlayhead(step) {
  playheadStep = Math.max(0, Math.min(steps - 1, Math.round(step)));
  updateTimeline();
}
function tlStepFromEvent(e) {
  const rect = timelineEl.getBoundingClientRect();
  return ((e.clientX - rect.left) / rect.width) * steps;
}
let tlDragging = false;
timelineEl.addEventListener("pointerdown", (e) => {
  if (playing) return;                 // 재생 중엔 핸들이 진행을 따라가므로 드래그 막음
  tlDragging = true;
  try { timelineEl.setPointerCapture(e.pointerId); } catch (err) {}
  setPlayhead(tlStepFromEvent(e));
});
timelineEl.addEventListener("pointermove", (e) => { if (tlDragging) setPlayhead(tlStepFromEvent(e)); });
const tlEnd = () => { tlDragging = false; };
timelineEl.addEventListener("pointerup", tlEnd);
timelineEl.addEventListener("pointercancel", tlEnd);

// ══════════════════════════════════════════════════════════════
//  세션 저장소 (곡 목록) — localStorage
// ══════════════════════════════════════════════════════════════
const LS_SESSIONS = "musik-maker.sessions";
const LS_ACTIVE = "musik-maker.activeId";
const LS_SYNC = "musik-maker.syncScroll";
// music-maker → musik-maker 이름 변경(2026). GitHub Pages 프로젝트 사이트는 같은 origin이라
// 예전 키가 그대로 읽힌다 → 새 키가 비어 있으면 예전 키 값을 한 번 옮겨 저장한 곡을 잃지 않게 한다.
function migrateOldStorageKeys() {
  const pairs = [
    ["music-maker.sessions", LS_SESSIONS],
    ["music-maker.activeId", LS_ACTIVE],
    ["music-maker.syncScroll", LS_SYNC],
  ];
  for (const [oldK, newK] of pairs) {
    try {
      if (localStorage.getItem(newK) == null) {
        const v = localStorage.getItem(oldK);
        if (v != null) localStorage.setItem(newK, v);
      }
    } catch {}
  }
}

let sessions = [];   // [{ id, name, updatedAt, data }]
let activeId = null;
let loading = false;   // 곡을 불러오는 동안 markDirty가 끼어들지 않게(불러오기는 '변경'이 아님)
let hasLoaded = false; // 첫 곡을 아직 안 열었으면 이탈 가드가 빈 편집기를 건드리지 않게

function genId() { return "s" + Date.now() + Math.floor(Math.random() * 1000); }

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; /* 용량 초과 등 → 저장 실패 */ } }

function loadSessionsFromStorage() {
  migrateOldStorageKeys(); // 예전(music-maker) 저장을 새 키로 옮긴 뒤 읽는다
  const raw = lsGet(LS_SESSIONS);
  if (raw) { try { sessions = JSON.parse(raw) || []; } catch { sessions = []; } }
  activeId = lsGet(LS_ACTIVE);
}
function persistSessions() { return lsSet(LS_SESSIONS, JSON.stringify(sessions)); }

// 현재 편집 상태 → 저장용 데이터
function serialize() {
  return {
    bpm: Number(bpm.value),
    bars,
    beatUnit,
    barBeats,
    zoom: zoomIdx,   // 가로 줌 단계(뷰 상태) — 공유 링크엔 안 담김
    zoomV: zoomHIdx, // 세로 줌 단계(뷰 상태)
    sounds: soundLib.map((s) => ({ ...s })), // 커스텀 소리 라이브러리
    tracks: tracks.map((t) => ({
      type: t.type,
      instrument: t.instrument, // 기본악기 | null(드럼) | "snd:<id>"
      name: t.name,
      muted: t.muted,
      collapsed: !!t.collapsed,
      volume: t.volume ?? 0,
      reverb: !!t.reverb,
      grid: t.grid.map((row) => row.slice()),
      half: (t.half || []).map((row) => row.slice()), // 반칸(32분음표) 노트
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
  beatUnit = data.beatUnit || 4;
  barBeats = data.barBeats || 4;
  zoomIdx = Math.max(0, Math.min(ZOOM_WIDTHS.length - 1, data.zoom ?? 2)); // 가로 줌 복원(뷰)
  zoomW = ZOOM_WIDTHS[zoomIdx];
  zoomHIdx = Math.max(0, Math.min(ZOOM_HEIGHTS.length - 1, data.zoomV ?? 2)); // 세로 줌 복원(뷰)
  zoomH = ZOOM_HEIGHTS[zoomHIdx];
  updateZoomUI(); updateZoomVUI();
  steps = bars * barCells();
  if (beatInput) beatInput.value = beatUnit;
  if (barInput) barInput.value = barBeats;
  updateFooterHint();
  setBpm(data.bpm || 120, { silent: true }); // 곡 로드 시 템포 반영(저장 유발 안 함)

  for (const td of data.tracks || []) tracks.push(makeTrackObj(td.type, td));
  render();
  rebuildSequence();
  playheadStep = 0; playing = false; paused = false; updateTimeline(); hideEditMarker(); // 곡을 열면 재생 위치는 처음으로
  loading = false;
}

// 새 빈 곡의 기본 구성: 트랙 하나(피아노), 소리 라이브러리는 비어 있음.
function freshSongData() {
  return {
    bpm: 120,
    bars: 2,
    beatUnit: 4,
    barBeats: 4,
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

// 저장은 '저장' 버튼을 누를 때만 한다(자동 저장 없음). markDirty는 '저장 안 됨' 표시만 켠다.
let dirty = false;
let saveFailed = false; // 마지막 저장이 용량 초과 등으로 실패했는가(성공했다고 착각하지 않게)
function markDirty() {
  if (loading) return;
  dirty = true;
  updateSaveButton();
}
function saveActive() {
  const s = activeSession();
  if (!s) return false;
  s.data = serialize();
  s.updatedAt = Date.now();
  // 최근 수정한 곡을 목록 맨 위로
  sessions = [s, ...sessions.filter((x) => x.id !== s.id)];
  const ok = persistSessions(); // 실제 localStorage 기록 성공 여부
  renderSessionList();
  saveFailed = !ok;
  if (ok) dirty = false;        // 실패면 dirty 유지 → '저장됨'으로 속이지 않음
  updateSaveButton();
  return ok;
}

// 저장 버튼: 실패=빨강 경고, 변경 있음=파랑 '저장 *', 저장됨='저장됨'
const saveBtn = document.getElementById("saveSong");
function updateSaveButton() {
  if (!saveBtn) return;
  if (saveFailed) {
    saveBtn.textContent = "⚠ 저장 실패";
    saveBtn.style.background = "#c0392b"; saveBtn.style.color = "#fff";
    saveBtn.title = "저장 공간이 가득 찼습니다 — 오디오 샘플이나 곡을 줄여 보세요";
  } else if (dirty) {
    saveBtn.textContent = "💾 저장 *";
    saveBtn.style.background = "#3b6ef0"; saveBtn.style.color = "#fff";
    saveBtn.title = "저장하지 않은 변경이 있습니다 — 눌러서 저장";
  } else {
    saveBtn.textContent = "💾 저장됨";
    saveBtn.style.background = ""; saveBtn.style.color = "";
    saveBtn.title = "저장된 상태입니다";
  }
}
if (saveBtn) saveBtn.addEventListener("click", () => {
  if (!activeSession()) return;
  if (saveActive()) showToast("저장됨 ✓");
  else showToast("저장 실패 — 저장 공간이 가득 찼어요. 오디오 샘플을 줄이거나 곡을 지워 보세요.");
});

// 저장 안 된 변경이 있으면 곡을 떠나기 전 물어본다(확인=저장, 취소=버림). 어느 쪽이든 이동은 진행.
function guardUnsaved() {
  if (!dirty) return;
  if (confirm("저장하지 않은 변경이 있습니다.\n\n[확인] 저장하고 이동   [취소] 저장하지 않고 이동")) saveActive();
  else { dirty = false; updateSaveButton(); }
}
// 창을 닫거나 새로고침할 때 저장 안 된 변경이 있으면 브라우저 기본 경고를 띄운다.
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

function openSession(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  // 전환 전에 '나가는' 곡의 저장 안 된 변경을 처리(저장할지 버릴지 물어봄)
  if (hasLoaded) guardUnsaved();
  activeId = id;
  lsSet(LS_ACTIVE, id);
  deserialize(s.data);
  hasLoaded = true;
  songNameEl.textContent = s.name;
  renderSessionList();
  dirty = false; saveFailed = false; updateSaveButton(); // 방금 불러온 곡은 저장된 상태
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
const songNameEl = document.getElementById("songName");

// 박자: 몇 칸마다 얕은 구분선을 그릴지. 바꾸면 격자 다시 그리고 안내문 갱신.
const beatInput = document.getElementById("beatNum");
const barInput = document.getElementById("barNum");
function updateFooterHint() {
  const el = document.getElementById("gridHint");
  if (el) el.textContent = `가로 = 시간(왼→오), 세로 = 음 높이 / 드럼 종류 · 한 박=${beatUnit}칸(얕은 선), 한 마디=${barBeats}박(굵은 선)`;
}
// 박(n) 또는 마디당 박수(m) 변경 → 마디 칸 수(barCells)가 바뀌므로 격자 길이도 다시 맞춘다(resizeAll).
// 마디 칸 수가 바뀌면 전체 길이(칸)를 최대한 유지하도록 마디 수(bars)를 다시 잡은 뒤 리사이즈한다.
function applyMeterChange() {
  bars = Math.max(1, Math.round(steps / barCells()));
  resizeAll();
  updateFooterHint();
}
function setBeatUnit(v, opts = {}) {
  v = Math.max(1, Math.min(12, Math.round(Number(v) || 4)));
  beatUnit = v;
  if (beatInput && !opts.keepInput) beatInput.value = String(v);
  applyMeterChange();
}
function setBarBeats(v, opts = {}) {
  v = Math.max(1, Math.min(16, Math.round(Number(v) || 4)));
  barBeats = v;
  if (barInput && !opts.keepInput) barInput.value = String(v);
  applyMeterChange();
}
if (beatInput) {
  beatInput.value = String(beatUnit);
  beatInput.addEventListener("input", () => { const n = Number(beatInput.value); if (n >= 1 && n <= 12) setBeatUnit(n, { keepInput: true }); });
  beatInput.addEventListener("change", () => setBeatUnit(beatInput.value));
}
if (barInput) {
  barInput.value = String(barBeats);
  barInput.addEventListener("input", () => { const n = Number(barInput.value); if (n >= 1 && n <= 16) setBarBeats(n, { keepInput: true }); });
  barInput.addEventListener("change", () => setBarBeats(barInput.value));
}

// 노트 이동 모드 툴바(진입 버튼은 트랙마다 있음). 확인/취소·화살표는 활성 트랙에 작용.
const moveBar = document.getElementById("moveBar");
const mvHalfBtn = document.getElementById("mvHalf");
function updateMvHalfLabel() {
  if (!mvHalfBtn) return;
  mvHalfBtn.textContent = moveHalfStep ? "이동: 반박자" : "이동: 1노트";
  mvHalfBtn.classList.toggle("active", moveHalfStep);
}
mvHalfBtn?.addEventListener("click", () => { moveHalfStep = !moveHalfStep; updateMvHalfLabel(); });
document.getElementById("mvAll")?.addEventListener("click", selectAllInMove);
document.getElementById("mvConfirm")?.addEventListener("click", () => exitMoveMode(true));
document.getElementById("mvCancel")?.addEventListener("click", () => exitMoveMode(false));
document.getElementById("mvUp")?.addEventListener("click", () => moveNudge(-1, 0));
document.getElementById("mvDown")?.addEventListener("click", () => moveNudge(1, 0));
document.getElementById("mvLeft")?.addEventListener("click", () => moveNudge(0, moveHalfStep ? -1 : -2));
document.getElementById("mvRight")?.addEventListener("click", () => moveNudge(0, moveHalfStep ? 1 : 2));

// 곡 길이(마디) 조절 — 트랙 격자 오른쪽 끝 ＋/－ 버튼이 부른다. 상한 없음, 최소 1마디.
function changeBars(delta) {
  const next = bars + delta;
  if (next < 1) return;
  bars = next;
  for (const t of tracks) t._scrollLeft = 1e9; // 조절 후에도 오른쪽 끝(버튼)이 보이게
  resizeAll();
}

// 템포 설정: 슬라이더·숫자입력을 함께 맞추고 Transport에 반영(40~220 클램프)
function setBpm(v, opts = {}) {
  v = Math.max(40, Math.min(220, Math.round(Number(v) || 120)));
  bpm.value = String(v);
  if (!opts.keepNum) bpmNum.value = String(v);
  Tone.Transport.bpm.value = v;
  if (!opts.silent) markDirty();
}

const btnPlayHere = document.getElementById("playHere");
// 재생 버튼 라벨을 상태에 맞춰 갱신: 재생 중=일시정지, 일시정지=이어서, 멈춤=현재.
function updateTransportButtons() {
  btnPlayHere.textContent = playing ? "⏸ 일시정지" : (paused ? "▶ 이어서" : "▶ 재생");
}
function pausePlayback() {
  Tone.Transport.pause();      // 위치를 유지한 채 멈춘다(이어재생 가능)
  playing = false; paused = true;
  pausedStep = playheadStep;   // 이 자리를 기억 — 이어서 할 때 핸들이 여기서 벗어났는지 본다
  updateTimeline();
  updateTransportButtons();
}
async function playFrom(fromStep, opts = {}) {
  if (playing) { pausePlayback(); return; } // 재생 중 재생버튼 클릭 = 일시정지(토글)
  await Tone.start();
  Tone.Transport.bpm.value = Number(bpm.value);
  // 일시정지 상태에서 '현재(이어서)' → 핸들이 멈췄던 자리 그대로면 끊김 없이 Transport만 재개.
  // 핸들을 옮겼으면(마디·박 위치 변경) 이 분기를 건너뛰어 아래에서 그 위치부터 새로 시작한다.
  if (paused && opts.resume && playheadStep === pausedStep) {
    paused = false; playing = true;
    Tone.Transport.start("+0.05");
    updateTransportButtons();
    return;
  }
  // 새로 시작(처음부터, 또는 일시정지 중 옮긴 위치부터). 이전 상태가 paused여도 깨끗이 다시 놓는다.
  paused = false;
  Tone.Transport.stop();
  if (seq) seq.stop();
  rebuildSequence();
  const N = Math.max(0, Math.min(steps - 1, Math.round(fromStep)));
  setPlayhead(N);
  playing = true;
  seq.start("+0.06");                 // 첫 이벤트를 살짝 뒤로 → 시작 순간 '과거 시각' 스케줄 경고 방지
  // 시작 위치 = N번째 16분음표(초 단위). 시각 격자(마디/박)와 무관하게 셀은 항상 16분음표다.
  Tone.Transport.start("+0.05", N * Tone.Time("16n").toSeconds());
  updateTransportButtons();
}
btnPlayHere.addEventListener("click", () => playFrom(playheadStep, { resume: true })); // 현재/이어서(재생 중이면 일시정지)
document.getElementById("stop").addEventListener("click", () => {
  Tone.Transport.stop();
  if (seq) seq.stop();
  playing = false; paused = false;
  updateTimeline(); // 멈춘 위치에 핸들·노란 열 유지(현재 시점 재생이 이어받음)
  updateTransportButtons();
});
bpm.addEventListener("input", () => setBpm(bpm.value));
// 숫자 입력: 타이핑 중엔 필드를 건드리지 않고(범위 내면 반영), 확정(blur/Enter) 때 클램프
bpmNum.addEventListener("input", () => {
  const n = Number(bpmNum.value);
  if (n >= 40 && n <= 220) setBpm(n, { keepNum: true });
});
bpmNum.addEventListener("change", () => setBpm(bpmNum.value));
// 트랙 추가: 일단 만들고, 사운드(악기·드럼)는 트랙에서 고른다
document.getElementById("addTrack").addEventListener("click", () => addTrack("melody"));
document.getElementById("newSong").addEventListener("click", () => newSong(true));

// ── 트랙 고정(모든 트랙 가로 이동을 함께) ──────────────────────
let syncScroll = lsGet(LS_SYNC) === "1";
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
  lsSet(LS_SYNC, syncScroll ? "1" : "0");
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
// gzip 압축/해제(브라우저 내장 CompressionStream). 긴 곡의 공유 링크를 줄이는 데 쓴다.
// 격자는 대부분 0이라 압축이 아주 잘 된다. 지원 안 하는 브라우저면 무압축(#song=)으로 폴백.
const gzipSupported = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
async function gzipBytes(u8) {
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzipBytes(u8) {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
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

// 격자(불리언 2차원)를 비트로 패킹 — 트랙마다 바이트 정렬(readGrid가 ceil(rows*steps/8)바이트로 읽음).
function packGrid(bytes, grid) {
  let cur = 0, nb = 0;
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[r].length; c++) {
      cur = (cur << 1) | (grid[r][c] ? 1 : 0);
      if (++nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
    }
  if (nb > 0) bytes.push(cur << (8 - nb));
}

// 버전 6: 반칸(32분음표) 격자 추가. (v1~v5 링크도 decodeShare가 계속 연다)
// 원시 바이트(base64 전)를 돌려준다 — 공유 URL 만들 때 필요하면 gzip으로 압축한다.
function encodeShareBytes(name, data) {
  const bytes = [];
  bytes.push(7);
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
    bytes.push(t.reverb ? 1 : 0);             // v7: 트랙 잔향(리버브)
    pushName(bytes, t.name);
    packGrid(bytes, t.grid);                          // 칸(16분음표) 격자
    const emptyHalf = t.grid.map((row) => row.map(() => false));
    packGrid(bytes, t.half && t.half.length ? t.half : emptyHalf); // v6: 반칸(32분음표) 격자
  }
  return Uint8Array.from(bytes);
}

function decodeShare(code) { return decodeShareBytes(b64urlToBytes(code)); }
function decodeShareBytes(b) {
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
  if (![1, 2, 3, 4, 5, 6, 7].includes(ver)) throw new Error("알 수 없는 공유 버전");
  const name = readName();
  const bpm = b[i++];
  const bars = b[i++];
  const steps = bars * 16; // 공유 코덱은 4/4·16칸 마디를 가정(박자 n×m은 링크에 안 담김)
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
      const reverb = ver >= 7 ? (b[i++] === 1) : false; // v7: 트랙 잔향
      const tname = readName();
      const nrows = type === "drums" ? DRUM_ROWS.length : melodyRows;
      const grid = readGrid(nrows);
      const half = ver >= 6 ? readGrid(nrows) : null; // v6: 반칸(32분음표) 격자
      tracks.push({ type, instrument, name: tname, muted, volume, reverb, grid, half });
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

async function openShareModal() {
  const s = activeSession();
  if (!s) return;
  // 공유는 '저장 여부와 무관하게' 지금 화면의 편집 상태를 담는다(serialize).
  let url, err = null;
  try {
    const raw = encodeShareBytes(s.name, serialize());
    const base = location.origin + location.pathname;
    const rawB64 = bytesToB64url(raw);
    // 짧은 곡은 기존 무압축(#song=, 어느 브라우저나 열림). 길면 gzip 압축(#songz=)해 링크를 확 줄인다.
    url = base + "#song=" + rawB64;
    if (rawB64.length > 1200 && gzipSupported()) {
      try {
        const gzB64 = bytesToB64url(await gzipBytes(raw));
        if (gzB64.length < rawB64.length) url = base + "#songz=" + gzB64;
      } catch (e) { /* 압축 실패 → 무압축 유지 */ }
    }
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
      note.textContent = "⚠ 지금은 이 컴퓨터에서만 열리는 주소(localhost)입니다. 다른 기기에서 열려면 앱을 공개 주소(예: GitHub Pages)에 올려야 합니다. 링크 전체를 그대로 옮겨서 씁니다.";
      modalBody.appendChild(note);
    }
  }
  modal.hidden = false;
}
function closeModal() { modal.hidden = true; sampleEditorOpenId = null; }

// ── 신디사이저: 소리 관리자 + 음색 편집기 ─────────────────────
const WAVE_LABEL = { sine: "사인 ∿", triangle: "삼각 △", square: "사각 ⊓", sawtooth: "톱니 ◺" };

// 소리 목록 관리자: 추가/편집/이름변경/삭제
function openSoundManager() {
  sampleEditorOpenId = null; // 샘플 편집기를 벗어남(로드 후 자동 갱신이 되돌리지 않게)
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

  // 악기 프리셋 — 뭘 만들지 막막할 때: 누르면 그 악기 근사 소리를 만들어 편집기로 연다.
  const presetTitle = document.createElement("p");
  presetTitle.style.cssText = "margin:16px 0 6px;color:var(--muted);font-size:13px;";
  presetTitle.textContent = "악기로 시작하기 — 누르면 비슷한 소리를 만들어 드려요 (만든 뒤 다듬을 수 있어요)";
  modalBody.appendChild(presetTitle);
  const presetGrid = document.createElement("div");
  presetGrid.className = "preset-grid";
  for (const preset of INSTRUMENT_PRESETS) {
    const b = document.createElement("button");
    b.className = "preset-btn";
    b.innerHTML = `<span class="preset-emoji">${preset.emoji}</span><span>${escapeHtml(preset.name)}</span>`;
    b.addEventListener("click", () => addPresetSound(preset));
    presetGrid.appendChild(b);
  }
  modalBody.appendChild(presetGrid);

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
      ? `오디오 샘플 · 음정 이식 · 기준음 ${snd.baseNote || "C4"}${usedTxt}`
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
    const s = { id: genSoundId(), name, kind: "sample", audio: reader.result, baseNote: "C4", baseAuto: true, volume: -6 };
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

  // 맨 위 미리듣기(설정값 위에서도 바로 들어볼 수 있게)
  const topPrev = document.createElement("button");
  topPrev.className = "synth-preview-top";
  topPrev.textContent = "▶ 미리듣기";
  topPrev.addEventListener("click", () => playSoundPreview(sound));
  modalBody.appendChild(topPrev);

  let curBody = modalBody; // 현재 필드가 담길 곳(그룹 body 또는 modalBody)

  section("기본");
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
  addField("파형", waveRow, "소리의 기본 재질. 사인=순함, 삼각=살짝 부드럽게, 사각=레트로, 톱니=밝고 꽉 참.");

  slider("어택 (시작 빠르기)", "attack", 0, 2, 0.005, "s", (v) => v.toFixed(3), "최대 크기까지 걸리는 시간. 짧으면 '탁', 길면 '스르륵'.");
  slider("디케이 (감쇠)", "decay", 0, 2, 0.005, "s", (v) => v.toFixed(3), "최대 뒤 서스테인 크기까지 줄어드는 시간.");
  slider("서스테인 (지속 크기)", "sustain", 0, 1, 0.01, "", (v) => v.toFixed(2), "누르고 있는 동안 유지되는 크기.");
  slider("릴리스 (여운)", "release", 0, 3, 0.01, "s", (v) => v.toFixed(2), "뗀 뒤 사라지는 여운.");

  section("필터 (밝기·질감)");
  dropdown("필터 종류", "filterType", FILTER_TYPES, "통과 대역. 로우패스=낮은 쪽(둥글게), 하이패스=높은 쪽(얇게), 밴드패스=가운데.");
  slider("컷오프 (밝기)", "cutoff", 200, 8000, 10, "Hz", (v) => Math.round(v), "자르기 시작하는 지점. 낮추면 먹먹, 높이면 선명.");
  slider("공명 (Resonance)", "resonance", 0.5, 12, 0.1, "", (v) => v.toFixed(1), "컷오프를 뾰족하게 강조. 올리면 '삑/뿅'(과하면 삑사리).");
  slider("필터 움직임", "filterEnvAmount", 0, 6, 0.1, "oct", (v) => v.toFixed(1), "소리 나는 동안 밝기가 저절로 열림. 0이면 고정.");
  slider("필터 속도", "filterDecay", 0.02, 1.5, 0.01, "s", (v) => v.toFixed(2), "필터 움직임이 열렸다 닫히는 빠르기.");

  section("두께", false);
  slider("두께 (디튠)", "detune", 0, 60, 1, "", (v) => Math.round(v), "어긋난 소리를 겹쳐 두툼하게(슈퍼소우). 0이면 홑겹.");

  section("이펙트", false);
  slider("디스토션", "distortion", 0, 1, 0.01, "", (v) => v.toFixed(2), "찌그러뜨려 거칠게. 0이면 끔.");
  slider("비트크러셔", "bitcrush", 0, 1, 0.01, "", (v) => v.toFixed(2), "해상도를 낮춰 8비트 레트로. 0이면 끔.");
  slider("코러스", "chorus", 0, 1, 0.01, "", (v) => v.toFixed(2), "복사본을 겹쳐 넓고 몽환적으로. 0이면 끔.");

  section("흔들림 (모듈레이션)", false);
  slider("비브라토", "vibrato", 0, 1, 0.01, "", (v) => v.toFixed(2), "음정이 규칙적으로 떨림. 0이면 끔.");
  slider("트레모로", "tremolo", 0, 1, 0.01, "", (v) => v.toFixed(2), "볼륨이 규칙적으로 떨림. 0이면 끔.");

  section("");
  slider("볼륨", "volume", -30, 0, 1, "dB", (v) => Math.round(v), "이 소리의 크기.");

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

  // 접었다 폈다 하는 설정 그룹. title이 없으면 그룹 없이(볼륨 등) modalBody에 바로 담는다.
  function section(title, open = true) {
    if (!title) {
      const h = document.createElement("div");
      h.className = "synth-section blank";
      modalBody.appendChild(h);
      curBody = modalBody;
      return;
    }
    const group = document.createElement("div");
    group.className = "synth-group" + (open ? "" : " collapsed");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "synth-group-head";
    head.setAttribute("aria-expanded", String(open));
    const t = document.createElement("span");
    t.className = "synth-group-title"; t.textContent = title;
    const arrow = document.createElement("span");
    arrow.className = "synth-group-arrow"; arrow.textContent = "▾";
    head.append(t, arrow);
    const body = document.createElement("div");
    body.className = "synth-group-body";
    head.addEventListener("click", () => {
      const collapsed = group.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
    });
    group.append(head, body);
    modalBody.appendChild(group);
    curBody = body; // 이후 addField는 이 그룹 안으로 들어간다
  }
  // help가 있으면 라벨 옆에 ? 버튼을 달고, 누르면 아래로 설명이 펼쳐진다.
  function addField(label, control, help) {
    const wrap = document.createElement("div");
    wrap.className = "synth-field";
    const head = document.createElement("div");
    head.className = "synth-label";
    const txt = document.createElement("span");
    txt.textContent = label;
    head.appendChild(txt);
    if (help) {
      const q = document.createElement("button");
      q.type = "button"; q.className = "help-btn"; q.textContent = "?";
      q.setAttribute("aria-label", label + " 설명");
      const tip = document.createElement("div");
      tip.className = "synth-help"; tip.textContent = help; tip.hidden = true;
      q.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); tip.hidden = !tip.hidden; });
      head.appendChild(q);
      wrap.appendChild(head);
      wrap.appendChild(tip);
    } else {
      wrap.appendChild(head);
    }
    wrap.appendChild(control);
    curBody.appendChild(wrap); // 현재 열린 그룹(또는 modalBody)에 담는다
  }
  function slider(label, key, min, max, step, unit, fmt, help) {
    const control = document.createElement("div");
    control.className = "synth-slider";
    const input = document.createElement("input");
    input.type = "range";
    input.min = min; input.max = max; input.step = step;
    input.value = sound[key] ?? min;
    const val = document.createElement("span");
    val.className = "synth-val";
    const show = () => { val.textContent = fmt(Number(input.value)) + unit; };
    show();
    input.addEventListener("input", () => {
      sound[key] = Number(input.value);
      show();
      applySoundToTracks(sound); markDirty();
    });
    control.appendChild(input);
    control.appendChild(val);
    addField(label, control, help);
  }
  function dropdown(label, key, opts, help) {
    const sel = document.createElement("select");
    for (const [v, t] of opts) {
      const o = document.createElement("option"); o.value = v; o.textContent = t;
      if ((sound[key] ?? opts[0][0]) === v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => { sound[key] = sel.value; applySoundToTracks(sound); markDirty(); playSoundPreview(sound); });
    addField(label, sel, help);
  }
}

// 소리 미리듣기: 그 소리로 임시 신스(+이펙트)를 만들어 짧은 코드 한 번. 실제 재생과 같은 엔진.
async function playSoundPreview(sound) {
  await Tone.start();
  const poly = new Tone.PolySynth(Tone.MonoSynth, monoSynthOpts(sound));
  poly.volume.value = sound.volume;
  const fx = buildFxChain(poly, sound, realtimeMaster());
  poly.triggerAttackRelease(["C4", "E4", "G4"], "8n");
  setTimeout(() => {
    try { poly.dispose(); for (const k in fx) fx[k].dispose(); } catch (e) {}
  }, 1800);
}

// ── 오디오 샘플 소리 편집기 ────────────────────────────────────
// 기준 음 후보: 넓은 반음 범위(C2~B5). 자동 감지 결과가 어디로 나와도 목록에 들어오게 한다.
const SAMPLE_BASE_NOTES = (() => {
  const arr = []; for (let o = 2; o <= 5; o++) for (const n of NOTE_NAMES) arr.push(n + o); return arr;
})();
let sampleEditorOpenId = null; // 현재 열린 샘플 편집기(로드 후 자동 갱신용)
function rebuildTracksUsing(sound) {
  for (const t of tracks) if (t.instrument === "snd:" + sound.id) t.synth = buildSynth(t);
}
function openSampleEditor(sound) {
  sampleEditorOpenId = sound.id;
  modalTitle.textContent = "🎵 " + sound.name;
  modalBody.innerHTML = "";

  const back = document.createElement("button");
  back.textContent = "‹ 소리 목록"; back.style.marginBottom = "10px";
  back.addEventListener("click", openSoundManager);
  modalBody.appendChild(back);

  const intro = document.createElement("p");
  intro.textContent = "불러온 오디오를 음정에 맞춰 재생합니다(샘플러). '기준 음'은 이 파일이 원래 내는 음 — 그 음 칸에 찍으면 원본 그대로, 다른 음은 그만큼 올리거나 내려서 냅니다. 파일을 올리면 자동으로 감지해 채웁니다.";
  modalBody.appendChild(intro);

  // 기준 음(이 파일의 원래 음) + 자동 감지
  const baseWrap = document.createElement("label");
  baseWrap.className = "synth-field";
  baseWrap.innerHTML = `<div class="synth-label">기준 음 (이 파일의 원래 음)</div>`;
  const baseRow = document.createElement("div"); baseRow.className = "share-row";
  const baseSel = document.createElement("select");
  for (const n of SAMPLE_BASE_NOTES) {
    const o = document.createElement("option"); o.value = n; o.textContent = n;
    if ((sound.baseNote || "C4") === n) o.selected = true;
    baseSel.appendChild(o);
  }
  // 사용자가 직접 고르면 자동 감지가 다시 덮어쓰지 않도록 baseAuto 해제. 기준음은 소리에 영향 → 재생성.
  baseSel.addEventListener("change", () => { sound.baseNote = baseSel.value; sound.baseAuto = false; rebuildTracksUsing(sound); markDirty(); });
  const detectBtn = document.createElement("button");
  detectBtn.type = "button"; detectBtn.textContent = "🎯 자동 감지";
  detectBtn.addEventListener("click", () => {
    const buf = sampleBuffers[sound.id];
    if (!buf || !buf.loaded) { showToast("샘플을 불러오는 중입니다…"); return; }
    const nm = freqToNoteName(detectSampleFreq(buf));
    if (nm) { sound.baseNote = nm; sound.baseAuto = true; rebuildTracksUsing(sound); markDirty(); openSampleEditor(sound); showToast("감지된 음: " + nm); }
    else showToast("음높이를 감지하지 못했습니다");
  });
  baseRow.appendChild(baseSel); baseRow.appendChild(detectBtn);
  baseWrap.appendChild(baseRow);
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
  // 기준음을 한 번 재생 = 원본 그대로(감기 없음). 악보에서 기준음 칸에 찍었을 때와 같은 소리.
  const base = sound.baseNote || "C4";
  const sampler = new Tone.Sampler({ urls: { [base]: buf } }).connect(realtimeMaster());
  sampler.volume.value = sound.volume ?? -6;
  sampler.triggerAttackRelease(base, buf.duration); // 녹음 전체 길이만큼 울린다(끊기지 않게)
  setTimeout(() => sampler.dispose(), (buf.duration + 0.5) * 1000);
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
  const halfOff = secondsPerStep / 2; // 반칸 = 한 칸(16분음표)의 절반 뒤
  const fire = (gridArr, c, time) => {
    if (track.type === "drums") {
      for (let r = 0; r < rows.length; r++) {
        if (!gridArr[r][c]) continue;
        if (rows[r] === "킥") voices.hitKick(time);
        else if (rows[r] === "스네어") voices.hitSnare(time);
        else voices.hitHat(time);
      }
    } else {
      const notes = [];
      for (let r = 0; r < rows.length; r++) if (gridArr[r][c]) notes.push(rows[r]);
      if (notes.length) voices.poly.triggerAttackRelease(notes, voices.noteDur || secondsPerStep, time);
    }
  };
  for (let c = 0; c < steps; c++) {
    const time = c * secondsPerStep + 0.001; // 0에 딱 붙이면 첫 음이 씹혀서 살짝 민다
    fire(track.grid, c, time);
    if (track.half) fire(track.half, c, time + halfOff);
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
    // 여운: 기본 2초 + 울리는 샘플(녹음 전체 길이만큼 남)이 있으면 그 최대 길이만큼 더 준다.
    let tail = 2;
    for (const t of tracks) {
      const s = trackSound(t);
      const b = s && s.kind === "sample" ? sampleBuffers[s.id] : null;
      if (b && b.loaded) tail = Math.max(tail, b.duration + 0.3);
    }
    const duration = steps * secondsPerStep + tail;
    const buffer = await Tone.Offline(async () => {
      // 콜백 안에서 만든 Tone 노드는 오프라인 컨텍스트에 붙는다(재생용 신스는 안 건드림)
      const out = makeMaster(); // 재생과 동일한 마스터 소프트 클리퍼
      const vs = tracks.map((t) => ({ t, v: createVoices(t, out) }));
      // 리버브는 IR 생성이 끝나야 오프라인 렌더에 잔향이 담긴다 → 스케줄 전에 대기.
      await Promise.all(vs.map(({ v }) => { const rv = v.vol && v.vol._reverb; return rv && rv.generate ? rv.generate() : null; }).filter(Boolean));
      for (const { t, v } of vs) scheduleTrackOffline(t, v, secondsPerStep);
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

// 링크(#song=... 무압축 / #songz=... gzip 압축)로 들어왔으면 새 곡으로 가져온다
async function importFromHash() {
  const hash = location.hash || "";
  const mz = hash.match(/^#songz=(.+)$/);
  const m = mz || hash.match(/^#song=(.+)$/);
  if (!m) return null;
  try {
    let bytes = b64urlToBytes(m[1]);
    if (mz) bytes = await gunzipBytes(bytes); // 압축 링크는 먼저 푼다
    const d = decodeShareBytes(bytes);
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
// 압축 링크(#songz=) 해제가 비동기라 시작 흐름을 async로 감싼다.
(async () => {
  const importedId = await importFromHash();
  if (importedId) {
    openSession(importedId);          // 공유 링크로 들어옴 → 그 곡을 연다
    setTimeout(() => showToast("공유받은 곡을 내 곡 목록에 담았습니다"), 300);
  } else if (sessions.length === 0) {
    newSong(true);                    // 처음 방문: 빈 곡 하나 만들고 연다
  } else {
    openSession(activeSession() ? activeId : sessions[0].id); // 지난번 곡 이어서
  }
  setEditMode(false); // 시작은 편집 잠금(안전) — ✏️ 버튼으로 켠다
  updateZoomUI(); updateZoomVUI(); // 줌 버튼 활성/비활성·라벨 초기화
})();
