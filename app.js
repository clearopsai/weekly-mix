// Weekly Mix MVP app logic.
// One puzzle per day. Rotates modality by day-of-week. MVP ships with
// image-prompt guessing only; other modalities stub to image for now.
//
// Game loop:
//   1. Load today's puzzle (by UTC date) from ./puzzles/YYYY-MM-DD.json
//   2. Show the AI-generated image and a row of blank slots, one per target word
//   3. Player submits a guess (a word or phrase). Each word in the guess is
//      matched against the remaining target words via loose normalization and
//      simple synonym expansion. Matches reveal the corresponding slot.
//   4. Six guesses max. Win when all slots revealed. Lose otherwise.
//   5. Result is shared as a 6-row emoji grid (🟩 row-hit, 🟨 partial, ⬛ miss).
//
// No backend. LocalStorage tracks today-played and streak.

const MAX_GUESSES = 6;
const STORAGE_KEY = "weekly_mix_state_v1";
const STREAK_KEY = "weekly_mix_streak_v1";

const MODALITY_BY_DOW = {
  0: { name: "SUNDAY MEGA",  tag: "mega mix",         src: "image" },
  1: { name: "MIDJOURNEY MONDAY", tag: "image prompt",    src: "image" },
  2: { name: "ELEVENLABS TUESDAY", tag: "voice id",       src: "image" },
  3: { name: "SUNO WEDNESDAY",     tag: "sound id",       src: "image" },
  4: { name: "RUNWAY THURSDAY",    tag: "motion clip",    src: "image" },
  5: { name: "CLAUDE FRIDAY",      tag: "story trap",     src: "image" },
  6: { name: "VIBE SATURDAY",      tag: "vibe mix",       src: "image" },
};

// Lightweight synonym map so "picture" matches "image", "old" matches "vintage".
// Covers the most common near-miss cases for image prompts. Extended per puzzle
// via the "synonyms" block in the puzzle JSON.
const GLOBAL_SYNONYMS = {
  picture: ["image", "photo"],
  photo: ["image", "picture"],
  image: ["picture", "photo"],
  old: ["vintage", "aged", "ancient"],
  woman: ["lady", "female", "girl"],
  man: ["guy", "male", "gentleman"],
  cat: ["feline", "kitten"],
  dog: ["canine", "puppy"],
  house: ["home", "building"],
  car: ["vehicle", "automobile"],
  dark: ["black", "shadowy"],
  bright: ["light", "luminous"],
  big: ["large", "huge", "giant"],
  small: ["tiny", "little", "miniature"],
  forest: ["woods", "jungle"],
  night: ["evening", "dusk"],
  day: ["morning", "afternoon"],
  happy: ["joyful", "smiling"],
  sad: ["melancholy", "crying"],
};

// ---- util ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function getUTCDateKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalize(word) {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(phrase) {
  return normalize(phrase)
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function matchWord(guessWord, target, extraSyns = {}) {
  const g = normalize(guessWord);
  const t = normalize(target);
  if (!g || !t) return false;
  if (g === t) return true;
  // plural/singular
  if (g + "s" === t || g === t + "s") return true;
  if (g.endsWith("ing") && t === g.slice(0, -3)) return true;
  if (t.endsWith("ing") && g === t.slice(0, -3)) return true;
  // synonym lookup
  const syns = (GLOBAL_SYNONYMS[t] || []).concat(extraSyns[t] || []);
  if (syns.map(normalize).includes(g)) return true;
  const reverseSyns = (GLOBAL_SYNONYMS[g] || []).concat(extraSyns[g] || []);
  if (reverseSyns.map(normalize).includes(t)) return true;
  return false;
}

// ---- state ----
let puzzle = null;
let guesses = [];
let revealed = new Set(); // indices into puzzle.targets
let gameOver = false;
let won = false;

function loadTodayState(dateKey) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.date !== dateKey) return null;
    return s;
  } catch { return null; }
}

function saveTodayState(dateKey) {
  const s = {
    date: dateKey,
    guesses,
    revealed: Array.from(revealed),
    gameOver,
    won,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function bumpStreakIfWon(dateKey) {
  if (!won) return;
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    const s = raw ? JSON.parse(raw) : { current: 0, last: null, best: 0 };
    // Already counted today
    if (s.last === dateKey) return;
    // Check if yesterday
    const y = new Date();
    y.setUTCDate(y.getUTCDate() - 1);
    const yKey = getUTCDateKey(y);
    s.current = s.last === yKey ? s.current + 1 : 1;
    s.last = dateKey;
    s.best = Math.max(s.best || 0, s.current);
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  } catch {}
}

// ---- rendering ----
function renderMeta(dateKey) {
  const d = new Date(dateKey + "T00:00:00Z");
  const mod = MODALITY_BY_DOW[d.getUTCDay()];
  $("#tagline").textContent = mod.tag;
  $("#puzzle-day").textContent = mod.name;
  // Puzzle number = days since epoch anchor
  const anchor = new Date("2026-04-13T00:00:00Z");
  const diff = Math.floor((d - anchor) / 86400000);
  $("#puzzle-number").textContent = `# ${Math.max(1, diff + 1).toString().padStart(3, "0")}`;
}

function renderTargets() {
  const row = $("#target-row");
  row.innerHTML = "";
  puzzle.targets.forEach((t, i) => {
    const el = document.createElement("span");
    el.className = "slot" + (revealed.has(i) ? " revealed" : "");
    el.textContent = revealed.has(i) ? t : "_".repeat(Math.max(4, t.length));
    row.appendChild(el);
  });
  $("#target-count").textContent = puzzle.targets.length;
}

function renderHistory() {
  const h = $("#history");
  h.innerHTML = "";
  guesses.forEach((g) => {
    const row = document.createElement("div");
    row.className = "guess-row";
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = g.text;
    const tiles = document.createElement("div");
    tiles.className = "tiles";
    g.tilePattern.forEach((t) => {
      const d = document.createElement("div");
      d.className = "tile " + t;
      tiles.appendChild(d);
    });
    const score = document.createElement("div");
    score.className = "score";
    score.textContent = `${g.hits}/${puzzle.targets.length}`;
    row.appendChild(text);
    row.appendChild(tiles);
    row.appendChild(score);
    h.appendChild(row);
  });
}

function renderGuessesLeft() {
  $("#guesses-left").textContent = Math.max(0, MAX_GUESSES - guesses.length);
}

function renderEndgame(dateKey) {
  $("#endgame").classList.remove("hidden");
  $("#guess-form").classList.add("hidden");
  const title = won ? "SOLVED." : "TOMORROW.";
  $("#endgame-title").textContent = title;
  const subtitle = won
    ? `${guesses.length}/${MAX_GUESSES} guesses. streak kept.`
    : `you got ${revealed.size} of ${puzzle.targets.length}. back tomorrow at 00:00 UTC.`;
  $("#endgame-subtitle").textContent = subtitle;
  $("#endgame-grid").textContent = buildEmojiGrid();
}

function buildEmojiGrid() {
  // Tile pattern per guess row. Each guess row is padded/truncated to
  // puzzle.targets.length squares. Plus header line with puzzle # and score.
  const d = new Date(puzzle.date + "T00:00:00Z");
  const mod = MODALITY_BY_DOW[d.getUTCDay()];
  const anchor = new Date("2026-04-13T00:00:00Z");
  const num = Math.max(1, Math.floor((d - anchor) / 86400000) + 1);
  const scoreLine = won ? `${guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const header = `Weekly Mix #${String(num).padStart(3, "0")} ${scoreLine}  (${mod.tag})`;
  const rows = guesses.map((g) => {
    return g.tilePattern
      .map((t) => (t === "hit" ? "🟩" : t === "close" ? "🟨" : "⬛"))
      .join("");
  });
  return header + "\n" + rows.join("\n") + "\nclearopsai.io/weekly-mix";
}

// ---- game ----
function buildTilePatternForGuess(guessTokens, targets, alreadyRevealed, extraSyns) {
  // For each target slot, mark hit if any token in this guess matches it
  // AND the slot wasn't already revealed by a prior guess.
  const pattern = [];
  const newlyHit = [];
  targets.forEach((target, i) => {
    if (alreadyRevealed.has(i)) {
      pattern.push("hit");
      return;
    }
    let matched = false;
    for (const gw of guessTokens) {
      if (matchWord(gw, target, extraSyns)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      pattern.push("hit");
      newlyHit.push(i);
    } else {
      pattern.push("miss");
    }
  });
  return { pattern, newlyHit };
}

function handleGuess(text) {
  if (gameOver) return;
  const cleaned = text.trim();
  if (!cleaned) return;
  const tokens = tokenize(cleaned);
  const { pattern, newlyHit } = buildTilePatternForGuess(
    tokens,
    puzzle.targets,
    revealed,
    puzzle.synonyms || {}
  );
  newlyHit.forEach((i) => revealed.add(i));
  const hits = revealed.size;
  guesses.push({
    text: cleaned,
    tilePattern: pattern,
    hits,
  });
  if (revealed.size === puzzle.targets.length) {
    won = true;
    gameOver = true;
  } else if (guesses.length >= MAX_GUESSES) {
    gameOver = true;
  }
  saveTodayState(puzzle.date);
  if (gameOver) bumpStreakIfWon(puzzle.date);
  render();
}

function render() {
  renderTargets();
  renderHistory();
  renderGuessesLeft();
  if (gameOver) {
    renderEndgame(puzzle.date);
  }
}

async function loadPuzzle(dateKey) {
  // Try today's puzzle first. Fall back to the most recent bundled puzzle.
  const tryPaths = [
    `./puzzles/${dateKey}.json`,
    `./puzzles/fallback.json`,
  ];
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const p of tryPaths) {
    try {
      const r = await fetch(p, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        // Any puzzle file without a valid ISO date gets stamped with today's
        // UTC date. This is important for fallback.json which uses the literal
        // string "fallback" as its date field so it can be human-identified.
        if (!j.date || !dateRe.test(j.date)) {
          j.date = dateKey;
        }
        return j;
      }
    } catch {}
  }
  throw new Error("No puzzle available for " + dateKey);
}

async function init() {
  const dateKey = getUTCDateKey();
  renderMeta(dateKey);
  try {
    puzzle = await loadPuzzle(dateKey);
  } catch (e) {
    $("#target-slots").innerHTML = `<p class="hint">No puzzle today. Check back at 00:00 UTC.</p>`;
    return;
  }
  $("#puzzle-image").src = puzzle.image;
  $("#puzzle-image").alt = "Today's AI-generated image puzzle";

  // Restore state if already played today
  const saved = loadTodayState(puzzle.date);
  if (saved) {
    guesses = saved.guesses || [];
    revealed = new Set(saved.revealed || []);
    gameOver = !!saved.gameOver;
    won = !!saved.won;
  }

  render();

  $("#guess-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = $("#guess-input");
    const text = input.value;
    input.value = "";
    handleGuess(text);
  });

  $("#share-btn").addEventListener("click", async () => {
    const grid = buildEmojiGrid();
    try {
      await navigator.clipboard.writeText(grid);
      $("#share-btn").textContent = "COPIED";
      setTimeout(() => { $("#share-btn").textContent = "COPY RESULT"; }, 1500);
    } catch {
      // Fallback: show in a prompt
      window.prompt("Copy this:", grid);
    }
  });

  $("#reveal-btn").addEventListener("click", () => {
    $("#full-prompt").classList.remove("hidden");
    $("#full-prompt-text").textContent = puzzle.prompt;
    $("#reveal-btn").classList.add("hidden");
  });
}

init();
