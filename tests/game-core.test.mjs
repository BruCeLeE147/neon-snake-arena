import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlayer,
  fillFood,
  setDirection,
  stepMultiplayer
} from "../src/game-core.js";

const grid = { w: 20, h: 12 };

function constantRng(value = 0.5) {
  return () => value;
}

test("a player cannot reverse directly", () => {
  const player = createPlayer(0, "A", "dragon", grid);
  assert.equal(player.dir, "right");
  assert.equal(setDirection(player, "left"), false);
  assert.equal(player.pendingDir, "right");
  assert.equal(setDirection(player, "up"), true);
  assert.equal(player.pendingDir, "up");
});

test("food never starts on a snake", () => {
  const players = [createPlayer(0, "A", "neon", grid), createPlayer(1, "B", "basilisk", grid)];
  const food = fillFood(grid, players, [], 3, () => Math.random());
  const occupied = new Set(players.flatMap((p) => p.body.map((part) => `${part.x},${part.y}`)));
  assert.equal(food.length, 3);
  for (const item of food) assert.equal(occupied.has(`${item.x},${item.y}`), false);
});

test("head-on collision eliminates both players", () => {
  const a = createPlayer(0, "A", "neon", grid);
  const b = createPlayer(1, "B", "neon", grid);
  a.body = [{ x: 8, y: 5 }, { x: 7, y: 5 }];
  b.body = [{ x: 10, y: 5 }, { x: 11, y: 5 }];
  a.dir = a.pendingDir = "right";
  b.dir = b.pendingDir = "left";
  const result = stepMultiplayer([a, b], [], grid, constantRng(0.2));
  assert.equal(result.alive.length, 0);
});

test("eating grows the snake and increases score", () => {
  const a = createPlayer(0, "A", "neon", grid);
  a.body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
  a.dir = a.pendingDir = "right";
  const result = stepMultiplayer([a], [{ x: 6, y: 5, value: 25, kind: "orb" }], grid, () => Math.random());
  assert.equal(a.body.length, 4);
  assert.equal(a.score, 25);
  assert.equal(result.events[0].type, "eat");
});


test("rapid turns are buffered in order", () => {
  const player = createPlayer(0, "A", "neon", grid);
  assert.equal(setDirection(player, "up"), true);
  assert.equal(setDirection(player, "left"), true);
  assert.deepEqual(player.inputQueue, ["up", "left"]);

  stepMultiplayer([player], [], grid, constantRng(0.2));
  assert.equal(player.dir, "up");
  assert.equal(player.pendingDir, "left");

  stepMultiplayer([player], [], grid, constantRng(0.2));
  assert.equal(player.dir, "left");
});
