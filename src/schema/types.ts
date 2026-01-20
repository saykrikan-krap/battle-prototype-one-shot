export type Side = "Red" | "Blue";
export type UnitType = "Infantry" | "Archer" | "Cavalry" | "Mage";
export type ProjectileKind = "Arrow" | "Fireball";

export interface Position {
  x: number;
  y: number;
}

export interface UnitInput {
  id: number;
  side: Side;
  type: UnitType;
  size: number;
  position: Position;
}

export interface BattleInput {
  grid: {
    width: number;
    height: number;
  };
  limits: {
    maxUnitsPerTile: number;
    maxSizePerTile: number;
  };
  seed: number;
  timeLimit: number;
  units: UnitInput[];
}

export type BattleEventType =
  | "BattleInit"
  | "UnitSpawned"
  | "UnitMoved"
  | "MeleeAttackResolved"
  | "ProjectileFired"
  | "ProjectileImpacted"
  | "UnitRemoved"
  | "BattleEnded";

export interface BattleEventBase<TType extends BattleEventType, TPayload> {
  tick: number;
  seq: number;
  type: TType;
  payload: TPayload;
}

export interface BattleInitPayload {
  input: BattleInput;
}

export interface UnitSpawnedPayload {
  unit: UnitInput;
}

export interface UnitMovedPayload {
  unitId: number;
  from: Position;
  to: Position;
}

export interface MeleeAttackResolvedPayload {
  attackerId: number;
  targetId: number;
  hit: boolean;
}

export interface ProjectileFiredPayload {
  sourceId: number;
  sourceSide: Side;
  projectile: ProjectileKind;
  from: Position;
  target: Position;
  fireTick: number;
  impactTick: number;
  distance: number;
}

export interface ProjectileImpactedPayload {
  sourceId: number;
  sourceSide: Side;
  projectile: ProjectileKind;
  target: Position;
  impactTick: number;
}

export interface UnitRemovedPayload {
  unitId: number;
  side: Side;
  cause: "melee" | "arrow" | "fireball";
  sourceId: number;
}

export interface BattleEndedPayload {
  winner: Side | "Draw";
  reason: "eliminated" | "time_limit" | "stalled";
  tick: number;
  survivors: {
    Red: number;
    Blue: number;
  };
}

export type BattleEvent =
  | BattleEventBase<"BattleInit", BattleInitPayload>
  | BattleEventBase<"UnitSpawned", UnitSpawnedPayload>
  | BattleEventBase<"UnitMoved", UnitMovedPayload>
  | BattleEventBase<"MeleeAttackResolved", MeleeAttackResolvedPayload>
  | BattleEventBase<"ProjectileFired", ProjectileFiredPayload>
  | BattleEventBase<"ProjectileImpacted", ProjectileImpactedPayload>
  | BattleEventBase<"UnitRemoved", UnitRemovedPayload>
  | BattleEventBase<"BattleEnded", BattleEndedPayload>;

export interface BattleResult {
  winner: Side | "Draw";
  reason: "eliminated" | "time_limit" | "stalled";
  tick: number;
  survivors: {
    Red: number;
    Blue: number;
  };
}

export interface ResolveOutput {
  input: BattleInput;
  events: BattleEvent[];
  result: BattleResult;
}
