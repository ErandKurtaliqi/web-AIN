import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../services/schedule.service';
import { SignalrService } from '../../services/signalr.service';
import {
  ScheduleResult, ScheduledProgram, RunRequest,
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
  manuallyMoved?: boolean;
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

  instances: { name: string }[] = [];
  selectedInstance = 'toy';
  selectedAlgorithm = 'hill_climbing_restarts';
  selectedOperators: string[] = ['replace', 'swap', 'shift_borders'];

  params = { maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10 };

  isRunning = false;
  statusMessage = '';

  result: ScheduleResult | null = null;

  openingTime  = 540;   // fallback — 09:00
  closingTime  = 1080;  // fallback — 18:00
  channelIds: number[] = [];
  gridPrograms: Map<number, GridProgram[]> = new Map();

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

    this.signalr.scheduleUpdate$.pipe(takeUntil(this.destroy$)).subscribe(msg => {
      this.statusMessage = msg.message;
      if (msg.status === 'completed' && msg.result) {
        this.onResultReceived(msg.result);
        this.isRunning = false;
      }
      if (msg.status === 'error') this.isRunning = false;
    });

    this.signalr.joinGroup(this.selectedInstance);
    this.run();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  run(): void {
    if (this.isRunning) return;
    if (this.selectedOperators.length === 0) { this.statusMessage = 'Select at least one operator'; return; }
    this.isRunning = true;
    this.statusMessage = 'Running…';

    const request: RunRequest = {
      instance: this.selectedInstance,
      algorithm: this.selectedAlgorithm,
      operators: this.selectedOperators,
      ...this.params,
    };

    // POST returns 202; actual result arrives via SignalR
    this.scheduleService.run(request).pipe(takeUntil(this.destroy$)).subscribe({
      error: err => { this.statusMessage = 'Error: ' + (err.error?.error ?? err.message); this.isRunning = false; },
    });
  }

  onInstanceChange(): void {
    this.signalr.joinGroup(this.selectedInstance);
    this.result = null;
    this.channelIds = [];
    this.gridPrograms.clear();
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

    if (!result.scheduledPrograms?.length) return;

    this.channelIds = ([...new Set(result.scheduledPrograms.map((p: ScheduledProgram) => p.channelId))] as number[]).sort((a, b) => a - b);
    const range = this.closingTime - this.openingTime;

    this.gridPrograms.clear();
    for (const ch of this.channelIds) {
      const progs = result.scheduledPrograms
        .filter((p: ScheduledProgram) => p.channelId === ch)
        .map((p: ScheduledProgram) => this.toGridProgram(p, range));
      this.gridPrograms.set(ch, progs);
    }
  }

  private toGridProgram(p: ScheduledProgram, range: number): GridProgram {
    const leftPct  = ((p.start - this.openingTime) / range) * 100;
    const widthPct = ((p.end - p.start) / range) * 100;
    return {
      ...p,
      label:    p.programId,
      color:    this.programColor(p.programId),
      leftPct:  Math.max(0, leftPct),
      widthPct: Math.max(0.5, widthPct),
    };
  }

  private programColor(id: string): string {
    const genre = id.toLowerCase();
    for (const [key, color] of Object.entries(GENRE_COLORS)) {
      if (genre.includes(key)) return color;
    }
    return DEFAULT_COLOR;
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  timeLabel(minuteOffset: number): string {
    const total = this.openingTime + minuteOffset;
    const h = Math.floor(total / 60).toString().padStart(2, '0');
    const m = (total % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
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
}
