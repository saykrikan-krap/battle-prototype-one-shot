import {
  DEFAULT_FACING,
  DEPLOYMENT_COLUMNS,
  GRID_HEIGHT,
  GRID_WIDTH,
  TILE_LIMITS,
  TIME_LIMIT_TICKS,
  TICK_SPEEDS,
  UNIT_SIZES
} from "../schema/constants";
import type {
  BattleEvent,
  BattleInput,
  BattleResult,
  Facing,
  ResolveOutput,
  Side,
  UnitInput,
  UnitType
} from "../schema/types";

const UNIT_LETTERS: Record<UnitType, string> = {
  Infantry: "I",
  Archer: "A",
  Cavalry: "C",
  Mage: "M"
};

const SIDE_COLORS: Record<Side, { fill: string; stroke: string }> = {
  Red: { fill: "#d84c3f", stroke: "#7f2c24" },
  Blue: { fill: "#2c6fb2", stroke: "#163b5f" }
};

const EFFECT_COLORS = {
  melee: "#f2d398",
  arrow: "#3b3f46",
  fireball: "#d47f2d"
};

type Mode = "setup" | "resolving" | "replay";

type AgentPlacementRequest = {
  side: string;
  type: string;
  x: number;
  y: number;
};

type AgentPlacementResult = { ok: true; unitId: number } | { ok: false; reason: string };

declare global {
  interface Window {
    battlePrototype?: {
      placeUnit: (request: AgentPlacementRequest) => AgentPlacementResult;
    };
  }
}

const tileKey = (pos: { x: number; y: number }) => `${pos.x},${pos.y}`;

const SIDE_ALIASES: Record<string, Side> = {
  red: "Red",
  blue: "Blue"
};

const TYPE_ALIASES: Record<string, UnitType> = {
  infantry: "Infantry",
  archer: "Archer",
  cavalry: "Cavalry",
  mage: "Mage"
};

const parseSide = (value: unknown): Side | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SIDE_ALIASES[normalized] ?? null;
};

const parseUnitType = (value: unknown): UnitType | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return TYPE_ALIASES[normalized] ?? null;
};

const parseGridIndex = (value: unknown): number | null => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric)) {
    return null;
  }
  return numeric;
};

interface ReplayUnit {
  id: number;
  side: Side;
  type: UnitType;
  size: number;
  position: { x: number; y: number };
  alive: boolean;
}

interface ActiveProjectile {
  id: number;
  sourceId: number;
  sourceSide: Side;
  kind: "Arrow" | "Fireball";
  from: { x: number; y: number };
  target: { x: number; y: number };
  fireTick: number;
  impactTick: number;
}

interface MoveAnimation {
  unitId: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  startTick: number;
  endTick: number;
}

interface MeleeFlash {
  position: { x: number; y: number };
  startTick: number;
  duration: number;
}

class ReplayEngine {
  private input: BattleInput;
  private eventsByTick: Map<number, BattleEvent[]>;
  private currentTick: number;
  private projectileId: number;
  public units: Map<number, ReplayUnit>;
  public projectiles: ActiveProjectile[];
  public moveAnimations: Map<number, MoveAnimation>;
  public meleeFlashes: MeleeFlash[];
  public tileFacing: Map<string, Facing>;
  public result: BattleResult | null;

  constructor(output: ResolveOutput) {
    this.input = output.input;
    this.eventsByTick = new Map();
    this.currentTick = -1;
    this.projectileId = 0;
    this.units = new Map();
    this.projectiles = [];
    this.moveAnimations = new Map();
    this.meleeFlashes = [];
    this.tileFacing = new Map();
    this.result = output.result;
    this.indexEvents(output.events);
  }

  private indexEvents(events: BattleEvent[]) {
    for (const event of events) {
      const list = this.eventsByTick.get(event.tick) ?? [];
      list.push(event);
      this.eventsByTick.set(event.tick, list);
    }
  }

  reset() {
    this.currentTick = -1;
    this.projectileId = 0;
    this.units.clear();
    this.projectiles = [];
    this.moveAnimations.clear();
    this.meleeFlashes = [];
    this.tileFacing.clear();
  }

  private isTileOccupied(pos: { x: number; y: number }, excludeId?: number) {
    for (const unit of this.units.values()) {
      if (!unit.alive) {
        continue;
      }
      if (excludeId && unit.id === excludeId) {
        continue;
      }
      if (unit.position.x === pos.x && unit.position.y === pos.y) {
        return true;
      }
    }
    return false;
  }

  private ensureFacingForTile(pos: { x: number; y: number }, side: Side) {
    const key = tileKey(pos);
    if (!this.tileFacing.has(key)) {
      this.tileFacing.set(key, DEFAULT_FACING[side]);
    }
  }

  private updateFacingOnEntry(
    unit: ReplayUnit,
    from: { x: number; y: number },
    to: { x: number; y: number },
    wasEmpty: boolean
  ) {
    if (wasEmpty) {
      this.ensureFacingForTile(to, unit.side);
    }
    if (to.x === from.x) {
      return;
    }
    this.tileFacing.set(tileKey(to), to.x > from.x ? "right" : "left");
  }

  private clearFacingIfEmpty(pos: { x: number; y: number }) {
    if (!this.isTileOccupied(pos)) {
      this.tileFacing.delete(tileKey(pos));
    }
  }

  advanceTo(targetTick: number) {
    for (let tick = this.currentTick + 1; tick <= targetTick; tick += 1) {
      const events = this.eventsByTick.get(tick) ?? [];
      for (const event of events) {
        this.applyEvent(event);
      }
      this.currentTick = tick;
    }
  }

  private applyEvent(event: BattleEvent) {
    switch (event.type) {
      case "BattleInit":
        this.input = event.payload.input;
        break;
      case "UnitSpawned": {
        const unit = event.payload.unit;
        this.units.set(unit.id, { ...unit, alive: true });
        this.ensureFacingForTile(unit.position, unit.side);
        break;
      }
      case "UnitMoved": {
        const unit = this.units.get(event.payload.unitId);
        if (!unit) {
          break;
        }
        const from = event.payload.from;
        const to = event.payload.to;
        const wasEmpty = !this.isTileOccupied(to, unit.id);
        this.updateFacingOnEntry(unit, from, to, wasEmpty);
        this.moveAnimations.set(unit.id, {
          unitId: unit.id,
          from,
          to,
          startTick: event.tick,
          endTick: event.tick + 1
        });
        unit.position = { ...to };
        this.clearFacingIfEmpty(from);
        break;
      }
      case "MeleeAttackResolved": {
        const target = this.units.get(event.payload.targetId);
        if (target) {
          this.meleeFlashes.push({
            position: { ...target.position },
            startTick: event.tick,
            duration: 0.5
          });
        }
        break;
      }
      case "ProjectileFired": {
        this.projectiles.push({
          id: this.projectileId++,
          sourceId: event.payload.sourceId,
          sourceSide: event.payload.sourceSide,
          kind: event.payload.projectile,
          from: event.payload.from,
          target: event.payload.target,
          fireTick: event.payload.fireTick,
          impactTick: event.payload.impactTick
        });
        break;
      }
      case "ProjectileImpacted": {
        this.projectiles = this.projectiles.filter(
          (projectile) =>
            !(
              projectile.sourceId === event.payload.sourceId &&
              projectile.impactTick === event.payload.impactTick &&
              projectile.kind === event.payload.projectile &&
              projectile.target.x === event.payload.target.x &&
              projectile.target.y === event.payload.target.y
            )
        );
        break;
      }
      case "UnitRemoved": {
        const unit = this.units.get(event.payload.unitId);
        if (unit) {
          unit.alive = false;
          this.clearFacingIfEmpty(unit.position);
        }
        break;
      }
      case "BattleEnded": {
        this.result = event.payload;
        break;
      }
      default:
        break;
    }
  }

  getInput() {
    return this.input;
  }
}

const select = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element as T;
};

const app = () => {
  let mode: Mode = "setup";
  let worker: Worker | null = null;
  let output: ResolveOutput | null = null;
  let engine: ReplayEngine | null = null;

  const canvas = select<HTMLCanvasElement>("#battle-canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported.");
  }

  const headerStatus = select<HTMLDivElement>("#header-status");
  const statusPill = select<HTMLDivElement>("#status-pill");
  const tickDisplay = select<HTMLDivElement>("#tick-display");
  const overlay = select<HTMLDivElement>("#board-overlay");
  const setupPanel = select<HTMLDivElement>("#setup-panel");
  const replayPanel = select<HTMLDivElement>("#replay-panel");
  const debugPanel = select<HTMLDivElement>("#debug-panel");

  const sideButtons = select<HTMLDivElement>("#side-buttons");
  const typeButtons = select<HTMLDivElement>("#type-buttons");
  const seedInput = select<HTMLInputElement>("#seed-input");
  const timeLimitInput = select<HTMLInputElement>("#time-limit");
  const seedRandom = select<HTMLButtonElement>("#seed-random");
  const resolveButton = select<HTMLButtonElement>("#resolve-button");

  const playToggle = select<HTMLButtonElement>("#play-toggle");
  const stepButton = select<HTMLButtonElement>("#step-button");
  const restartButton = select<HTMLButtonElement>("#restart-button");
  const setupButton = select<HTMLButtonElement>("#setup-button");
  const speedSelect = select<HTMLSelectElement>("#speed-select");
  const winnerText = select<HTMLHeadingElement>("#winner-text");
  const survivorText = select<HTMLParagraphElement>("#survivor-text");
  const tickTotal = select<HTMLParagraphElement>("#tick-total");

  const exportInputBtn = select<HTMLButtonElement>("#export-input");
  const exportLogBtn = select<HTMLButtonElement>("#export-log");
  const importArea = select<HTMLTextAreaElement>("#import-area");
  const importInputBtn = select<HTMLButtonElement>("#import-input");
  const importLogBtn = select<HTMLButtonElement>("#import-log");
  const eventLogContent = select<HTMLPreElement>("#event-log-content");

  let selectedSide: Side = "Red";
  let selectedType: UnitType = "Infantry";
  let nextUnitId = 1;
  let setupUnits: UnitInput[] = [];

  let playhead = 0;
  let playing = false;
  let speed = 20;
  let maxTick = 0;
  let lastFrame = performance.now();

  const updateMode = (newMode: Mode) => {
    mode = newMode;
    headerStatus.textContent =
      mode === "setup" ? "Setup Mode" : mode === "resolving" ? "Resolving" : "Replay Mode";
    overlay.classList.toggle("active", mode === "resolving");
    setupPanel.hidden = mode !== "setup";
    replayPanel.hidden = mode !== "replay";
    debugPanel.hidden = mode !== "replay";
  };

  const setStatus = (message: string) => {
    statusPill.textContent = message;
  };

  const buildButtons = () => {
    const sides: Side[] = ["Red", "Blue"];
    for (const side of sides) {
      const button = document.createElement("button");
      button.textContent = side;
      button.className = "ghost";
      button.dataset.value = side;
      button.onclick = () => {
        selectedSide = side;
        syncButtonStates();
        render();
      };
      sideButtons.appendChild(button);
    }

    const types: UnitType[] = ["Infantry", "Archer", "Cavalry", "Mage"];
    for (const type of types) {
      const button = document.createElement("button");
      button.textContent = `${UNIT_LETTERS[type]} ${type}`;
      button.className = "ghost";
      button.dataset.value = type;
      button.onclick = () => {
        selectedType = type;
        syncButtonStates();
        render();
      };
      typeButtons.appendChild(button);
    }
  };

  const syncButtonStates = () => {
    sideButtons.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.value === selectedSide);
    });
    typeButtons.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.value === selectedType);
    });
  };

  const seedDefault = Math.floor(Math.random() * 100000) + 1;
  seedInput.value = seedDefault.toString();
  timeLimitInput.value = TIME_LIMIT_TICKS.toString();

  seedRandom.onclick = () => {
    seedInput.value = (Math.floor(Math.random() * 100000) + 1).toString();
  };

  const getTileUnits = (pos: { x: number; y: number }) =>
    setupUnits.filter((unit) => unit.position.x === pos.x && unit.position.y === pos.y);

  const canPlaceUnit = (pos: { x: number; y: number }, side: Side, size: number) => {
    if (pos.x < 0 || pos.y < 0 || pos.x >= GRID_WIDTH || pos.y >= GRID_HEIGHT) {
      return { ok: false, reason: "Outside grid." };
    }
    const zone = DEPLOYMENT_COLUMNS[side];
    if (pos.x < zone.start || pos.x > zone.end) {
      return { ok: false, reason: "Outside deployment zone." };
    }
    const occupants = getTileUnits(pos);
    if (occupants.length > 0 && occupants.some((unit) => unit.side !== side)) {
      return { ok: false, reason: "Tile already occupied by enemy side." };
    }
    const totalSize = occupants.reduce((sum, unit) => sum + unit.size, 0) + size;
    if (occupants.length + 1 > TILE_LIMITS.maxUnitsPerTile) {
      return { ok: false, reason: "Tile unit limit reached." };
    }
    if (totalSize > TILE_LIMITS.maxSizePerTile) {
      return { ok: false, reason: "Tile size limit exceeded." };
    }
    return { ok: true };
  };

  const placeUnitAt = (
    pos: { x: number; y: number },
    side: Side,
    type: UnitType,
    statusMessage?: string
  ): AgentPlacementResult => {
    const size = UNIT_SIZES[type];
    const validation = canPlaceUnit(pos, side, size);
    if (!validation.ok) {
      const reason = validation.reason ?? "Cannot place unit.";
      setStatus(reason);
      return { ok: false, reason };
    }
    const unit: UnitInput = {
      id: nextUnitId++,
      side,
      type,
      size,
      position: { ...pos }
    };
    setupUnits.push(unit);
    setStatus(statusMessage ?? `${side} ${type} placed.`);
    render();
    return { ok: true, unitId: unit.id };
  };

  const placeUnit = (pos: { x: number; y: number }) => {
    placeUnitAt(pos, selectedSide, selectedType);
  };

  const removeUnit = (pos: { x: number; y: number }) => {
    const occupants = getTileUnits(pos);
    if (occupants.length === 0) {
      setStatus("No unit here to remove.");
      return;
    }
    const unit = occupants[occupants.length - 1];
    setupUnits = setupUnits.filter((entry) => entry.id !== unit.id);
    setStatus(`Removed unit ${unit.id}.`);
    render();
  };

  const buildInput = (): BattleInput => {
    return {
      grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
      limits: { ...TILE_LIMITS },
      seed: Number(seedInput.value) || 1,
      timeLimit: Number(timeLimitInput.value) || TIME_LIMIT_TICKS,
      units: [...setupUnits]
    };
  };

  const resetReplay = () => {
    if (!output) {
      return;
    }
    engine = new ReplayEngine(output);
    engine.reset();
    engine.advanceTo(0);
    playhead = 0;
    playing = false;
    maxTick = output.result.tick;
    updateReplayInfo();
  };

  const resolveBattle = () => {
    if (setupUnits.length === 0) {
      setStatus("Place at least one unit before resolving.");
      return;
    }
    updateMode("resolving");
    setStatus("Sending battle to resolver...");

    if (worker) {
      worker.terminate();
    }
    worker = new Worker(new URL("../resolver/worker.ts", import.meta.url), { type: "module" });
    const input = buildInput();
    worker.onmessage = (event) => {
      if (event.data?.type === "error") {
        setStatus(`Resolver error: ${event.data.message}`);
        updateMode("setup");
        return;
      }
      output = event.data.output as ResolveOutput;
      engine = new ReplayEngine(output);
      engine.reset();
      engine.advanceTo(0);
      playhead = 0;
      playing = false;
      maxTick = output.result.tick;
      updateMode("replay");
      setStatus("Replay ready.");
      updateReplayInfo();
      updateEventLog();
      render();
    };
    worker.postMessage(input);
  };

  resolveButton.onclick = resolveBattle;

  exportInputBtn.onclick = () => {
    if (!output && setupUnits.length === 0) {
      setStatus("No input to export.");
      return;
    }
    const payload = output?.input ?? buildInput();
    downloadJson(payload, "battle-input.json");
  };

  exportLogBtn.onclick = () => {
    if (!output) {
      setStatus("No event log to export.");
      return;
    }
    downloadJson(output, "battle-log.json");
  };

  importInputBtn.onclick = () => {
    try {
      const parsed = JSON.parse(importArea.value) as BattleInput;
      loadInput(parsed);
    } catch (error) {
      setStatus("Invalid BattleInput JSON.");
    }
  };

  importLogBtn.onclick = () => {
    try {
      const parsed = JSON.parse(importArea.value) as ResolveOutput;
      if (!parsed.input || !parsed.events) {
        setStatus("ResolveOutput JSON required.");
        return;
      }
      output = parsed;
      updateMode("replay");
      resetReplay();
      updateEventLog();
      render();
      setStatus("Loaded event log.");
    } catch (error) {
      setStatus("Invalid ResolveOutput JSON.");
    }
  };

  playToggle.onclick = () => {
    playing = !playing;
    playToggle.textContent = playing ? "Pause" : "Play";
  };

  stepButton.onclick = () => {
    playing = false;
    playToggle.textContent = "Play";
    playhead = Math.min(playhead + 1, maxTick);
    engine?.advanceTo(Math.floor(playhead));
    updateReplayInfo();
    render();
  };

  restartButton.onclick = () => {
    resetReplay();
    playToggle.textContent = "Play";
    render();
  };

  setupButton.onclick = () => {
    returnToSetup();
  };

  for (const tickSpeed of TICK_SPEEDS) {
    const option = document.createElement("option");
    option.value = tickSpeed.toString();
    option.textContent = tickSpeed.toString();
    if (tickSpeed === 20) {
      option.selected = true;
    }
    speedSelect.appendChild(option);
  }

  speedSelect.onchange = () => {
    speed = Number(speedSelect.value) || 20;
  };

  const updateReplayInfo = () => {
    tickDisplay.textContent = `Tick: ${Math.floor(playhead)}`;
    if (!engine?.result) {
      return;
    }
    const result = engine.result;
    winnerText.textContent = `Winner: ${result.winner}`;
    survivorText.textContent = `Survivors: Red ${result.survivors.Red} | Blue ${result.survivors.Blue}`;
    tickTotal.textContent = `Total Ticks: ${result.tick}`;
  };

  const updateEventLog = () => {
    if (!output) {
      eventLogContent.textContent = "";
      return;
    }
    eventLogContent.textContent = JSON.stringify(output.events, null, 2);
  };

  const downloadJson = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadInput = (input: BattleInput, message = "Loaded input.") => {
    setupUnits = input.units.map((unit) => ({ ...unit }));
    nextUnitId =
      setupUnits.reduce((maxId, unit) => Math.max(maxId, unit.id), 0) + 1;
    seedInput.value = input.seed.toString();
    timeLimitInput.value = input.timeLimit.toString();
    updateMode("setup");
    setStatus(message);
    render();
  };

  const returnToSetup = () => {
    const baseInput = output?.input ?? buildInput();
    playing = false;
    playToggle.textContent = "Play";
    playhead = 0;
    maxTick = 0;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    output = null;
    engine = null;
    loadInput(baseInput, "Back to setup.");
    tickDisplay.textContent = "Tick: 0";
  };

  const placeUnitFromAgent = (request: AgentPlacementRequest): AgentPlacementResult => {
    if (mode !== "setup") {
      return { ok: false, reason: "Not in setup mode." };
    }
    if (!request || typeof request !== "object") {
      return { ok: false, reason: "Invalid request." };
    }
    const side = parseSide(request.side);
    if (!side) {
      return { ok: false, reason: "Invalid side." };
    }
    const type = parseUnitType(request.type);
    if (!type) {
      return { ok: false, reason: "Invalid unit type." };
    }
    const x = parseGridIndex(request.x);
    const y = parseGridIndex(request.y);
    if (x === null || y === null) {
      return { ok: false, reason: "Invalid coordinates." };
    }
    return placeUnitAt({ x, y }, side, type, `Agent placed ${side} ${type}.`);
  };

  const getCanvasMetrics = () => {
    const parent = canvas.parentElement;
    if (!parent) {
      return { cellSize: 40, width: GRID_WIDTH * 40, height: GRID_HEIGHT * 40 };
    }
    const availableWidth = parent.clientWidth - 36;
    const cellSize = Math.max(24, Math.floor(availableWidth / GRID_WIDTH));
    const width = cellSize * GRID_WIDTH;
    const height = cellSize * GRID_HEIGHT;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return { cellSize, width, height };
  };

  const resizeCanvas = () => {
    const { cellSize, width, height } = getCanvasMetrics();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cellSize, width, height };
  };

  let canvasMetrics = resizeCanvas();

  const buildSetupFacing = () => {
    const facing = new Map<string, Facing>();
    for (const unit of setupUnits) {
      const key = tileKey(unit.position);
      if (!facing.has(key)) {
        facing.set(key, DEFAULT_FACING[unit.side]);
      }
    }
    return facing;
  };

  const drawGrid = (cellSize: number, width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);
    ctx.save();

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const isRedZone = x >= DEPLOYMENT_COLUMNS.Red.start && x <= DEPLOYMENT_COLUMNS.Red.end;
        const isBlueZone = x >= DEPLOYMENT_COLUMNS.Blue.start && x <= DEPLOYMENT_COLUMNS.Blue.end;
        if (isRedZone || isBlueZone) {
          ctx.fillStyle = isRedZone
            ? "rgba(216, 76, 63, 0.12)"
            : "rgba(44, 111, 178, 0.12)";
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }
    }

    ctx.strokeStyle = "rgba(20, 24, 30, 0.2)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_WIDTH; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * cellSize, 0);
      ctx.lineTo(x * cellSize, height);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_HEIGHT; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellSize);
      ctx.lineTo(width, y * cellSize);
      ctx.stroke();
    }

    ctx.restore();
  };

  const drawUnits = (
    units: ReplayUnit[],
    cellSize: number,
    currentTick: number,
    alpha: number,
    tileFacing: Map<string, Facing>
  ) => {
    const byTile = new Map<string, ReplayUnit[]>();
    for (const unit of units) {
      if (!unit.alive) {
        continue;
      }
      const key = tileKey(unit.position);
      const list = byTile.get(key) ?? [];
      list.push(unit);
      byTile.set(key, list);
    }

    const slotOffsetsByFacing: Record<Facing, Array<{ x: number; y: number }>> = {
      right: [
        { x: 0.25, y: -0.25 },
        { x: 0.25, y: 0.25 },
        { x: -0.25, y: -0.25 },
        { x: -0.25, y: 0.25 }
      ],
      left: [
        { x: -0.25, y: -0.25 },
        { x: -0.25, y: 0.25 },
        { x: 0.25, y: -0.25 },
        { x: 0.25, y: 0.25 }
      ]
    };

    for (const [key, tileUnits] of byTile.entries()) {
      const facing = tileFacing.get(key) ?? DEFAULT_FACING[tileUnits[0].side];
      const slotOffsets = slotOffsetsByFacing[facing];
      tileUnits.sort((a, b) => a.id - b.id);
      tileUnits.forEach((unit, index) => {
        const offset = slotOffsets[index] ?? { x: 0, y: 0 };
        const animation = engine?.moveAnimations.get(unit.id);
        let position = { x: unit.position.x, y: unit.position.y };
        if (
          animation &&
          currentTick >= animation.startTick &&
          currentTick < animation.endTick &&
          alpha < 1
        ) {
          position = {
            x: animation.from.x + (animation.to.x - animation.from.x) * alpha,
            y: animation.from.y + (animation.to.y - animation.from.y) * alpha
          };
        }
        const centerX = (position.x + 0.5 + offset.x) * cellSize;
        const centerY = (position.y + 0.5 + offset.y) * cellSize;
        const radius = cellSize * 0.22;

        ctx.beginPath();
        ctx.fillStyle = SIDE_COLORS[unit.side].fill;
        ctx.strokeStyle = SIDE_COLORS[unit.side].stroke;
        ctx.lineWidth = 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#1b1f24";
        ctx.font = `${Math.max(10, radius)}px Space Grotesk, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(UNIT_LETTERS[unit.type], centerX, centerY + 1);
      });
    }
  };

  const drawProjectiles = (projectiles: ActiveProjectile[], cellSize: number, playheadTick: number) => {
    for (const projectile of projectiles) {
      const duration = projectile.impactTick - projectile.fireTick;
      if (duration <= 0) {
        continue;
      }
      const progress = Math.min(
        1,
        Math.max(0, (playheadTick - projectile.fireTick) / duration)
      );
      const x = projectile.from.x + (projectile.target.x - projectile.from.x) * progress + 0.5;
      const y = projectile.from.y + (projectile.target.y - projectile.from.y) * progress + 0.5;

      ctx.beginPath();
      ctx.fillStyle = projectile.kind === "Arrow" ? EFFECT_COLORS.arrow : EFFECT_COLORS.fireball;
      const size = projectile.kind === "Arrow" ? cellSize * 0.12 : cellSize * 0.2;
      ctx.arc(x * cellSize, y * cellSize, size, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawMeleeFlashes = (flashes: MeleeFlash[], cellSize: number, playheadTick: number) => {
    for (const flash of flashes) {
      const age = playheadTick - flash.startTick;
      if (age < 0 || age > flash.duration) {
        continue;
      }
      const progress = age / flash.duration;
      const radius = cellSize * (0.1 + progress * 0.4);
      const x = (flash.position.x + 0.5) * cellSize;
      const y = (flash.position.y + 0.5) * cellSize;
      ctx.beginPath();
      ctx.strokeStyle = EFFECT_COLORS.melee;
      ctx.globalAlpha = 1 - progress;
      ctx.lineWidth = 2;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  const render = () => {
    const { cellSize, width, height } = canvasMetrics;
    drawGrid(cellSize, width, height);

    if (mode === "setup") {
      const facing = buildSetupFacing();
      drawUnits(setupUnits.map((unit) => ({ ...unit, alive: true })), cellSize, 0, 0, facing);
      return;
    }

    if (!engine) {
      return;
    }
    const currentTick = Math.floor(playhead);
    const alpha = playhead - currentTick;
    const units = Array.from(engine.units.values());
    drawProjectiles(engine.projectiles, cellSize, playhead);
    drawMeleeFlashes(engine.meleeFlashes, cellSize, playhead);
    drawUnits(units, cellSize, currentTick, alpha, engine.tileFacing);
  };

  const animate = (time: number) => {
    const delta = (time - lastFrame) / 1000;
    lastFrame = time;
    if (mode === "replay" && engine) {
      if (playing) {
        playhead = Math.min(playhead + delta * speed, maxTick);
        engine.advanceTo(Math.floor(playhead));
        if (playhead >= maxTick) {
          playing = false;
          playToggle.textContent = "Play";
        }
      }
      updateReplayInfo();
      render();
    }
    requestAnimationFrame(animate);
  };

  canvas.addEventListener("click", (event) => {
    if (mode !== "setup") {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cellSize = rect.width / GRID_WIDTH;
    const x = Math.floor((event.clientX - rect.left) / cellSize);
    const y = Math.floor((event.clientY - rect.top) / cellSize);
    placeUnit({ x, y });
  });

  canvas.addEventListener("contextmenu", (event) => {
    if (mode !== "setup") {
      return;
    }
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cellSize = rect.width / GRID_WIDTH;
    const x = Math.floor((event.clientX - rect.left) / cellSize);
    const y = Math.floor((event.clientY - rect.top) / cellSize);
    removeUnit({ x, y });
  });

  window.addEventListener("resize", () => {
    canvasMetrics = resizeCanvas();
    render();
  });

  window.battlePrototype = {
    placeUnit: placeUnitFromAgent
  };

  buildButtons();
  syncButtonStates();
  updateMode("setup");
  render();
  requestAnimationFrame(animate);
};

export default app;
