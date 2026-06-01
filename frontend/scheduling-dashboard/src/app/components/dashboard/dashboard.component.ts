import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../services/schedule.service';
import { SignalrService } from '../../services/signalr.service';
import {
  ProgressPoint, ScheduleResult, RunRequest, AVAILABLE_OPERATORS, ALGORITHMS
} from '../../models/schedule.models';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  // ── State ──────────────────────────────────────────────────────────────────
  instances: { name: string; file: string }[] = [];
  selectedInstance = 'toy';
  selectedAlgorithm = 'hill_climbing_restarts';
  selectedOperators: string[] = ['replace', 'swap', 'shift_borders'];
  params = {
    maxIterations: 200,
    numRestarts: 3,
    insertionInterval: 50,
    maxShift: 10,
    maxExecutionSeconds: 30,
  };

  isRunning = false;
  statusMessage = 'Ready - press Run to start';

  result: ScheduleResult | null = null;
  previousResult: ScheduleResult | null = null;

  /** Live progress points accumulate while the algorithm is running */
  livePoints: ProgressPoint[] = [];

  /** Elapsed seconds (ticking while isRunning) */
  elapsedSeconds = 0;
  private timerStart = 0;

  readonly availableOperators = AVAILABLE_OPERATORS;
  readonly algorithms = ALGORITHMS;

  constructor(
    private scheduleService: ScheduleService,
    public signalr: SignalrService,
  ) {}

  ngOnInit(): void {
    this.loadInstances();

    // Live progress → accumulate points
    this.signalr.progressUpdate$.pipe(takeUntil(this.destroy$)).subscribe(point => {
      this.livePoints = [...this.livePoints, point];
    });

    // Final result / status
    this.signalr.scheduleUpdate$.pipe(takeUntil(this.destroy$)).subscribe(msg => {
      if (msg.status === 'running') {
        this.statusMessage = 'Running...';
      } else if (msg.status === 'completed' && msg.result) {
        this.onResultReceived(msg.result);
        this.isRunning = false;
      } else if (msg.status === 'cancelled') {
        this.statusMessage = 'Stopped';
        this.isRunning = false;
      } else if (msg.status === 'error') {
        this.statusMessage = 'Error: ' + msg.message;
        this.isRunning = false;
      }
    });

    // Elapsed timer — ticks every 100 ms while running
    interval(100).pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.isRunning) {
        this.elapsedSeconds = (Date.now() - this.timerStart) / 1000;
      }
    });

    this.signalr.joinGroup(this.selectedInstance).catch(() => {});
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadInstances(): void {
    this.scheduleService.getInstances()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.instances = res.instances ?? [];
          if (this.instances.length === 0) {
            this.statusMessage = 'No instances found in data/input — check Python API (port 8000)';
            return;
          }
          if (!this.instances.some(i => i.name === this.selectedInstance)) {
            this.selectedInstance = this.instances[0].name;
          }
          this.statusMessage = 'Ready - press Run to start';
        },
        error: () => {
          this.instances = [];
          this.statusMessage =
            'Cannot load instances — start Python API (:8000) then .NET backend (:5000). Use http://localhost:4200';
        },
      });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  toggleOperator(key: string): void {
    if (this.selectedOperators.includes(key)) {
      this.selectedOperators = this.selectedOperators.filter(k => k !== key);
    } else {
      this.selectedOperators = [...this.selectedOperators, key];
    }
    // No auto-run — only the Run button triggers execution
  }

  onInstanceChange(): void {
    this.signalr.joinGroup(this.selectedInstance).catch(() => {});
    this.result = null;
    this.previousResult = null;
    this.livePoints = [];
    this.statusMessage = 'Ready - press Run to start';
  }

  runAlgorithm(): void {
    if (this.isRunning) return;
    if (this.selectedOperators.length === 0) {
      this.statusMessage = 'Select at least one operator';
      return;
    }

    this.isRunning = true;
    this.livePoints = [];
    this.elapsedSeconds = 0;
    this.timerStart = Date.now();
    this.statusMessage = 'Running...';

    const request: RunRequest = {
      instance: this.selectedInstance,
      algorithm: this.selectedAlgorithm,
      operators: this.selectedOperators,
      ...this.params,
    };

    // POST returns 202; the real results arrive via SignalR
    this.scheduleService.run(request).pipe(takeUntil(this.destroy$)).subscribe({
      error: err => {
        this.statusMessage = 'Error: ' + (err.error?.error ?? err.message ?? 'Could not reach server');
        this.isRunning = false;
      },
    });
  }

  stopAlgorithm(): void {
    if (!this.isRunning) return;
    this.scheduleService.cancelRun(this.selectedInstance)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ error: () => {} });
    this.statusMessage = 'Stopping...';
  }

  private onResultReceived(result: ScheduleResult): void {
    this.previousResult = this.result;
    this.result = result;
    this.elapsedSeconds = result.executionTime;
    this.statusMessage = `Done - Score: ${result.score.toFixed(0)} - ${this.formatDuration(result.executionTime)}`;
  }

  downloadResultJson(): void {
    if (!this.result) return;
    const payload = {
      downloadedAt: new Date().toISOString(),
      parameters: {
        instance: this.selectedInstance,
        algorithm: this.selectedAlgorithm,
        operators: this.selectedOperators,
        ...this.params,
      },
      result: this.result,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.selectedInstance}_${this.selectedAlgorithm}_${Math.round(this.result.score)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  formatDuration(seconds: number): string {
    if (!seconds || seconds < 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${Math.floor(s)}s`;
    if (m > 0) return `${m}m ${s.toFixed(1)}s`;
    return `${s.toFixed(1)}s`;
  }

  // ── Template getters ──────────────────────────────────────────────────────
  get improvement(): number | null {
    if (!this.result || !this.previousResult) return null;
    return this.result.score - this.previousResult.score;
  }
  get bestScore(): number     { return this.result?.score ?? 0; }
  get conflicts(): number     { return this.result?.conflicts ?? 0; }
  get activeOpCount(): number { return this.selectedOperators.length; }
  isOpSelected(key: string): boolean { return this.selectedOperators.includes(key); }

  opCalls(key: string): number    { return this.result?.operatorStats?.[key]?.calls ?? 0; }
  opDelta(key: string): string    { return (this.result?.operatorStats?.[key]?.scoreDelta ?? 0).toFixed(0); }
  opImprPct(key: string): number  {
    const s = this.result?.operatorStats?.[key];
    if (!s || s.calls === 0) return 0;
    return (s.improvements / s.calls) * 100;
  }

}

