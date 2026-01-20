# Tick-Based Battle System Prototype Plan

## Purpose
This document describes a **throwaway prototype** designed to validate a tick-based battle loop with a resolver/replayer split. The goal is not feature completeness, but to prove correctness, determinism, and replay fidelity.

---

## 1. Tech Stack (Chosen for Speed & Clarity)

- TypeScript
- HTML + Canvas
- Vite (dev server/build)
- Web Worker for battle resolution

Design rule: **Replayer never imports resolver logic**. They only share schema/types.

---

## 2. Repository Layout

- /schema  
  Shared types for battle input, events, and results

- /resolver  
  Pure battle logic + worker entrypoint

- /replayer  
  Setup UI + replay UI

---

## 3. Prototype Rules & Constants

### 3.1 Combatant Types

| Type     | Size |
|----------|------|
| Infantry | 2    |
| Archer   | 2    |
| Cavalry | 3    |
| Mage    | 2    |

### 3.2 Tile Constraints

- Max combatants per tile: 4  
- Max total size per tile: 10  
- Tiles are single-side only (no mixed Red/Blue occupancy)
- Constraints apply to all units on the tile

### 3.3 Battle Grid

- Grid size: 12 x 8
- Deployment:
  - Red: columns 0–2
  - Blue: columns 9–11

### 3.4 Tick Rate (Replay)

- Default: 20 ticks/sec
- Options: 10 / 20 / 40
- Pause + step tick

### 3.5 Action Costs (ticks)

| Unit     | Move | Attack / Spell | Wait |
|----------|------|----------------|------|
| Infantry | 6    | 12 (melee)     | 1    |
| Archer   | 6    | 14 (arrow)     | 1    |
| Cavalry | 4    | 12 (melee)     | 1    |
| Mage    | 6    | 16 (fireball)  | 1    |

Minimum cost is always ≥ 1 tick.

### 3.6 Ranges & Projectiles

- Distance metric: Manhattan
- Archer range: 5
- Mage fireball range: 6
- Minimum ranged distance: 1 (cannot target own tile)

Projectile speed:
- Arrow: 2 ticks per tile
- Fireball: 3 ticks per tile

Impact tick:
```
impactTick = fireTick + (speed * distance)
```

### 3.7 Damage & Removal

- No HP
- If damaged → unit removed immediately
- Melee: 50% hit chance
- Arrow: hits random enemy on target tile at impact
- Fireball: removes **all enemy units** on target tile
- Fireball affects enemies only (prototype assumption)

### 3.8 Target Movement Rule

- Projectile always travels to the original target tile
- Impact checks current occupants of that tile

### 3.9 End Conditions

- A side loses when it has 0 units remaining
- Time limit: 2000 ticks
- If reached → Draw

---

## 4. Locked Design Decisions (Blockers Resolved)

- Enemies may not share tiles (single-side per tile)
- Melee range: distance = 1 (adjacent only)
- Same-tick ordering:
  1. Projectile impacts
  2. Unit actions (stable by ID)
- If movement fails → unit waits 1 tick

---

## 5. Data Contracts

### 5.1 Battle Input

- Grid size
- Tile limits
- RNG seed
- Time limit
- Units:
  - id (integer)
  - side (Red/Blue)
  - type
  - size
  - position

### 5.2 Event Log

Each event:
- tick
- seq (integer ordering key derived from source unit id)
- type
- payload

Minimum event types:
- BattleInit
- UnitSpawned
- UnitMoved
- MeleeAttackResolved
- ProjectileFired
- ProjectileImpacted
- UnitRemoved
- BattleEnded

Events are ordered by (tick, seq).
For events sharing the same tick + seq, log order is authoritative.
Seq uses the source unit id (integer). Follow-on events reuse the source unit id; non-unit events use seq 0.

---

## 6. Resolver Design

### 6.1 State

- Unit state (alive, position, nextAvailableTick)
- Tile occupancy index
- Projectiles indexed by impact tick

### 6.2 Core Loop

1. Process projectile impacts at tick T
2. Process units available at tick T
3. Execute actions → emit events
4. Schedule nextAvailableTick
5. Advance tick

### 6.3 Pathfinding

- BFS toward nearest enemy tile
- Tile passable if empty or occupied by same side, and size/count constraints hold
- Step one tile per move action

### 6.4 AI Rules

**Infantry / Cavalry**
1. Melee if enemy in range
2. Move toward nearest enemy
3. Wait

**Archer**
1. Shoot nearest enemy tile in range
2. Move
3. Wait

**Mage**
1. Fireball tile with most enemies in range
2. Move
3. Wait

### 6.5 Determinism

- Seeded RNG only
- Stable ordering
- Event log is authoritative

---

## 7. Phase 1 UI — Setup

- Grid canvas
- Unit palette (type + side)
- Click to place, right-click/delete to remove
- Enforce constraints with feedback
- Seed input
- Resolve button

Units rendered as shapes with letters:
- I, A, C, M
- Red / Blue coloring

---

## 8. Phase 2 UI — Resolution

- “Resolving battle…” screen
- Resolver runs in Web Worker
- UI remains responsive

---

## 9. Phase 3 UI — Replay

### Playback
- Tick-based clock
- Play / Pause / Speed / Step
- Current tick display

### Rendering
- Units drawn in tile (2x2 layout if multiple)
- Movement animated over 1 tick
- Melee flashes
- Projectiles interpolated from fire → impact

Visuals:
- Arrow: small marker
- Fireball: larger marker

### Results
- Winner banner (Red / Blue / Draw)
- Survivors count
- Total ticks elapsed

---

## 10. Debug & Validation Tools

- Optional event log viewer
- Export/import battle input & logs
- Invariant checks:
  - Tile limits respected
  - Removed units never act
- Stall detection (no changes for N ticks)

---

## 11. Task Breakdown

### A. Schema
- Define battle input, events, results

### B. Resolver
- State + scheduler
- BFS movement
- Actions & projectiles
- End conditions

### C. Setup UI
- Placement & validation

### D. Resolution UI
- Worker integration

### E. Replay UI
- Playback engine
- Rendering
- Results display

---

## Outcome

This prototype validates:
- Tick-based scheduling
- Action costs & fairness
- Event-log-driven replay
- Projectile timing & targeting rules
- Clean separation of simulation and presentation
