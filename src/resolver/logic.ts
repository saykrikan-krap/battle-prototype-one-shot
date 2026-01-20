import {
  BattleEvent,
  BattleInput,
  BattleResult,
  ResolveOutput,
  Side,
  UnitInput,
  UnitType
} from "../schema/types";
import {
  DEPLOYMENT_COLUMNS,
  MIN_RANGED_DISTANCE,
  PROJECTILE_SPEED,
  STALL_TICKS,
  UNIT_COSTS,
  UNIT_RANGES,
  UNIT_SIZES
} from "../schema/constants";
import type { Position, ProjectileKind } from "../schema/types";

interface UnitState extends UnitInput {
  alive: boolean;
  nextAvailableTick: number;
}

interface ProjectileState {
  id: number;
  kind: ProjectileKind;
  sourceId: number;
  sourceSide: Side;
  from: Position;
  target: Position;
  fireTick: number;
  impactTick: number;
}

interface Rng {
  next: () => number;
  nextInt: (max: number) => number;
}

const MAX_LOOP_GUARD = 5000;

const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const nextInt = (max: number) => Math.floor(next() * max);
  return { next, nextInt };
};

const tileKey = (pos: Position) => `${pos.x},${pos.y}`;

const manhattan = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const isWithin = (pos: Position, input: BattleInput) =>
  pos.x >= 0 && pos.x < input.grid.width && pos.y >= 0 && pos.y < input.grid.height;

const validateInput = (input: BattleInput) => {
  const tileCounts = new Map<string, { side: Side; count: number; size: number }>();
  const ids = new Set<number>();
  for (const unit of input.units) {
    if (ids.has(unit.id)) {
      throw new Error(`Duplicate unit id ${unit.id}.`);
    }
    ids.add(unit.id);
    if (UNIT_SIZES[unit.type] !== unit.size) {
      throw new Error(`Unit ${unit.id} has size ${unit.size} but expected ${UNIT_SIZES[unit.type]}.`);
    }
    if (!isWithin(unit.position, input)) {
      throw new Error(`Unit ${unit.id} placed outside the grid.`);
    }
    const zone = DEPLOYMENT_COLUMNS[unit.side];
    if (unit.position.x < zone.start || unit.position.x > zone.end) {
      throw new Error(`Unit ${unit.id} placed outside ${unit.side} deployment zone.`);
    }
    const key = tileKey(unit.position);
    const current = tileCounts.get(key);
    if (!current) {
      tileCounts.set(key, { side: unit.side, count: 1, size: unit.size });
      continue;
    }
    if (current.side !== unit.side) {
      throw new Error(`Tile ${key} mixes sides.`);
    }
    current.count += 1;
    current.size += unit.size;
    if (current.count > input.limits.maxUnitsPerTile) {
      throw new Error(`Tile ${key} exceeds max units.`);
    }
    if (current.size > input.limits.maxSizePerTile) {
      throw new Error(`Tile ${key} exceeds max size.`);
    }
  }
};

const getEnemyUnits = (units: Map<number, UnitState>, side: Side) =>
  Array.from(units.values()).filter((unit) => unit.alive && unit.side !== side);

const getFriendlyUnits = (units: Map<number, UnitState>, side: Side) =>
  Array.from(units.values()).filter((unit) => unit.alive && unit.side === side);

const findAdjacentEnemy = (unit: UnitState, units: Map<number, UnitState>) => {
  const enemies = getEnemyUnits(units, unit.side)
    .filter((enemy) => manhattan(unit.position, enemy.position) === 1)
    .sort((a, b) => a.id - b.id);
  return enemies[0] ?? null;
};

const getEnemyTilesInRange = (unit: UnitState, units: Map<number, UnitState>, range: number) => {
  const enemyTiles = new Map<string, { position: Position; count: number }>();
  for (const enemy of getEnemyUnits(units, unit.side)) {
    const distance = manhattan(unit.position, enemy.position);
    if (distance < MIN_RANGED_DISTANCE || distance > range) {
      continue;
    }
    const key = tileKey(enemy.position);
    const entry = enemyTiles.get(key) ?? { position: enemy.position, count: 0 };
    entry.count += 1;
    enemyTiles.set(key, entry);
  }
  return Array.from(enemyTiles.values());
};

const getTileUnits = (tileIndex: Map<string, number[]>, units: Map<number, UnitState>, pos: Position) => {
  const ids = tileIndex.get(tileKey(pos)) ?? [];
  return ids.map((id) => units.get(id)).filter((unit): unit is UnitState => Boolean(unit));
};

const canEnterTile = (
  unit: UnitState,
  tileIndex: Map<string, number[]>,
  units: Map<number, UnitState>,
  pos: Position,
  input: BattleInput
) => {
  if (!isWithin(pos, input)) {
    return false;
  }
  const existing = getTileUnits(tileIndex, units, pos).filter((u) => u.alive);
  if (existing.length === 0) {
    return true;
  }
  if (existing.some((u) => u.side !== unit.side)) {
    return false;
  }
  const totalSize = existing.reduce((sum, u) => sum + u.size, 0) + unit.size;
  return (
    existing.length + 1 <= input.limits.maxUnitsPerTile &&
    totalSize <= input.limits.maxSizePerTile
  );
};

const findMoveStep = (
  unit: UnitState,
  tileIndex: Map<string, number[]>,
  units: Map<number, UnitState>,
  input: BattleInput
) => {
  const enemyUnits = getEnemyUnits(units, unit.side);
  if (enemyUnits.length === 0) {
    return null;
  }
  const targetKeys = new Set<string>();
  for (const enemy of enemyUnits) {
    const neighbors = [
      { x: enemy.position.x + 1, y: enemy.position.y },
      { x: enemy.position.x - 1, y: enemy.position.y },
      { x: enemy.position.x, y: enemy.position.y + 1 },
      { x: enemy.position.x, y: enemy.position.y - 1 }
    ];
    for (const neighbor of neighbors) {
      if (canEnterTile(unit, tileIndex, units, neighbor, input)) {
        targetKeys.add(tileKey(neighbor));
      }
    }
  }
  if (targetKeys.size === 0) {
    return null;
  }

  const startKey = tileKey(unit.position);
  const queue: Array<{ pos: Position; firstStep: Position | null }> = [
    { pos: unit.position, firstStep: null }
  ];
  const visited = new Set<string>([startKey]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const key = tileKey(current.pos);
    if (key !== startKey && targetKeys.has(key)) {
      return current.firstStep ?? null;
    }
    const neighbors = [
      { x: current.pos.x + 1, y: current.pos.y },
      { x: current.pos.x - 1, y: current.pos.y },
      { x: current.pos.x, y: current.pos.y + 1 },
      { x: current.pos.x, y: current.pos.y - 1 }
    ];
    for (const neighbor of neighbors) {
      const neighborKey = tileKey(neighbor);
      if (visited.has(neighborKey)) {
        continue;
      }
      if (!canEnterTile(unit, tileIndex, units, neighbor, input)) {
        continue;
      }
      visited.add(neighborKey);
      queue.push({
        pos: neighbor,
        firstStep: current.firstStep ?? neighbor
      });
    }
  }

  return null;
};

const sortTilesDeterministic = (a: { position: Position }, b: { position: Position }) => {
  if (a.position.y !== b.position.y) {
    return a.position.y - b.position.y;
  }
  return a.position.x - b.position.x;
};

const applyRemoval = (
  unit: UnitState,
  tileIndex: Map<string, number[]>,
  units: Map<number, UnitState>
) => {
  unit.alive = false;
  const key = tileKey(unit.position);
  const list = tileIndex.get(key);
  if (!list) {
    return;
  }
  tileIndex.set(
    key,
    list.filter((id) => id !== unit.id)
  );
};

const checkTileConstraints = (
  tileIndex: Map<string, number[]>,
  units: Map<number, UnitState>,
  input: BattleInput
) => {
  for (const [key, ids] of tileIndex.entries()) {
    const living = ids.map((id) => units.get(id)).filter((unit) => unit?.alive) as UnitState[];
    if (living.length === 0) {
      continue;
    }
    const side = living[0].side;
    if (living.some((unit) => unit.side !== side)) {
      throw new Error(`Invariant violation: mixed sides on tile ${key}.`);
    }
    const totalSize = living.reduce((sum, unit) => sum + unit.size, 0);
    if (living.length > input.limits.maxUnitsPerTile) {
      throw new Error(`Invariant violation: too many units on tile ${key}.`);
    }
    if (totalSize > input.limits.maxSizePerTile) {
      throw new Error(`Invariant violation: tile ${key} exceeds max size.`);
    }
  }
};

export const resolveBattle = (input: BattleInput): ResolveOutput => {
  validateInput(input);
  const rng = createRng(input.seed);
  const events: BattleEvent[] = [];
  const units = new Map<number, UnitState>();
  const tileIndex = new Map<string, number[]>();
  const projectilesByTick = new Map<number, ProjectileState[]>();

  const addUnitToTile = (unit: UnitState, pos: Position) => {
    const key = tileKey(pos);
    const list = tileIndex.get(key) ?? [];
    list.push(unit.id);
    tileIndex.set(key, list);
  };

  const emitEvent = (event: BattleEvent) => {
    events.push(event);
  };

  emitEvent({
    tick: 0,
    seq: 0,
    type: "BattleInit",
    payload: { input }
  });

  const sortedUnits = [...input.units].sort((a, b) => a.id - b.id);
  for (const unitInput of sortedUnits) {
    const state: UnitState = {
      ...unitInput,
      alive: true,
      nextAvailableTick: 0
    };
    units.set(state.id, state);
    addUnitToTile(state, state.position);
    emitEvent({
      tick: 0,
      seq: state.id,
      type: "UnitSpawned",
      payload: { unit: unitInput }
    });
  }

  let projectileId = 0;
  let lastActivityTick = 0;
  let loopGuard = 0;

  const unitOrder = sortedUnits.map((unit) => unit.id);

  const scheduleProjectile = (projectile: ProjectileState) => {
    const list = projectilesByTick.get(projectile.impactTick) ?? [];
    list.push(projectile);
    projectilesByTick.set(projectile.impactTick, list);
  };

  const registerActivity = (tick: number) => {
    lastActivityTick = tick;
  };

  for (let tick = 0; tick <= input.timeLimit; tick += 1) {
    loopGuard += 1;
    if (loopGuard > MAX_LOOP_GUARD) {
      throw new Error("Loop guard tripped. Check for infinite loop conditions.");
    }
    let activityThisTick = false;

    const impacts = (projectilesByTick.get(tick) ?? []).sort(
      (a, b) => a.sourceId - b.sourceId || a.id - b.id
    );
    for (const projectile of impacts) {
      emitEvent({
        tick,
        seq: projectile.sourceId,
        type: "ProjectileImpacted",
        payload: {
          sourceId: projectile.sourceId,
          sourceSide: projectile.sourceSide,
          projectile: projectile.kind,
          target: projectile.target,
          impactTick: projectile.impactTick
        }
      });
      activityThisTick = true;

      const occupants = getTileUnits(tileIndex, units, projectile.target).filter(
        (unit) => unit.alive && unit.side !== projectile.sourceSide
      );
      if (occupants.length === 0) {
        continue;
      }
      if (projectile.kind === "Arrow") {
        const target = occupants[rng.nextInt(occupants.length)];
        applyRemoval(target, tileIndex, units);
        emitEvent({
          tick,
          seq: projectile.sourceId,
          type: "UnitRemoved",
          payload: {
            unitId: target.id,
            side: target.side,
            cause: "arrow",
            sourceId: projectile.sourceId
          }
        });
        activityThisTick = true;
      } else {
        const ordered = occupants.sort((a, b) => a.id - b.id);
        for (const target of ordered) {
          applyRemoval(target, tileIndex, units);
          emitEvent({
            tick,
            seq: projectile.sourceId,
            type: "UnitRemoved",
            payload: {
              unitId: target.id,
              side: target.side,
              cause: "fireball",
              sourceId: projectile.sourceId
            }
          });
          activityThisTick = true;
        }
      }
    }

    for (const unitId of unitOrder) {
      const unit = units.get(unitId);
      if (!unit || !unit.alive || unit.nextAvailableTick > tick) {
        continue;
      }

      const type = unit.type;
      const costs = UNIT_COSTS[type];

      if (type === "Infantry" || type === "Cavalry") {
        const target = findAdjacentEnemy(unit, units);
        if (target) {
          const hit = rng.next() < 0.5;
          emitEvent({
            tick,
            seq: unit.id,
            type: "MeleeAttackResolved",
            payload: {
              attackerId: unit.id,
              targetId: target.id,
              hit
            }
          });
          activityThisTick = true;
          if (hit && target.alive) {
            applyRemoval(target, tileIndex, units);
            emitEvent({
              tick,
              seq: unit.id,
              type: "UnitRemoved",
              payload: {
                unitId: target.id,
                side: target.side,
                cause: "melee",
                sourceId: unit.id
              }
            });
            activityThisTick = true;
          }
          unit.nextAvailableTick = tick + costs.attack;
          continue;
        }
      }

      if (type === "Archer" || type === "Mage") {
        const range = UNIT_RANGES[type];
        const tiles = getEnemyTilesInRange(unit, units, range);
        if (tiles.length > 0) {
          let chosen = tiles[0];
          if (type === "Archer") {
            tiles.sort((a, b) =>
              manhattan(unit.position, a.position) - manhattan(unit.position, b.position)
            );
            const nearest = tiles.filter(
              (tile) =>
                manhattan(unit.position, tile.position) ===
                manhattan(unit.position, tiles[0].position)
            );
            nearest.sort(sortTilesDeterministic);
            chosen = nearest[0];
          } else {
            tiles.sort((a, b) => b.count - a.count);
            const topCount = tiles[0].count;
            const contenders = tiles.filter((tile) => tile.count === topCount);
            contenders.sort((a, b) => {
              const distA = manhattan(unit.position, a.position);
              const distB = manhattan(unit.position, b.position);
              if (distA !== distB) {
                return distA - distB;
              }
              return sortTilesDeterministic(a, b);
            });
            chosen = contenders[0];
          }

          const distance = manhattan(unit.position, chosen.position);
          const projectileKind: ProjectileKind = type === "Archer" ? "Arrow" : "Fireball";
          const impactTick = tick + PROJECTILE_SPEED[projectileKind] * distance;
          const projectile: ProjectileState = {
            id: projectileId++,
            kind: projectileKind,
            sourceId: unit.id,
            sourceSide: unit.side,
            from: { ...unit.position },
            target: { ...chosen.position },
            fireTick: tick,
            impactTick
          };
          scheduleProjectile(projectile);
          emitEvent({
            tick,
            seq: unit.id,
            type: "ProjectileFired",
            payload: {
              sourceId: unit.id,
              sourceSide: unit.side,
              projectile: projectileKind,
              from: projectile.from,
              target: projectile.target,
              fireTick: tick,
              impactTick,
              distance
            }
          });
          activityThisTick = true;
          unit.nextAvailableTick = tick + costs.attack;
          continue;
        }
      }

      const step = findMoveStep(unit, tileIndex, units, input);
      if (step) {
        const from = { ...unit.position };
        const fromKey = tileKey(from);
        unit.position = step;
        const list = tileIndex.get(fromKey) ?? [];
        tileIndex.set(
          fromKey,
          list.filter((id) => id !== unit.id)
        );
        addUnitToTile(unit, unit.position);
        emitEvent({
          tick,
          seq: unit.id,
          type: "UnitMoved",
          payload: {
            unitId: unit.id,
            from,
            to: { ...unit.position }
          }
        });
        activityThisTick = true;
        checkTileConstraints(tileIndex, units, input);
        unit.nextAvailableTick = tick + costs.move;
        continue;
      }

      unit.nextAvailableTick = tick + costs.wait;
    }

    if (activityThisTick) {
      registerActivity(tick);
    }

    const redLeft = getFriendlyUnits(units, "Red").length;
    const blueLeft = getFriendlyUnits(units, "Blue").length;
    if (redLeft === 0 || blueLeft === 0) {
      const winner: BattleResult["winner"] =
        redLeft === 0 && blueLeft === 0 ? "Draw" : redLeft === 0 ? "Blue" : "Red";
      const result: BattleResult = {
        winner,
        reason: "eliminated",
        tick,
        survivors: { Red: redLeft, Blue: blueLeft }
      };
      emitEvent({
        tick,
        seq: 0,
        type: "BattleEnded",
        payload: result
      });
      return { input, events, result };
    }

    if (tick >= input.timeLimit) {
      const result: BattleResult = {
        winner: "Draw",
        reason: "time_limit",
        tick,
        survivors: { Red: redLeft, Blue: blueLeft }
      };
      emitEvent({
        tick,
        seq: 0,
        type: "BattleEnded",
        payload: result
      });
      return { input, events, result };
    }

    if (tick - lastActivityTick >= STALL_TICKS) {
      const result: BattleResult = {
        winner: "Draw",
        reason: "stalled",
        tick,
        survivors: { Red: redLeft, Blue: blueLeft }
      };
      emitEvent({
        tick,
        seq: 0,
        type: "BattleEnded",
        payload: result
      });
      return { input, events, result };
    }
  }

  const finalRed = getFriendlyUnits(units, "Red").length;
  const finalBlue = getFriendlyUnits(units, "Blue").length;
  const result: BattleResult = {
    winner: "Draw",
    reason: "time_limit",
    tick: input.timeLimit,
    survivors: { Red: finalRed, Blue: finalBlue }
  };
  emitEvent({
    tick: input.timeLimit,
    seq: 0,
    type: "BattleEnded",
    payload: result
  });
  return { input, events, result };
};
