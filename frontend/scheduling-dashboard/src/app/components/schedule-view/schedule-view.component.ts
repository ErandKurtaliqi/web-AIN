import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../services/schedule.service';
import { SignalrService } from '../../services/signalr.service';
import {
  InstanceInfo, ScheduleResult, ScheduledProgram, RunRequest,
  AVAILABLE_OPERATORS, ALGORITHMS,
} from '../../models/schedule.models';

interface GridProgram {
  programId: string;
  channelId: number;
  start: number;
  end: number;
  label: string;
  color: string;
  leftPct: number;
  widthPct: number;
  leftPx: number;
  widthPx: number;
  lane: number;
  manuallyMoved?: boolean;
  channelName?: string;
  genre?: string;
  originalStart?: number;
  originalEnd?: number;
  originalScore?: number;
  startDelta?: number;
  endDelta?: number;
  bonusHit?: boolean;
  bonusValue?: number;
  bonusGenre?: string;
  timingIssue?: boolean;
  priorityViolation?: boolean;
  detailSubtitle?: string;
}

interface ProgramMeta {
  programId: string;
  channelId: number;
  channelName: string;
  start: number;
  end: number;
  genre: string;
  score: number;
}

interface AnalysisItem {
  title: string;
  value: string;
  tone: 'good' | 'warn' | 'danger' | 'info';
  detail: string;
}

const GENRE_COLORS: Record<string, string> = {
  news:          '#3b82f6',
  sports:        '#22c55e',
  entertainment: '#a855f7',
  drama:         '#f59e0b',
  movie:         '#ef4444',
  documentary:   '#06b6d4',
  kids:          '#ec4899',
  music:         '#84cc16',
};
const DEFAULT_COLOR = '#6366f1';

@Component({
  selector: 'app-schedule-view',
  templateUrl: './schedule-view.component.html',
  styleUrls: ['./schedule-view.component.css'],
})
export class ScheduleViewComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();
  private activeRunInstance: string | null = null;

  instances: { name: string }[] = [];
  selectedInstance = 'toy';
  selectedAlgorithm = 'hill_climbing_restarts';
  selectedOperators: string[] = ['replace', 'swap', 'shift_borders'];

  params = { maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10, maxExecutionSeconds: 30 };

  isRunning = false;
  statusMessage = '';

  result: ScheduleResult | null = null;
  instanceInfo: InstanceInfo | null = null;
  programMeta = new Map<string, ProgramMeta>();

  openingTime  = 540;   // fallback — 09:00
  closingTime  = 1080;  // fallback — 18:00
  channelIds: number[] = [];
  gridPrograms: Map<number, GridProgram[]> = new Map();
  bonusHits: GridProgram[] = [];
  timingIssues: GridProgram[] = [];
  priorityViolations: GridProgram[] = [];
  switchEvents: { from: number; to: number; at: number; penalty: number }[] = [];
  private channelLaneCounts = new Map<number, number>();
  readonly laneHeight = 58;
  readonly laneGap = 6;
  readonly trackPadding = 5;
  readonly minuteWidthPx = 8;
  readonly minProgramWidthPx = 172;
  readonly programGapPx = 8;
  readonly channelLabelWidthPx = 76;

  // Manual override tracking
  manualScore: number | null = null;
  manualConflicts: number | null = null;

  readonly availableOperators = AVAILABLE_OPERATORS;
  readonly algorithms = ALGORITHMS;

  constructor(
    private scheduleService: ScheduleService,
    public signalr: SignalrService,
  ) {}

  ngOnInit(): void {
    this.scheduleService.getInstances().pipe(takeUntil(this.destroy$)).subscribe(res => {
      this.instances = res.instances;
    });
    this.loadInstanceInfo();

    this.signalr.scheduleUpdate$.pipe(takeUntil(this.destroy$)).subscribe(msg => {
      this.statusMessage = msg.message;
      if (msg.status === 'completed' && msg.result) {
        this.onResultReceived(msg.result);
        this.isRunning = false;
        this.activeRunInstance = null;
      }
      if (msg.status === 'cancelled') {
        this.statusMessage = 'Stopped';
        this.isRunning = false;
        this.activeRunInstance = null;
      }
      if (msg.status === 'error') {
        this.isRunning = false;
        this.activeRunInstance = null;
      }
    });

    this.signalr.joinGroup(this.selectedInstance);
    this.run();
  }

  ngOnDestroy(): void {
    if (this.isRunning && this.activeRunInstance) {
      this.scheduleService.cancelRun(this.activeRunInstance).subscribe({ error: () => {} });
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  run(): void {
    if (this.isRunning) return;
    if (this.selectedOperators.length === 0) { this.statusMessage = 'Select at least one operator'; return; }
    this.isRunning = true;
    this.activeRunInstance = this.selectedInstance;
    this.statusMessage = 'Running…';

    const request: RunRequest = {
      instance: this.selectedInstance,
      algorithm: this.selectedAlgorithm,
      operators: this.selectedOperators,
      ...this.params,
    };

    // POST returns 202; actual result arrives via SignalR
    this.scheduleService.run(request).pipe(takeUntil(this.destroy$)).subscribe({
      error: err => {
        this.statusMessage = 'Error: ' + (err.error?.error ?? err.message);
        this.isRunning = false;
        this.activeRunInstance = null;
      },
    });
  }

  stop(): void {
    if (!this.isRunning) return;
    const instanceToStop = this.activeRunInstance ?? this.selectedInstance;
    this.scheduleService.cancelRun(instanceToStop)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ error: () => {} });
    this.statusMessage = 'Stopping...';
  }

  onInstanceChange(): void {
    const previousRunInstance = this.activeRunInstance;
    if (this.isRunning && previousRunInstance) {
      this.scheduleService.cancelRun(previousRunInstance)
        .pipe(takeUntil(this.destroy$))
        .subscribe({ error: () => {} });
    }

    this.isRunning = false;
    this.activeRunInstance = null;
    this.signalr.joinGroup(this.selectedInstance);
    this.result = null;
    this.channelIds = [];
    this.gridPrograms.clear();
    this.channelLaneCounts.clear();
    this.clearAnalysis();
    this.loadInstanceInfo();
  }

  toggleOperator(key: string): void {
    if (this.selectedOperators.includes(key)) {
      this.selectedOperators = this.selectedOperators.filter(k => k !== key);
    } else {
      this.selectedOperators = [...this.selectedOperators, key];
    }
  }

  // ── Manual override ────────────────────────────────────────────────────────

  onProgramManualMove(prog: GridProgram, event: { leftPct: number; widthPct: number }): void {
    prog.leftPct  = event.leftPct;
    prog.widthPct = event.widthPct;
    prog.manuallyMoved = true;
    this.computeManualMetrics();
  }

  private computeManualMetrics(): void {
    if (!this.result) return;
    // Re-calculate simple score delta for visual feedback
    let conflicts = 0;
    for (const [, programs] of this.gridPrograms) {
      const sorted = [...programs].sort((a, b) => a.leftPct - b.leftPct);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i - 1].leftPct + sorted[i - 1].widthPct > sorted[i].leftPct + 0.01) {
          conflicts++;
        }
      }
    }
    this.manualConflicts = conflicts;
  }

  // ── Result → grid ──────────────────────────────────────────────────────────

  private onResultReceived(result: ScheduleResult): void {
    this.result = result;
    this.statusMessage = `Score: ${result.score.toFixed(0)}`;
    this.manualScore = null;
    this.manualConflicts = null;
    this.clearAnalysis();

    if (!result.scheduledPrograms?.length) return;

    this.channelIds = ([...new Set(result.scheduledPrograms.map((p: ScheduledProgram) => p.channelId))] as number[]).sort((a, b) => a - b);
    const range = this.closingTime - this.openingTime;

    this.gridPrograms.clear();
    this.channelLaneCounts.clear();
    for (const ch of this.channelIds) {
      const progs = result.scheduledPrograms
        .filter((p: ScheduledProgram) => p.channelId === ch)
        .map((p: ScheduledProgram) => this.toGridProgram(p, range));
      this.placeProgramsInLanes(ch, progs);
      this.gridPrograms.set(ch, progs);
    }
    this.computeDetailedAnalysis(result.scheduledPrograms);
  }

  private toGridProgram(p: ScheduledProgram, range: number): GridProgram {
    const meta = this.programMeta.get(this.metaKey(p.channelId, p.programId));
    const leftPct  = ((p.start - this.openingTime) / range) * 100;
    const widthPct = ((p.end - p.start) / range) * 100;
    const leftPx = Math.max(0, (p.start - this.openingTime) * this.minuteWidthPx);
    const durationWidthPx = Math.max(1, (p.end - p.start) * this.minuteWidthPx);
    const readableWidthPx = Math.max(this.minProgramWidthPx, p.programId.length * 8 + 34);
    const startDelta = meta ? p.start - meta.start : 0;
    const endDelta = meta ? p.end - meta.end : 0;
    return {
      ...p,
      label:    p.programId,
      color:    this.programColor(meta?.genre ?? p.programId),
      leftPct:  Math.max(0, leftPct),
      widthPct: Math.max(0.5, widthPct),
      leftPx,
      widthPx: Math.max(readableWidthPx, durationWidthPx),
      lane: 0,
      channelName: meta?.channelName,
      genre: meta?.genre,
      originalStart: meta?.start,
      originalEnd: meta?.end,
      originalScore: meta?.score,
      startDelta,
      endDelta,
      timingIssue: startDelta > 0 || endDelta < 0,
      detailSubtitle: meta
        ? `${meta.genre} | score ${meta.score} | original ${this.minuteLabel(meta.start)}-${this.minuteLabel(meta.end)}`
        : 'No original metadata found',
    };
  }

  private programColor(id: string): string {
    const genre = id.toLowerCase();
    for (const [key, color] of Object.entries(GENRE_COLORS)) {
      if (genre.includes(key)) return color;
    }
    return DEFAULT_COLOR;
  }

  private placeProgramsInLanes(channelId: number, programs: GridProgram[]): void {
    let nextFreeLeftPx = 0;

    for (const prog of [...programs].sort((a, b) => a.leftPx - b.leftPx || a.start - b.start)) {
      prog.leftPx = Math.max(prog.leftPx, nextFreeLeftPx);
      prog.lane = 0;
      nextFreeLeftPx = prog.leftPx + prog.widthPx + this.programGapPx;
    }

    this.channelLaneCounts.set(channelId, 1);
  }

  private loadInstanceInfo(): void {
    this.scheduleService.getInstanceInfo(this.selectedInstance)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: info => {
          this.instanceInfo = info;
          this.openingTime = info.openingTime;
          this.closingTime = info.closingTime;
          this.rebuildProgramMeta(info);
          if (this.result?.scheduledPrograms?.length) this.onResultReceived(this.result);
        },
        error: () => {},
      });
  }

  private rebuildProgramMeta(info: InstanceInfo): void {
    this.programMeta.clear();
    for (const channel of info.channels) {
      for (const program of channel.programs ?? []) {
        this.programMeta.set(this.metaKey(channel.channelId, program.programId), {
          ...program,
          channelId: channel.channelId,
          channelName: channel.channelName,
        });
      }
    }
  }

  private computeDetailedAnalysis(schedule: ScheduledProgram[]): void {
    const allPrograms = [...this.gridPrograms.values()].flat();

    for (const prog of allPrograms) {
      const bonus = this.matchingBonus(prog);
      if (bonus) {
        prog.bonusHit = true;
        prog.bonusValue = bonus.bonus;
        prog.bonusGenre = bonus.preferredGenre;
        this.bonusHits.push(prog);
      }

      prog.priorityViolation = this.hasPriorityViolation(prog);
      if (prog.priorityViolation) this.priorityViolations.push(prog);
      if (prog.timingIssue) this.timingIssues.push(prog);
    }

    for (let i = 1; i < schedule.length; i++) {
      const previous = schedule[i - 1];
      const current = schedule[i];
      if (previous.channelId !== current.channelId) {
        this.switchEvents.push({
          from: previous.channelId,
          to: current.channelId,
          at: current.start,
          penalty: this.instanceInfo?.switchPenalty ?? 0,
        });
      }
    }
  }

  private matchingBonus(prog: GridProgram): { preferredGenre: string; bonus: number } | null {
    if (!this.instanceInfo || !prog.genre) return null;
    for (const pref of this.instanceInfo.timePreferences) {
      if (pref.preferredGenre !== prog.genre) continue;
      const overlap = Math.max(0, Math.min(prog.end, pref.end) - Math.max(prog.start, pref.start));
      if (overlap >= this.instanceInfo.minDuration) return pref;
    }
    return null;
  }

  private hasPriorityViolation(prog: GridProgram): boolean {
    if (!this.instanceInfo) return false;
    return this.instanceInfo.priorityBlocks.some(block => {
      const overlaps = Math.max(0, Math.min(prog.end, block.end) - Math.max(prog.start, block.start)) > 0;
      return overlaps && !block.allowedChannels.includes(prog.channelId);
    });
  }

  private clearAnalysis(): void {
    this.bonusHits = [];
    this.timingIssues = [];
    this.priorityViolations = [];
    this.switchEvents = [];
  }

  private metaKey(channelId: number, programId: string): string {
    return `${channelId}|${programId}`;
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  timeLabel(minuteOffset: number): string {
    const total = this.openingTime + minuteOffset;
    return this.minuteLabel(total);
  }

  minuteLabel(total: number): string {
    const h = Math.floor(total / 60).toString().padStart(2, '0');
    const m = (total % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  deltaLabel(delta = 0): string {
    if (delta === 0) return 'on time';
    const abs = Math.abs(delta);
    return delta > 0 ? `${abs}m later` : `${abs}m earlier`;
  }

  get timeMarkers(): number[] {
    const range = this.closingTime - this.openingTime;
    const step  = range > 300 ? 120 : 60;
    const marks: number[] = [];
    for (let t = 0; t <= range; t += step) marks.push(t);
    return marks;
  }

  programsForChannel(ch: number): GridProgram[] {
    return this.gridPrograms.get(ch) ?? [];
  }

  get trackWidthPx(): number {
    const baseWidth = Math.max(1200, (this.closingTime - this.openingTime) * this.minuteWidthPx);
    const programRightEdge = [...this.gridPrograms.values()]
      .flat()
      .reduce((rightEdge, prog) => Math.max(rightEdge, prog.leftPx + prog.widthPx + this.programGapPx), 0);
    return Math.max(baseWidth, programRightEdge + 24);
  }

  get timelineWidthPx(): number {
    return this.channelLabelWidthPx + this.trackWidthPx;
  }

  markerLeftPx(minuteOffset: number): number {
    return minuteOffset * this.minuteWidthPx;
  }

  trackHeight(ch: number): number {
    return this.trackPadding * 2 + this.channelLaneCount(ch) * this.laneHeight + (this.channelLaneCount(ch) - 1) * this.laneGap;
  }

  programTop(prog: GridProgram): number {
    return this.trackPadding + prog.lane * (this.laneHeight + this.laneGap);
  }

  private channelLaneCount(ch: number): number {
    return this.channelLaneCounts.get(ch) ?? 1;
  }

  channelName(ch: number): string {
    return this.instanceInfo?.channels.find(c => c.channelId === ch)?.channelName ?? `CH ${ch}`;
  }

  get penaltyCards(): AnalysisItem[] {
    const pb = this.result?.penaltyBreakdown;
    if (!pb) return [];
    return [
      { title: 'Base score', value: Math.round(pb.baseScore).toLocaleString(), tone: 'info', detail: 'Raw score from selected programs before bonuses and penalties.' },
      { title: 'Bonus earned', value: `+${Math.round(pb.bonusEarned).toLocaleString()}`, tone: 'good', detail: `${this.bonusHits.length} programs matched preferred genre windows.` },
      { title: 'Channel switches', value: `${pb.channelSwitches}`, tone: pb.channelSwitches ? 'warn' : 'good', detail: `Penalty total: -${Math.round(pb.switchPenaltyTotal).toLocaleString()}` },
      { title: 'Timing violations', value: `${pb.timingViolations}`, tone: pb.timingViolations ? 'danger' : 'good', detail: `Penalty total: -${Math.round(pb.timingPenaltyTotal).toLocaleString()}` },
      { title: 'Priority violations', value: `${this.priorityViolations.length}`, tone: this.priorityViolations.length ? 'danger' : 'good', detail: 'Programs placed in blocked channel/time zones.' },
      { title: 'Final score', value: Math.round(pb.finalScore).toLocaleString(), tone: 'info', detail: 'Final evaluated solution score.' },
    ];
  }

  get topBonusHits(): GridProgram[] {
    return [...this.bonusHits].sort((a, b) => (b.bonusValue ?? 0) - (a.bonusValue ?? 0)).slice(0, 8);
  }

  get topTimingIssues(): GridProgram[] {
    return [...this.timingIssues]
      .sort((a, b) => Math.abs((b.startDelta ?? 0) + (b.endDelta ?? 0)) - Math.abs((a.startDelta ?? 0) + (a.endDelta ?? 0)))
      .slice(0, 8);
  }

  get visibleSwitchEvents(): { from: number; to: number; at: number; penalty: number }[] {
    return this.switchEvents.slice(0, 8);
  }
}
