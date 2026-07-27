const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
const SKIN_LABELS = {
  neon: "Neon",
  dragon: "Drache",
  basilisk: "Basilisk",
  sperm: "Spermium",
  cyber: "Mecha-Wurm",
  galaxy: "Galaxie"
};
const SPEEDS = { relaxed: 150, normal: 112, turbo: 78 };
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const DEFAULT_SETTINGS = {
  theme: "neon",
  accent: "#55f5c5",
  skin: "neon",
  speed: "normal",
  walls: "solid",
  showDpad: true,
  showGrid: true,
  reducedMotion: false,
  volume: 65,
  highscore: 0
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("neonSnakeSettings") || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem("neonSnakeSettings", JSON.stringify(settings));
}

let settings = loadSettings();
let previousVolume = settings.volume || 65;

const screens = {
  home: $("#homeScreen"),
  multiplayer: $("#multiplayerScreen"),
  customize: $("#customizeScreen"),
  settings: $("#settingsScreen"),
  game: $("#gameScreen")
};

const ui = {
  canvas: $("#gameCanvas"),
  stage: $("#gameStage"),
  centerMessage: $("#centerMessage"),
  centerTitle: $("#centerMessageTitle"),
  centerText: $("#centerMessageText"),
  orientationHint: $("#orientationHint"),
  modeChip: $("#modeChip"),
  pauseButton: $("#pauseButton"),
  dpad: $("#dpad"),
  playerOneName: $("#playerOneName"),
  playerOneScore: $("#playerOneScore"),
  playerTwoName: $("#playerTwoName"),
  playerTwoScore: $("#playerTwoScore"),
  playerTwoScoreBox: $("#playerTwoScoreBox"),
  versusMark: $("#versusMark"),
  roomDisplay: $("#roomDisplay"),
  activeRoomCode: $("#activeRoomCode"),
  connectionPill: $("#connectionPill"),
  toast: $("#toast"),
  soundQuickToggle: $("#soundQuickToggle")
};

const app = {
  mode: null,
  active: false,
  single: null,
  multi: null,
  accumulator: 0,
  lastFrame: performance.now(),
  intentionalClose: false
};

function showScreen(name) {
  for (const [key, screen] of Object.entries(screens)) {
    screen.classList.toggle("is-active", key === name);
  }
  if (name !== "game") window.scrollTo({ top: 0, behavior: "smooth" });
}

let toastTimer = null;
function toast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2300);
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex, amount = 40) {
  const { r, g, b } = hexToRgb(hex);
  const clamp = (value) => Math.max(0, Math.min(255, value));
  return `rgb(${clamp(r + amount)}, ${clamp(g + amount)}, ${clamp(b + amount)})`;
}

function applySettings() {
  document.body.dataset.theme = settings.theme;
  document.documentElement.style.setProperty("--accent", settings.accent);
  const rgb = hexToRgb(settings.accent);
  document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  ui.dpad.hidden = !settings.showDpad;
  ui.soundQuickToggle.textContent = settings.volume > 0 ? "🔊" : "🔇";
  $("#homeHighscore").textContent = settings.highscore.toLocaleString("de-DE");
  $("#homeSkin").textContent = SKIN_LABELS[settings.skin] || settings.skin;

  $("#themeSelect").value = settings.theme;
  $("#accentColor").value = settings.accent;
  $("#speedSelect").value = settings.speed;
  $("#wallSelect").value = settings.walls;
  $("#dpadToggle").checked = settings.showDpad;
  $("#gridToggle").checked = settings.showGrid;
  $("#motionToggle").checked = settings.reducedMotion;
  $("#volumeRange").value = settings.volume;
  $("#volumeOutput").textContent = `${settings.volume}%`;

  $$(".skin-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.skin === settings.skin);
  });
  drawSkinPreviews();
}

class SoundEngine {
  constructor() {
    this.context = null;
  }

  async unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  tone(frequency, duration, options = {}) {
    if (!this.context || settings.volume <= 0) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime((settings.volume / 100) * (options.gain || 0.12), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  play(name) {
    if (!this.context || settings.volume <= 0) return;
    if (name === "eat") {
      this.tone(510, 0.09, { type: "triangle", endFrequency: 780, gain: 0.13 });
      setTimeout(() => this.tone(920, 0.07, { type: "sine", gain: 0.08 }), 45);
    } else if (name === "star") {
      [520, 690, 880].forEach((frequency, index) => setTimeout(() => this.tone(frequency, 0.12, { type: "triangle", gain: 0.1 }), index * 58));
    } else if (name === "death") {
      this.tone(220, 0.48, { type: "sawtooth", endFrequency: 52, gain: 0.16 });
    } else if (name === "count") {
      this.tone(420, 0.1, { type: "square", gain: 0.08 });
    } else if (name === "go") {
      this.tone(660, 0.16, { type: "triangle", endFrequency: 990, gain: 0.12 });
    } else if (name === "win") {
      [440, 660, 880, 1100].forEach((frequency, index) => setTimeout(() => this.tone(frequency, 0.16, { type: "triangle", gain: 0.11 }), index * 85));
    } else if (name === "click") {
      this.tone(300, 0.04, { type: "sine", gain: 0.04 });
    }
  }
}

const sound = new SoundEngine();

document.addEventListener("pointerdown", () => sound.unlock(), { once: true });

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function snakePalette(skin, slot = 0) {
  const opponentBase = "#a78bfa";
  const base = slot === 1 ? opponentBase : settings.accent;
  const palettes = {
    neon: { base, secondary: lighten(base, 35), dark: "#0b1720", eye: "#ffffff" },
    dragon: { base: slot === 1 ? "#a78bfa" : "#ff8a4c", secondary: "#ffd166", dark: "#32131a", eye: "#fff3a8" },
    basilisk: { base: slot === 1 ? "#7d74ff" : "#63e66e", secondary: "#c5ff71", dark: "#09230e", eye: "#ffe55c" },
    sperm: { base: slot === 1 ? "#d5c8ff" : "#e9fbff", secondary: "#8ee7ff", dark: "#264d68", eye: "#0f3450" },
    cyber: { base, secondary: "#d7e1ff", dark: "#1a2035", eye: "#ff5f83" },
    galaxy: { base: slot === 1 ? "#a78bfa" : "#6fa8ff", secondary: "#ff8bf4", dark: "#15113d", eye: "#ffffff" }
  };
  return palettes[skin] || palettes.neon;
}

function drawEye(ctx, x, y, radius, direction, palette, second = false) {
  const vector = DIRECTIONS[direction] || DIRECTIONS.right;
  const perpendicular = { x: -vector.y, y: vector.x };
  const offset = second ? 0.18 : -0.18;
  const cx = x + vector.x * radius * 0.35 + perpendicular.x * radius * offset;
  const cy = y + vector.y * radius * 0.35 + perpendicular.y * radius * offset;
  ctx.fillStyle = palette.eye;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.dark;
  ctx.beginPath();
  ctx.arc(cx + vector.x * radius * 0.05, cy + vector.y * radius * 0.05, radius * 0.065, 0, Math.PI * 2);
  ctx.fill();
}

function drawSnake(ctx, player, metrics, time, preview = false) {
  if (!player?.body?.length) return;
  const { cell, ox, oy } = metrics;
  const palette = snakePalette(player.skin, player.slot);
  const alpha = player.alive === false ? 0.35 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (!settings.reducedMotion && !preview) {
    ctx.shadowBlur = Math.min(18, cell * 0.9);
    ctx.shadowColor = rgba(palette.base.startsWith("#") ? palette.base : settings.accent, 0.55);
  }

  if (player.skin === "sperm" && player.body.length > 1) {
    ctx.strokeStyle = palette.secondary;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, cell * 0.35);
    ctx.beginPath();
    [...player.body].reverse().forEach((part, index) => {
      const px = ox + (part.x + 0.5) * cell;
      const py = oy + (part.y + 0.5) * cell;
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  for (let index = player.body.length - 1; index >= 0; index -= 1) {
    const part = player.body[index];
    const x = ox + (part.x + 0.5) * cell;
    const y = oy + (part.y + 0.5) * cell;
    const isHead = index === 0;
    const taper = Math.max(0.52, 1 - index * 0.018);
    const radius = cell * (isHead ? 0.46 : 0.39) * taper;

    if (player.skin === "neon") {
      ctx.fillStyle = isHead ? palette.secondary : palette.base;
      roundRectPath(ctx, x - radius, y - radius, radius * 2, radius * 2, radius * 0.48);
      ctx.fill();
      ctx.strokeStyle = rgba("#ffffff", isHead ? 0.48 : 0.2);
      ctx.lineWidth = Math.max(1, cell * 0.06);
      ctx.stroke();
    } else if (player.skin === "dragon") {
      ctx.fillStyle = isHead ? palette.secondary : palette.base;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.dark;
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.55, y - radius * 0.5);
      ctx.lineTo(x, y - radius * 1.02);
      ctx.lineTo(x + radius * 0.48, y - radius * 0.5);
      ctx.closePath();
      ctx.fill();
      if (isHead) {
        ctx.fillStyle = palette.secondary;
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.7, y - radius * 0.4);
        ctx.lineTo(x - radius * 0.35, y - radius * 1.1);
        ctx.lineTo(x - radius * 0.06, y - radius * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + radius * 0.7, y - radius * 0.4);
        ctx.lineTo(x + radius * 0.35, y - radius * 1.1);
        ctx.lineTo(x + radius * 0.06, y - radius * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    } else if (player.skin === "basilisk") {
      ctx.fillStyle = isHead ? palette.secondary : palette.base;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(palette.dark, 0.62);
      ctx.lineWidth = Math.max(1, cell * 0.08);
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.55, y);
      ctx.lineTo(x, y - radius * 0.5);
      ctx.lineTo(x + radius * 0.55, y);
      ctx.lineTo(x, y + radius * 0.5);
      ctx.closePath();
      ctx.stroke();
    } else if (player.skin === "sperm") {
      if (!isHead && index > 1) continue;
      ctx.fillStyle = isHead ? palette.base : palette.secondary;
      ctx.beginPath();
      ctx.ellipse(x, y, isHead ? radius * 1.15 : radius * 0.5, isHead ? radius : radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (isHead) {
        ctx.fillStyle = rgba(palette.secondary.startsWith("#") ? palette.secondary : "#8ee7ff", 0.55);
        ctx.beginPath();
        ctx.ellipse(x - radius * 0.2, y - radius * 0.2, radius * 0.46, radius * 0.34, -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (player.skin === "cyber") {
      ctx.fillStyle = isHead ? palette.secondary : palette.base;
      const inset = isHead ? 0.06 : 0.12;
      roundRectPath(ctx, x - cell * (0.5 - inset), y - cell * (0.5 - inset), cell * (1 - inset * 2), cell * (1 - inset * 2), cell * 0.16);
      ctx.fill();
      ctx.strokeStyle = palette.dark;
      ctx.lineWidth = Math.max(1, cell * 0.09);
      ctx.stroke();
      if (!isHead) {
        ctx.fillStyle = rgba("#ffffff", 0.26);
        ctx.fillRect(x - cell * 0.05, y - cell * 0.3, cell * 0.1, cell * 0.6);
      }
    } else {
      const gradient = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.3, radius * 0.05, x, y, radius);
      gradient.addColorStop(0, palette.secondary);
      gradient.addColorStop(1, palette.dark);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba("#ffffff", 0.72);
      const spark = ((index * 17) % 7) / 7;
      ctx.beginPath();
      ctx.arc(x + (spark - 0.5) * radius, y - (spark - 0.35) * radius, Math.max(0.8, cell * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }

    if (isHead) {
      drawEye(ctx, x, y, radius, player.dir, palette, false);
      drawEye(ctx, x, y, radius, player.dir, palette, true);
    }
  }
  ctx.restore();
}

function drawFood(ctx, food, metrics, time) {
  const { cell, ox, oy } = metrics;
  const x = ox + (food.x + 0.5) * cell;
  const y = oy + (food.y + 0.5) * cell;
  const pulse = settings.reducedMotion ? 1 : 1 + Math.sin(time * 0.006 + food.x) * 0.09;
  const radius = cell * 0.31 * pulse;
  ctx.save();
  ctx.shadowBlur = settings.reducedMotion ? 0 : cell * 1.15;
  ctx.shadowColor = food.kind === "star" ? "#ffd166" : food.kind === "orb" ? "#8d72ff" : "#ff5f83";

  if (food.kind === "star") {
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const length = point % 2 === 0 ? radius : radius * 0.45;
      const px = x + Math.cos(angle) * length;
      const py = y + Math.sin(angle) * length;
      if (point === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else if (food.kind === "orb") {
    const gradient = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.3, 0, x, y, radius);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.25, "#c7b8ff");
    gradient.addColorStop(1, "#6a4cff");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#ff5f83";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9dff8f";
    ctx.fillRect(x - cell * 0.03, y - radius - cell * 0.12, cell * 0.07, cell * 0.14);
  }
  ctx.restore();
}

class GameRenderer {
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.metrics = { cell: 10, ox: 0, oy: 0 };
    this.particles = [];
    this.shake = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    this.resize();
  }

  resize() {
    const rect = this.stage.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setGrid(grid) {
    const padding = Math.max(8, Math.min(this.width, this.height) * 0.025);
    const cell = Math.min((this.width - padding * 2) / grid.w, (this.height - padding * 2) / grid.h);
    const boardWidth = cell * grid.w;
    const boardHeight = cell * grid.h;
    this.metrics = {
      cell,
      ox: (this.width - boardWidth) / 2,
      oy: (this.height - boardHeight) / 2,
      boardWidth,
      boardHeight
    };
  }

  burst(point, color = settings.accent, amount = 16) {
    if (!point) return;
    const count = settings.reducedMotion ? Math.min(5, amount) : amount;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.5;
      this.particles.push({
        x: point.x + 0.5,
        y: point.y + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: 0.07 + Math.random() * 0.13,
        color
      });
    }
    if (!settings.reducedMotion) this.shake = Math.min(7, this.shake + 2.2);
  }

  update(dt) {
    const seconds = dt / 1000;
    for (const particle of this.particles) {
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.vx *= 0.97;
      particle.vy *= 0.97;
      particle.life -= seconds * 1.7;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    this.shake *= 0.88;
  }

  draw(state, time) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!state?.grid) return;
    this.setGrid(state.grid);
    const { ox, oy, boardWidth, boardHeight, cell } = this.metrics;
    const shakeX = settings.reducedMotion ? 0 : (Math.random() - 0.5) * this.shake;
    const shakeY = settings.reducedMotion ? 0 : (Math.random() - 0.5) * this.shake;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    const boardGradient = ctx.createLinearGradient(ox, oy, ox + boardWidth, oy + boardHeight);
    boardGradient.addColorStop(0, "rgba(8, 13, 31, 0.98)");
    boardGradient.addColorStop(1, "rgba(4, 7, 19, 0.98)");
    ctx.fillStyle = boardGradient;
    roundRectPath(ctx, ox, oy, boardWidth, boardHeight, Math.min(18, cell * 1.2));
    ctx.fill();
    ctx.strokeStyle = rgba(settings.accent, 0.24);
    ctx.lineWidth = Math.max(1, cell * 0.08);
    ctx.stroke();

    if (settings.showGrid && cell >= 6) {
      ctx.strokeStyle = rgba(settings.accent, 0.055);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < state.grid.w; x += 1) {
        ctx.moveTo(ox + x * cell, oy);
        ctx.lineTo(ox + x * cell, oy + boardHeight);
      }
      for (let y = 1; y < state.grid.h; y += 1) {
        ctx.moveTo(ox, oy + y * cell);
        ctx.lineTo(ox + boardWidth, oy + y * cell);
      }
      ctx.stroke();
    }

    for (const food of state.food || []) drawFood(ctx, food, this.metrics, time);
    for (const player of state.players || []) drawSnake(ctx, player, this.metrics, time);

    for (const particle of this.particles) {
      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(
        ox + particle.x * cell,
        oy + particle.y * cell,
        Math.max(1, particle.size * cell * particle.life),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

const renderer = new GameRenderer(ui.canvas, ui.stage);

function drawSkinPreviews() {
  $$(".skin-card").forEach((card) => {
    const canvas = $("canvas", card);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#070a18");
    gradient.addColorStop(1, "#10152d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const body = [
      { x: 7, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 },
      { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }
    ];
    drawSnake(ctx, { body, dir: "right", skin: card.dataset.skin, slot: 0, alive: true }, { cell: 18, ox: 10, oy: 10 }, 0, true);
  });
}

function randomRoomCode(length = 6) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join("");
}

function randomFreeCell(grid, snake, food) {
  const blocked = new Set(snake.map((part) => `${part.x},${part.y}`));
  food.forEach((item) => blocked.add(`${item.x},${item.y}`));
  for (let attempt = 0; attempt < grid.w * grid.h * 2; attempt += 1) {
    const point = { x: Math.floor(Math.random() * grid.w), y: Math.floor(Math.random() * grid.h) };
    if (!blocked.has(`${point.x},${point.y}`)) return point;
  }
  return null;
}

function fillSingleFood(game, desired = 4) {
  while (game.food.length < desired) {
    const point = randomFreeCell(game.grid, game.snake, game.food);
    if (!point) break;
    const roll = Math.random();
    game.food.push({
      ...point,
      kind: roll > 0.92 ? "star" : roll > 0.74 ? "orb" : "fruit",
      value: roll > 0.92 ? 50 : roll > 0.74 ? 25 : 10
    });
  }
}

function createSingleGame() {
  const landscape = matchMedia("(orientation: landscape)").matches;
  const grid = landscape ? { w: 42, h: 24 } : { w: 28, h: 36 };
  const x = Math.floor(grid.w / 2);
  const y = Math.floor(grid.h / 2);
  const snake = Array.from({ length: 6 }, (_, index) => ({ x: x - index, y }));
  const game = {
    grid,
    snake,
    dir: "right",
    pendingDir: "right",
    food: [],
    score: 0,
    foods: 0,
    phase: "countdown",
    countdownEnds: performance.now() + 3100,
    lastCountdown: 4,
    paused: false,
    alive: true
  };
  fillSingleFood(game);
  return game;
}

function startSingle() {
  sound.unlock();
  app.mode = "single";
  app.active = true;
  app.single = createSingleGame();
  app.accumulator = 0;
  app.intentionalClose = false;
  configureGameHud();
  showScreen("game");
  renderer.resize();
  setCenterMessage("3", "Mach dich bereit", true);
  updateHud();
}

function setCenterMessage(title, text = "", visible = true) {
  ui.centerTitle.textContent = title;
  ui.centerText.textContent = text;
  ui.centerMessage.hidden = !visible;
}

function hideCenterMessage() {
  ui.centerMessage.hidden = true;
}

function configureGameHud() {
  const multiplayer = app.mode === "multi";
  ui.modeChip.textContent = multiplayer ? "ONLINE-DUELL" : "SOLO";
  ui.pauseButton.hidden = multiplayer;
  ui.versusMark.hidden = !multiplayer;
  ui.playerTwoScoreBox.hidden = !multiplayer;
  ui.roomDisplay.hidden = !multiplayer;
  ui.orientationHint.hidden = !(multiplayer && matchMedia("(orientation: portrait)").matches);
  ui.playerOneName.textContent = multiplayer ? "Du" : "Punkte";
  ui.playerTwoName.textContent = "Gegner";
  ui.dpad.hidden = !settings.showDpad;
}

function moveSingle() {
  const game = app.single;
  if (!game || game.phase !== "playing" || game.paused || !game.alive) return;
  if (OPPOSITE[game.dir] !== game.pendingDir) game.dir = game.pendingDir;
  const vector = DIRECTIONS[game.dir];
  const head = game.snake[0];
  const next = { x: head.x + vector.x, y: head.y + vector.y };

  if (settings.walls === "wrap") {
    next.x = (next.x + game.grid.w) % game.grid.w;
    next.y = (next.y + game.grid.h) % game.grid.h;
  }

  const outside = next.x < 0 || next.y < 0 || next.x >= game.grid.w || next.y >= game.grid.h;
  const foodIndex = game.food.findIndex((item) => item.x === next.x && item.y === next.y);
  const grows = foodIndex >= 0;
  const bodyToCheck = grows ? game.snake : game.snake.slice(0, -1);
  const selfHit = bodyToCheck.some((part) => part.x === next.x && part.y === next.y);

  if (outside || selfHit) {
    endSingleGame();
    return;
  }

  game.snake.unshift(next);
  if (grows) {
    const [food] = game.food.splice(foodIndex, 1);
    game.score += food.value;
    game.foods += 1;
    renderer.burst(food, food.kind === "star" ? "#ffd166" : food.kind === "orb" ? "#8d72ff" : "#ff5f83", food.kind === "star" ? 28 : 16);
    sound.play(food.kind === "star" ? "star" : "eat");
    fillSingleFood(game);
  } else {
    game.snake.pop();
  }
  updateHud();
}

function endSingleGame() {
  const game = app.single;
  if (!game) return;
  game.alive = false;
  game.phase = "over";
  renderer.shake = settings.reducedMotion ? 0 : 10;
  renderer.burst(game.snake[0], "#ff5f83", 34);
  sound.play("death");
  if (game.score > settings.highscore) {
    settings.highscore = game.score;
    saveSettings();
    applySettings();
    setCenterMessage("Neuer Rekord!", `${game.score.toLocaleString("de-DE")} Punkte · Tippe zum Neustart`, true);
  } else {
    setCenterMessage("Runde beendet", `${game.score.toLocaleString("de-DE")} Punkte · Tippe zum Neustart`, true);
  }
}

function singleRenderState() {
  const game = app.single;
  if (!game) return null;
  return {
    grid: game.grid,
    food: game.food,
    players: [{
      slot: 0,
      name: "Du",
      skin: settings.skin,
      body: game.snake,
      dir: game.dir,
      alive: game.alive,
      score: game.score
    }]
  };
}

function multiplayerRenderState() {
  return app.multi?.state || { grid: { w: 48, h: 28 }, food: [], players: [] };
}

function updateHud() {
  if (app.mode === "single" && app.single) {
    ui.playerOneScore.textContent = app.single.score.toLocaleString("de-DE");
    return;
  }
  const state = app.multi?.state;
  if (!state || app.multi?.slot === null) return;
  const own = state.players.find((player) => player.slot === app.multi.slot);
  const opponent = state.players.find((player) => player.slot !== app.multi.slot);
  ui.playerOneName.textContent = own?.name || "Du";
  ui.playerOneScore.textContent = (own?.score || 0).toLocaleString("de-DE");
  ui.playerTwoName.textContent = opponent?.name || "Warte …";
  ui.playerTwoScore.textContent = (opponent?.score || 0).toLocaleString("de-DE");
}

function setDirection(direction) {
  if (!DIRECTIONS[direction]) return;
  sound.play("click");
  if (app.mode === "single" && app.single) {
    if (OPPOSITE[app.single.dir] !== direction) app.single.pendingDir = direction;
  } else if (app.mode === "multi" && app.multi?.ws?.readyState === WebSocket.OPEN) {
    app.multi.ws.send(JSON.stringify({ type: "input", direction }));
  }
}

function handleSingleCountdown(now) {
  const game = app.single;
  if (!game || game.phase !== "countdown") return;
  const remaining = Math.max(0, Math.ceil((game.countdownEnds - now) / 1000));
  if (remaining !== game.lastCountdown) {
    game.lastCountdown = remaining;
    if (remaining > 0) {
      setCenterMessage(String(remaining), "Mach dich bereit", true);
      sound.play("count");
    }
  }
  if (now >= game.countdownEnds) {
    game.phase = "playing";
    hideCenterMessage();
    sound.play("go");
  }
}

function frame(now) {
  const dt = Math.min(50, now - app.lastFrame);
  app.lastFrame = now;
  renderer.update(dt);

  if (app.active && app.mode === "single" && app.single) {
    handleSingleCountdown(now);
    if (app.single.phase === "playing" && !app.single.paused) {
      app.accumulator += dt;
      const acceleration = Math.min(28, Math.floor(app.single.score / 100) * 3);
      const interval = Math.max(55, SPEEDS[settings.speed] - acceleration);
      while (app.accumulator >= interval) {
        moveSingle();
        app.accumulator -= interval;
      }
    }
    renderer.draw(singleRenderState(), now);
  } else if (app.active && app.mode === "multi") {
    renderer.draw(multiplayerRenderState(), now);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function websocketUrl(room, name) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${location.host}/api/room/${encodeURIComponent(room)}/ws`);
  url.searchParams.set("name", name);
  url.searchParams.set("skin", settings.skin);
  return url.toString();
}

function connectRoom(room, name) {
  const normalizedRoom = room.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (normalizedRoom.length < 4) {
    toast("Der Raumcode muss mindestens 4 Zeichen haben.");
    return;
  }

  sound.unlock();
  if (app.multi?.ws) {
    app.intentionalClose = true;
    app.multi.ws.close();
  }

  app.mode = "multi";
  app.active = true;
  app.intentionalClose = false;
  app.multi = { ws: null, state: null, slot: null, room: normalizedRoom, connected: false };
  configureGameHud();
  ui.activeRoomCode.textContent = normalizedRoom;
  ui.connectionPill.hidden = false;
  ui.connectionPill.classList.remove("online");
  ui.connectionPill.textContent = "Verbinden …";
  setCenterMessage("Verbinden …", `Raum ${normalizedRoom}`, true);
  showScreen("game");
  renderer.resize();

  const ws = new WebSocket(websocketUrl(normalizedRoom, name.trim() || "Spieler"));
  app.multi.ws = ws;

  ws.addEventListener("open", () => {
    if (app.multi?.ws !== ws) return;
    app.multi.connected = true;
    ui.connectionPill.classList.add("online");
    ui.connectionPill.textContent = "Online";
  });

  ws.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handleMultiplayerMessage(message);
  });

  ws.addEventListener("close", () => {
    if (app.multi?.ws !== ws) return;
    app.multi.connected = false;
    ui.connectionPill.classList.remove("online");
    ui.connectionPill.textContent = "Offline";
    if (!app.intentionalClose && app.active && app.mode === "multi") {
      setCenterMessage("Verbindung getrennt", "Verlasse die Arena und versuche es erneut.", true);
      sound.play("death");
    }
  });

  ws.addEventListener("error", () => {
    if (app.multi?.ws !== ws) return;
    toast("Die Verbindung zum Raum konnte nicht aufgebaut werden.");
  });
}

function handleMultiplayerMessage(message) {
  if (!app.multi) return;

  if (message.type === "welcome") {
    app.multi.slot = message.slot;
    ui.activeRoomCode.textContent = message.room;
    setCenterMessage(message.slot === 0 ? "Raum bereit" : "Gegner gefunden", message.message, true);
    return;
  }

  if (message.type === "state") {
    app.multi.state = message;
    updateHud();
    updateMultiplayerCenter(message);
    return;
  }

  if (message.type === "presence" && message.connected < 2) {
    setCenterMessage("Warte auf Spieler 2", `Raumcode ${app.multi.room}`, true);
    return;
  }

  if (message.type === "eat") {
    const color = message.food?.kind === "star" ? "#ffd166" : message.slot === app.multi.slot ? settings.accent : "#a78bfa";
    renderer.burst(message.food, color, message.food?.kind === "star" ? 26 : 15);
    sound.play(message.food?.kind === "star" ? "star" : "eat");
    return;
  }

  if (message.type === "death") {
    sound.play(message.slot === app.multi.slot ? "death" : "click");
    return;
  }

  if (message.type === "go") {
    hideCenterMessage();
    sound.play("go");
    return;
  }

  if (message.type === "round-over") {
    if (message.winner === app.multi.slot) sound.play("win"); else sound.play("death");
    return;
  }

  if (message.type === "opponent-left") {
    setCenterMessage("Gegner getrennt", "Warte auf einen neuen zweiten Spieler.", true);
  }
}

function updateMultiplayerCenter(state) {
  if (state.status === "waiting") {
    setCenterMessage("Warte auf Spieler 2", `Raumcode ${app.multi.room}`, true);
  } else if (state.status === "countdown") {
    setCenterMessage(String(state.countdown || 1), `Runde ${state.round}`, true);
    if (state.countdown > 0 && state.countdown !== app.multi.lastCountdown) {
      app.multi.lastCountdown = state.countdown;
      sound.play("count");
    }
  } else if (state.status === "playing") {
    hideCenterMessage();
  } else if (state.status === "over") {
    if (state.winner === -1) {
      setCenterMessage("Unentschieden", "Nächste Runde startet automatisch", true);
    } else if (state.winner === app.multi.slot) {
      setCenterMessage("Du gewinnst!", "Nächste Runde startet automatisch", true);
    } else {
      setCenterMessage("Gegner gewinnt", "Nächste Runde startet automatisch", true);
    }
  }
}

function leaveGame() {
  app.active = false;
  if (app.multi?.ws) {
    app.intentionalClose = true;
    app.multi.ws.close(1000, "Spiel verlassen");
  }
  app.multi = null;
  app.single = null;
  app.mode = null;
  ui.connectionPill.hidden = true;
  hideCenterMessage();
  showScreen("home");
}

function togglePause() {
  if (app.mode !== "single" || !app.single || app.single.phase === "over") return;
  app.single.paused = !app.single.paused;
  ui.pauseButton.textContent = app.single.paused ? "▶" : "Ⅱ";
  if (app.single.paused) setCenterMessage("Pause", "Tippe erneut auf Pause", true);
  else hideCenterMessage();
}

function updateOrientationHint() {
  ui.orientationHint.hidden = !(app.active && app.mode === "multi" && matchMedia("(orientation: portrait)").matches);
  setTimeout(() => renderer.resize(), 100);
}

$("#singleButton").addEventListener("click", startSingle);
$("#multiplayerButton").addEventListener("click", () => showScreen("multiplayer"));
$("#customizeButton").addEventListener("click", () => showScreen("customize"));
$("#settingsButton").addEventListener("click", () => showScreen("settings"));
$("#brandHome").addEventListener("click", () => { if (!app.active) showScreen("home"); });
$$('[data-back="home"]').forEach((button) => button.addEventListener("click", () => showScreen("home")));

$("#createRoomButton").addEventListener("click", () => {
  connectRoom(randomRoomCode(), $("#hostName").value);
});
$("#joinRoomButton").addEventListener("click", () => {
  connectRoom($("#roomCodeInput").value, $("#joinName").value);
});
$("#roomCodeInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
$("#roomCodeInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") connectRoom(event.target.value, $("#joinName").value);
});

$$(".skin-card").forEach((card) => {
  card.addEventListener("click", () => {
    settings.skin = card.dataset.skin;
    $$(".skin-card").forEach((item) => item.classList.toggle("is-selected", item === card));
    sound.play("click");
  });
});

$("#saveCustomizeButton").addEventListener("click", () => {
  settings.theme = $("#themeSelect").value;
  settings.accent = $("#accentColor").value;
  saveSettings();
  applySettings();
  toast("Design gespeichert.");
  showScreen("home");
});

$("#accentColor").addEventListener("input", (event) => {
  const color = event.target.value;
  document.documentElement.style.setProperty("--accent", color);
  const rgb = hexToRgb(color);
  document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  drawSkinPreviews();
});
$("#themeSelect").addEventListener("change", (event) => { document.body.dataset.theme = event.target.value; });

$("#volumeRange").addEventListener("input", (event) => {
  $("#volumeOutput").textContent = `${event.target.value}%`;
});
$("#saveSettingsButton").addEventListener("click", () => {
  settings.speed = $("#speedSelect").value;
  settings.walls = $("#wallSelect").value;
  settings.showDpad = $("#dpadToggle").checked;
  settings.showGrid = $("#gridToggle").checked;
  settings.reducedMotion = $("#motionToggle").checked;
  settings.volume = Number($("#volumeRange").value);
  if (settings.volume > 0) previousVolume = settings.volume;
  saveSettings();
  applySettings();
  sound.play("go");
  toast("Einstellungen gespeichert.");
  showScreen("home");
});

ui.soundQuickToggle.addEventListener("click", () => {
  if (settings.volume > 0) {
    previousVolume = settings.volume;
    settings.volume = 0;
  } else {
    settings.volume = previousVolume || 65;
  }
  saveSettings();
  applySettings();
});

$("#exitGameButton").addEventListener("click", leaveGame);
ui.pauseButton.addEventListener("click", togglePause);
ui.centerMessage.addEventListener("click", () => {
  if (app.mode === "single" && app.single?.phase === "over") startSingle();
  else if (app.mode === "single" && app.single?.paused) togglePause();
});

$$('#dpad button').forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    setDirection(button.dataset.dir);
  });
});

document.addEventListener("keydown", (event) => {
  const keyMap = {
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right"
  };
  if (keyMap[event.key] && app.active) {
    event.preventDefault();
    setDirection(keyMap[event.key]);
  } else if ((event.key === " " || event.key === "Escape") && app.mode === "single") {
    event.preventDefault();
    togglePause();
  }
});

let pointerStart = null;
ui.stage.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY, at: performance.now() };
  ui.stage.setPointerCapture?.(event.pointerId);
});
ui.stage.addEventListener("pointerup", (event) => {
  if (!pointerStart) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 18) {
    setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  }
  pointerStart = null;
});
ui.stage.addEventListener("pointercancel", () => { pointerStart = null; });
ui.stage.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("visibilitychange", () => {
  if (document.hidden && app.mode === "single" && app.single?.phase === "playing" && !app.single.paused) togglePause();
});
window.addEventListener("resize", updateOrientationHint);
window.addEventListener("orientationchange", updateOrientationHint);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

applySettings();
