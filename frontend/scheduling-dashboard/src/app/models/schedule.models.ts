// ── Request models ────────────────────────────────────────────────────────────

export interface RunRequest {
  instance: string;
  algorithm: string;
  operators: string[];
  maxIterations: number;
  numRestarts: number;
  insertionInterval: number;
  maxShift: number;
  maxExecutionSeconds: number;
}

export interface ConfigEntry {
  label: string;
  operators: string[];
  maxIterations: number;
  numRestarts: number;
  insertionInterval: number;
  maxShift: number;
  maxExecutionSeconds: number;
}

export interface CompareRequest {
  instance: string;
  configurations: ConfigEntry[];
}

// ── Response models ───────────────────────────────────────────────────────────

export interface ScheduledProgram {
  programId: string;
  channelId: number;
  start: number;
  end: number;
}

export interface PenaltyBreakdown {
  baseScore: number;
  bonusEarned: number;
  channelSwitches: number;
  switchPenaltyTotal: number;
  timingViolations: number;
  timingPenaltyTotal: number;
  finalScore: number;
}

export interface OperatorStat {
  calls: number;
  improvements: number;
  scoreDelta: number;
}

export interface ProgressPoint {
  iteration: number;
  score: number;
  currentScore?: number;
  bestScore?: number;
}

export interface ScheduleResult {
  score: number;
  executionTime: number;
  conflicts: number;
  initialScore: number;
  scoreImprovement: number;
  algorithm: string;
  instance: string;
  operators: string[];
  penaltyBreakdown?: PenaltyBreakdown;
  operatorStats?: Record<string, OperatorStat>;
  progressHistory?: ProgressPoint[];
  scheduledPrograms?: ScheduledProgram[];
  label?: string;
}

export interface CompareResult {
  instance: string;
  results: ScheduleResult[];
  bestLabel: string;
  bestScore: number;
}

// ── SignalR messages ──────────────────────────────────────────────────────────

export interface StatusMessage {
  status: 'running' | 'completed' | 'error' | 'cancelled';
  message: string;
  result?: ScheduleResult;
}

// ── Instance metadata ─────────────────────────────────────────────────────────

export interface InstanceInfo {
  instance: string;
  openingTime: number;
  closingTime: number;
  minDuration: number;
  channelsCount: number;
  switchPenalty: number;
  terminationPenalty: number;
  channels: {
    channelId: number;
    channelName: string;
    programCount: number;
    programs?: {
      programId: string;
      start: number;
      end: number;
      genre: string;
      score: number;
    }[];
  }[];
  timePreferences: { start: number; end: number; preferredGenre: string; bonus: number }[];
  priorityBlocks: { start: number; end: number; allowedChannels: number[] }[];
}

export const AVAILABLE_OPERATORS = [
  { key: 'insert',        label: 'Insert',   icon: '＋', color: '#10b981', description: 'Fill empty gaps' },
  { key: 'replace',       label: 'Replace',  icon: '⟳',  color: '#7c6ff7', description: 'Swap with unscheduled' },
  { key: 'shift',         label: 'Shift',    icon: '⟵',  color: '#f59e0b', description: 'Move in time' },
  { key: 'swap',          label: 'Swap',     icon: '⇆',  color: '#ec4899', description: 'Exchange timeslots' },
  { key: 'shift_borders', label: 'Borders',  icon: '↔',  color: '#38bdf8', description: 'Resize duration' },
];

export const ALGORITHMS = [
  { key: 'hill_climbing_restarts', label: 'Hill Climbing + Restarts' },
  { key: 'hill_climbing',          label: 'Hill Climbing' },
  { key: 'ils',                    label: 'Iterated Local Search' },
];
