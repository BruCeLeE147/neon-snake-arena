export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 })
});

export const OPPOSITE = Object.freeze({ up: "down", down: "up", left: "right", right: "left" });

export function sanitizeName(value, fallback = "Spieler") {
  const cleaned = String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
  return cleaned || fallback;
}

export function sanitizeSkin(value) {
  const allowed = new Set(["neon", "dragon", "basilisk", "sperm", "cyber", "galaxy"]);
  return allowed.has(value) ? value : "neon";
}

export function createPlayer(slot, name, skin, grid) {
  const isFirst = slot === 0;
  const y = Math.floor(grid.h / 2) + (isFirst ? -3 : 3);
  const x = isFirst ? 8 : grid.w - 9;
  const dir = isFirst ? "right" : "left";
  const body = [];
  for (let i = 0; i < 6; i += 1) {
    body.push({ x: x + (isFirst ? -i : i), y });
  }

  return {
    slot,
    name: sanitizeName(name, `Spieler ${slot + 1}`),
    skin: sanitizeSkin(skin),
    body,
    dir,
    pendingDir: dir,
    inputQueue: [],
    alive: true,
    score: 0,
    foods: 0
  };
}

export function pointKey(point) {
  return `${point.x},${point.y}`;
}

export function isInside(point, grid) {
  return point.x >= 0 && point.y >= 0 && point.x < grid.w && point.y < grid.h;
}

export function randomFreePoint(grid, players, foods, rng = Math.random) {
  const blocked = new Set();
  for (const player of players) {
    for (const part of player.body) blocked.add(pointKey(part));
  }
  for (const food of foods) blocked.add(pointKey(food));

  const maxAttempts = grid.w * grid.h * 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const point = {
      x: Math.floor(rng() * grid.w),
      y: Math.floor(rng() * grid.h)
    };
    if (!blocked.has(pointKey(point))) return point;
  }
  return null;
}

export function fillFood(grid, players, foods, desiredCount = 5, rng = Math.random) {
  const next = [...foods];
  while (next.length < desiredCount) {
    const point = randomFreePoint(grid, players, next, rng);
    if (!point) break;
    const roll = rng();
    next.push({
      ...point,
      kind: roll > 0.9 ? "star" : roll > 0.72 ? "orb" : "fruit",
      value: roll > 0.9 ? 50 : roll > 0.72 ? 25 : 10
    });
  }
  return next;
}

export function setDirection(player, direction) {
  if (!DIRECTIONS[direction]) return false;
  if (!Array.isArray(player.inputQueue)) player.inputQueue = [];

  const reference = player.inputQueue.at(-1) || player.pendingDir || player.dir;
  if (direction === reference || OPPOSITE[reference] === direction) return false;
  if (player.inputQueue.length >= 3) return false;

  player.inputQueue.push(direction);
  player.pendingDir = player.inputQueue[0];
  return true;
}

export function stepMultiplayer(players, foods, grid, rng = Math.random) {
  const active = players.filter(Boolean);
  const candidates = new Map();
  const eatenBySlot = new Map();

  for (const player of active) {
    if (!player.alive) continue;
    const nextDirection = player.inputQueue?.length
      ? player.inputQueue.shift()
      : player.pendingDir;
    if (nextDirection && OPPOSITE[player.dir] !== nextDirection) player.dir = nextDirection;
    player.pendingDir = player.inputQueue?.[0] || player.dir;
    const vector = DIRECTIONS[player.dir];
    const head = player.body[0];
    const nextHead = { x: head.x + vector.x, y: head.y + vector.y };
    candidates.set(player.slot, nextHead);
    const foodIndex = foods.findIndex((food) => food.x === nextHead.x && food.y === nextHead.y);
    if (foodIndex >= 0) eatenBySlot.set(player.slot, foodIndex);
  }

  const dead = new Set();
  for (const player of active) {
    if (!player.alive) continue;
    const nextHead = candidates.get(player.slot);
    if (!isInside(nextHead, grid)) dead.add(player.slot);
  }

  if (active.length >= 2) {
    const [a, b] = active;
    if (a.alive && b.alive) {
      const aNext = candidates.get(a.slot);
      const bNext = candidates.get(b.slot);
      if (aNext && bNext && aNext.x === bNext.x && aNext.y === bNext.y) {
        dead.add(a.slot);
        dead.add(b.slot);
      }
      const aHead = a.body[0];
      const bHead = b.body[0];
      if (
        aNext && bNext &&
        aNext.x === bHead.x && aNext.y === bHead.y &&
        bNext.x === aHead.x && bNext.y === aHead.y
      ) {
        dead.add(a.slot);
        dead.add(b.slot);
      }
    }
  }

  const occupancy = new Map();
  for (const owner of active) {
    const grows = eatenBySlot.has(owner.slot);
    const bodyToCheck = grows ? owner.body : owner.body.slice(0, -1);
    for (const part of bodyToCheck) {
      const key = pointKey(part);
      if (!occupancy.has(key)) occupancy.set(key, new Set());
      occupancy.get(key).add(owner.slot);
    }
  }

  for (const player of active) {
    if (!player.alive) continue;
    const nextHead = candidates.get(player.slot);
    if (nextHead && occupancy.has(pointKey(nextHead))) dead.add(player.slot);
  }

  const consumedIndexes = new Set();
  const events = [];

  for (const player of active) {
    if (!player.alive) continue;
    if (dead.has(player.slot)) {
      player.alive = false;
      events.push({ type: "death", slot: player.slot });
      continue;
    }

    const nextHead = candidates.get(player.slot);
    player.body.unshift(nextHead);
    const foodIndex = eatenBySlot.get(player.slot);
    if (foodIndex !== undefined && !consumedIndexes.has(foodIndex)) {
      const food = foods[foodIndex];
      player.score += food.value;
      player.foods += 1;
      consumedIndexes.add(foodIndex);
      events.push({ type: "eat", slot: player.slot, food });
    } else {
      player.body.pop();
    }
  }

  const remainingFood = foods.filter((_, index) => !consumedIndexes.has(index));
  return {
    players,
    foods: fillFood(grid, active, remainingFood, 6, rng),
    events,
    alive: active.filter((player) => player.alive)
  };
}
