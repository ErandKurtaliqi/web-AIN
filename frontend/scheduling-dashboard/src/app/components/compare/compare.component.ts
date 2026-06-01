import { Component, OnDestroy, OnInit } from '@angular/core';
import { interval, Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../services/schedule.service';
import { SignalrService } from '../../services/signalr.service';
import {
  AVAILABLE_OPERATORS,
  CompareResult,
  ProgressPoint,
  RunRequest,
  ScheduleResult,
} from '../../models/schedule.models';

interface CompareConfig {
  label: string;
  operators: Set<string>;
  maxIterations: number;
  numRestarts: number;
  insertionInterval: number;
  maxShift: number;
  maxExecutionSeconds?: number;
}

interface CompareLiveRow {
  label: string;
  status: 'queued' | 'running' | 'done' | 'error';
  operators: string[];
  progress: ProgressPoint[];
  result?: ScheduleResult;
}

@Component({
  selector: 'app-compare',
  templateUrl: './compare.component.html',
  styleUrls: ['./compare.component.css'],
})
export class CompareComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private cancelRequested = false;

  instances: { name: string; file?: string }[] = [{ name: 'toy' }];
  selectedInstance = 'toy';
  isRunning = false;
  statusMessage = 'Ready';
  activeConfigIndex = -1;
  compareResult: CompareResult | null = null;
  liveRows: CompareLiveRow[] = [];

  readonly availableOperators = AVAILABLE_OPERATORS;

  configs: CompareConfig[] = [
    { label: 'Config A - All Operators', operators: new Set(['insert', 'replace', 'shift', 'swap', 'shift_borders']), maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10, maxExecutionSeconds: 30 },
    { label: 'Config B - No Insert', operators: new Set(['replace', 'swap', 'shift_borders']), maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10, maxExecutionSeconds: 30 },
    { label: 'Config C - Swap + Borders', operators: new Set(['swap', 'shift_borders']), maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10, maxExecutionSeconds: 30 },
  ];

  scoreBarOpts: any = {};
  timeBarOpts: any = {};
  conflBarOpts: any = {};
  radarOpts: any = {};
  progressLineOpts: any = {};
  compareCurveOpts: any = {};
  ambientTick = 0;

  constructor(
    private scheduleService: ScheduleService,
    public signalr: SignalrService,
  ) {}

  ngOnInit(): void {
    this.scheduleService.getInstances().pipe(takeUntil(this.destroy$)).subscribe(res => {
      this.instances = res.instances;
    });
    interval(650).pipe(takeUntil(this.destroy$)).subscribe(() => {
      const hasRealData = this.completedRows().length > 0 || this.liveRows.some(row => row.progress.length > 0);
      if (!hasRealData || this.isRunning) {
        this.ambientTick++;
        this.buildCharts();
      }
    });
    this.signalr.joinGroup(this.selectedInstance).catch(() => {});
    this.resetLiveRows();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  addConfig(): void {
    this.configs.push({
      label: `Config ${String.fromCharCode(65 + this.configs.length)}`,
      operators: new Set(['replace', 'swap', 'shift_borders']),
      maxIterations: 200,
      numRestarts: 3,
      insertionInterval: 50,
      maxShift: 10,
      maxExecutionSeconds: 30,
    });
    this.resetLiveRows();
  }

  removeConfig(i: number): void {
    if (this.configs.length > 2) {
      this.configs.splice(i, 1);
      this.resetLiveRows();
    }
  }

  onInstanceChange(): void {
    this.signalr.joinGroup(this.selectedInstance).catch(() => {});
    this.compareResult = null;
    this.statusMessage = 'Ready';
    this.resetLiveRows();
  }

  toggleOperatorInConfig(cfg: CompareConfig, key: string): void {
    cfg.operators.has(key) ? cfg.operators.delete(key) : cfg.operators.add(key);
    this.resetLiveRows();
  }

  isOpSelected(cfg: CompareConfig, key: string): boolean {
    return cfg.operators.has(key);
  }

  async runComparison(): Promise<void> {
    if (this.isRunning) return;
    if (this.configs.some(c => c.operators.size === 0)) {
      this.statusMessage = 'Select at least one operator in every config';
      return;
    }

    this.isRunning = true;
    this.cancelRequested = false;
    this.compareResult = null;
    this.activeConfigIndex = -1;
    this.resetLiveRows();
    this.buildCharts();

    await this.signalr.joinGroup(this.selectedInstance).catch(() => {});

    for (let i = 0; i < this.configs.length; i++) {
      if (this.cancelRequested) break;
      this.activeConfigIndex = i;
      this.liveRows[i].status = 'running';
      this.statusMessage = `Running ${this.configs[i].label} (${i + 1}/${this.configs.length})`;
      this.buildCharts();

      try {
        const result = await this.runSingleConfig(i, this.configs[i]);
        this.liveRows[i].status = 'done';
        this.liveRows[i].result = result;
        this.updateCompareResult();
        this.buildCharts();
      } catch (error: any) {
        this.liveRows[i].status = this.cancelRequested ? 'queued' : 'error';
        if (!this.cancelRequested) {
          this.statusMessage = 'Error: ' + (error?.error?.error ?? error?.message ?? error);
        }
        break;
      }
    }

    this.activeConfigIndex = -1;
    this.isRunning = false;
    if (this.cancelRequested) {
      this.statusMessage = 'Stopped';
    } else {
      const finalResult = this.compareResult as CompareResult | null;
      if (finalResult?.results.length) {
        this.statusMessage = `Done - Best: ${finalResult.bestLabel}`;
      }
    }
    this.buildCharts();
  }

  stopComparison(): void {
    if (!this.isRunning) return;
    this.cancelRequested = true;
    this.statusMessage = 'Stopping...';
    this.scheduleService.cancelRun(this.selectedInstance).pipe(takeUntil(this.destroy$)).subscribe({ error: () => {} });
  }

  isBest(result: ScheduleResult): boolean {
    return this.compareResult?.bestLabel === result.label;
  }

  completedRows(): CompareLiveRow[] {
    return this.liveRows.filter(row => row.result);
  }

  progressPercent(row: CompareLiveRow, index: number): number {
    if (row.status === 'done') return 100;
    if (row.status === 'queued' || row.progress.length === 0) return 0;
    const maxIterations = Math.max(1, this.configs[index]?.maxIterations ?? 1);
    const latest = row.progress[row.progress.length - 1];
    return Math.min(100, Math.round((latest.iteration / maxIterations) * 100));
  }

  private runSingleConfig(index: number, cfg: CompareConfig): Promise<ScheduleResult> {
    return new Promise((resolve, reject) => {
      const subscriptions = new Subscription();
      const cleanup = () => subscriptions.unsubscribe();

      subscriptions.add(this.signalr.progressUpdate$.subscribe(point => {
        this.liveRows[index].progress = [...this.liveRows[index].progress, point];
        this.buildCharts();
      }));

      subscriptions.add(this.signalr.scheduleUpdate$.subscribe(msg => {
        if (msg.status === 'completed' && msg.result) {
          cleanup();
          resolve({
            ...msg.result,
            label: cfg.label,
            operators: Array.from(cfg.operators),
            progressHistory: this.liveRows[index].progress.length ? this.liveRows[index].progress : msg.result.progressHistory,
          });
        } else if (msg.status === 'error' || msg.status === 'cancelled') {
          cleanup();
          reject(new Error(msg.message || msg.status));
        }
      }));

      const request: RunRequest = {
        instance: this.selectedInstance,
        algorithm: 'hill_climbing_restarts',
        operators: Array.from(cfg.operators),
        maxIterations: cfg.maxIterations,
        numRestarts: cfg.numRestarts,
        insertionInterval: cfg.insertionInterval,
        maxShift: cfg.maxShift,
        maxExecutionSeconds: cfg.maxExecutionSeconds ?? 30,
      };

      this.scheduleService.run(request).pipe(takeUntil(this.destroy$)).subscribe({
        error: err => {
          cleanup();
          reject(err);
        },
      });
    });
  }

  private resetLiveRows(): void {
    this.liveRows = this.configs.map(cfg => ({
      label: cfg.label,
      status: 'queued',
      operators: Array.from(cfg.operators),
      progress: [],
    }));
    this.buildCharts();
  }

  private updateCompareResult(): void {
    const results = this.completedRows().map(row => row.result!) as ScheduleResult[];
    if (!results.length) {
      this.compareResult = null;
      return;
    }

    const best = results.reduce((winner, current) => current.score > winner.score ? current : winner, results[0]);
    this.compareResult = {
      instance: this.selectedInstance,
      results,
      bestLabel: best.label ?? 'Best',
      bestScore: best.score,
    };
  }

  private buildCharts(): void {
    const finished = this.completedRows().map(row => row.result!) as ScheduleResult[];
    const palette = ['#2563eb', '#059669', '#d97706', '#db2777', '#0284c7', '#7c3aed'];
    const baseChart = {
      background: 'transparent',
      foreColor: '#64748b',
      toolbar: { show: false },
      animations: { enabled: true, easing: 'easeinout', speed: 350 },
    };
    const grid = { borderColor: '#e2e8f0', strokeDashArray: 4 };
    const labelStyle = { colors: '#64748b', fontSize: '11px', fontFamily: 'Inter, system-ui, sans-serif' };

    const ranked = [...finished].sort((a, b) => b.score - a.score);
    this.scoreBarOpts = {
      series: [{ name: 'Score', data: ranked.map(r => Math.round(r.score)) }],
      chart: { ...baseChart, type: 'bar', height: 320 },
      xaxis: { labels: { style: labelStyle } },
      yaxis: { labels: { style: labelStyle, maxWidth: 180 } },
      colors: palette,
      plotOptions: { bar: { horizontal: true, borderRadius: 6, distributed: true, barHeight: '54%' } },
      legend: { show: false },
      tooltip: { theme: 'light' },
      grid,
      dataLabels: { enabled: true, formatter: (v: number) => Math.round(v).toLocaleString(), style: { colors: ['#ffffff'], fontSize: '11px' } },
      xaxisCategories: ranked.map(r => r.label ?? ''),
    };
    this.scoreBarOpts.xaxis.categories = this.scoreBarOpts.xaxisCategories;

    this.timeBarOpts = {
      series: [{ name: 'Seconds', data: finished.map(r => +r.executionTime.toFixed(2)) }],
      chart: { ...baseChart, type: 'bar', height: 220 },
      xaxis: { categories: finished.map(r => r.label ?? ''), labels: { style: labelStyle, trim: true } },
      yaxis: { labels: { style: labelStyle } },
      colors: ['#d97706'],
      plotOptions: { bar: { borderRadius: 6, columnWidth: '42%' } },
      legend: { show: false },
      tooltip: { theme: 'light' },
      grid,
      dataLabels: { enabled: false },
    };

    this.conflBarOpts = {
      series: [{ name: 'Conflicts', data: finished.map(r => r.conflicts) }],
      chart: { ...baseChart, type: 'bar', height: 220 },
      xaxis: { categories: finished.map(r => r.label ?? ''), labels: { style: labelStyle, trim: true } },
      yaxis: { labels: { style: labelStyle } },
      colors: ['#e11d48'],
      plotOptions: { bar: { borderRadius: 6, columnWidth: '42%' } },
      legend: { show: false },
      tooltip: { theme: 'light' },
      grid,
      dataLabels: { enabled: false },
    };

    const maxScore = Math.max(...finished.map(r => r.score), 1);
    const maxImprovement = Math.max(...finished.map(r => Math.max(0, r.scoreImprovement)), 1);
    const maxTime = Math.max(...finished.map(r => r.executionTime), 1);
    this.radarOpts = {
      series: finished.map((r, i) => ({
        name: r.label ?? `Config ${i + 1}`,
        data: [
          Math.round((r.score / maxScore) * 100),
          Math.round((Math.max(0, r.scoreImprovement) / maxImprovement) * 100),
          Math.round(((maxTime - r.executionTime) / maxTime) * 100),
          Math.max(0, 100 - r.conflicts * 5),
        ],
      })),
      chart: { ...baseChart, type: 'radar', height: 300 },
      xaxis: { categories: ['Score', 'Gain', 'Speed', 'Clean'] },
      colors: palette,
      legend: { position: 'bottom', labels: { colors: '#475569' } },
      tooltip: { theme: 'light' },
      fill: { opacity: 0.16 },
      stroke: { width: 2 },
      markers: { size: 3 },
    };

    this.progressLineOpts = {
      series: this.liveRows
        .filter(row => row.progress.length)
        .map((row, i) => ({
          name: row.label,
          data: row.progress.map(p => ({
            x: p.iteration,
            y: Math.round(p.bestScore ?? p.currentScore ?? p.score),
          })),
          color: palette[i % palette.length],
        })),
      chart: { ...baseChart, type: 'line', height: 360, zoom: { enabled: false } },
      xaxis: { title: { text: 'Iteration' }, labels: { style: labelStyle } },
      yaxis: { title: { text: 'Best score' }, labels: { style: labelStyle } },
      colors: palette,
      stroke: { width: 3, curve: 'smooth' },
      markers: { size: 0, hover: { size: 5 } },
      grid,
      legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#475569' } },
      tooltip: { theme: 'light', shared: false, intersect: false },
      dataLabels: { enabled: false },
    };

    this.compareCurveOpts = this.buildUnifiedCurve(finished, palette, baseChart, grid, labelStyle);
  }

  private buildUnifiedCurve(
    finished: ScheduleResult[],
    palette: string[],
    baseChart: any,
    grid: any,
    labelStyle: any,
  ): any {
    const activeRow = this.activeConfigIndex >= 0 ? this.liveRows[this.activeConfigIndex] : null;
    const liveProgress = activeRow?.progress ?? [];
    const hasFinalMetrics = finished.length > 0;
    const hasLiveProgress = liveProgress.length > 0 && this.isRunning;

    if (hasLiveProgress && !hasFinalMetrics) {
      return {
        series: [
          {
            name: `${activeRow?.label ?? 'Active'} best score`,
            data: liveProgress.map(point => Math.round(point.bestScore ?? point.currentScore ?? point.score)),
          },
        ],
        chart: { ...baseChart, type: 'line', height: 430, zoom: { enabled: false } },
        xaxis: {
          categories: liveProgress.map(point => point.iteration),
          title: { text: 'X - Iteration' },
          labels: { style: labelStyle },
          tickAmount: 8,
        },
        yaxis: {
          title: { text: 'Y - Best score' },
          labels: { style: labelStyle },
        },
        colors: [palette[this.activeConfigIndex % palette.length] ?? palette[0]],
        stroke: { width: 4, curve: 'smooth' },
        markers: { size: 0, hover: { size: 6 } },
        grid,
        legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#475569' } },
        tooltip: { theme: 'light', shared: false, intersect: false },
        dataLabels: { enabled: false },
        annotations: this.axisAnnotations('Live optimization curve'),
      };
    }

    if (hasFinalMetrics) {
      const labels = finished.map(result => this.shortLabel(result.label ?? 'Config'));
      const maxScore = Math.max(...finished.map(result => result.score), 1);
      const maxTime = Math.max(...finished.map(result => result.executionTime), 1);
      const maxConflicts = Math.max(...finished.map(result => result.conflicts), 1);
      const maxImprovement = Math.max(...finished.map(result => Math.max(0, result.scoreImprovement)), 1);

      return {
        series: [
          {
            name: 'Score',
            data: finished.map(result => +((result.score / maxScore) * 100).toFixed(1)),
          },
          {
            name: 'Cleanliness',
            data: finished.map(result => +(100 - ((result.conflicts / maxConflicts) * 100)).toFixed(1)),
          },
          {
            name: 'Speed',
            data: finished.map(result => +((1 - (result.executionTime / maxTime)) * 100).toFixed(1)),
          },
          {
            name: 'Improvement',
            data: finished.map(result => +((Math.max(0, result.scoreImprovement) / maxImprovement) * 100).toFixed(1)),
          },
        ],
        chart: { ...baseChart, type: 'line', height: 430, zoom: { enabled: false } },
        xaxis: {
          categories: labels,
          title: { text: 'X - Configuration' },
          labels: { style: labelStyle, rotate: 0, trim: true },
        },
        yaxis: {
          min: 0,
          max: 105,
          tickAmount: 7,
          title: { text: 'Y - Normalized performance (%)' },
          labels: { style: labelStyle, formatter: (value: number) => `${Math.round(value)}%` },
        },
        colors: ['#2563eb', '#059669', '#d97706', '#7c3aed'],
        stroke: { width: [4, 4, 4, 3], curve: 'smooth' },
        markers: { size: 5, strokeWidth: 2, hover: { size: 7 } },
        grid,
        legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#475569' } },
        tooltip: {
          theme: 'light',
          shared: true,
          y: {
            formatter: (value: number, opts: any) => {
              const rawResult = finished[opts.dataPointIndex];
              if (opts.seriesIndex === 0) return `${value.toFixed(1)}%  | score ${Math.round(rawResult.score)}`;
              if (opts.seriesIndex === 1) return `${value.toFixed(1)}%  | conflicts ${rawResult.conflicts}`;
              if (opts.seriesIndex === 2) return `${value.toFixed(1)}%  | time ${rawResult.executionTime.toFixed(2)}s`;
              return `${value.toFixed(1)}%  | gain ${rawResult.scoreImprovement.toFixed(1)}`;
            },
          },
        },
        dataLabels: { enabled: false },
        annotations: this.axisAnnotations('Unified comparison curves'),
      };
    }

    return this.buildAmbientCurve(palette, baseChart, grid, labelStyle);
  }

  private buildAmbientCurve(palette: string[], baseChart: any, grid: any, labelStyle: any): any {
    const points = Array.from({ length: 44 }, (_, index) => index);
    const wave = (offset: number, lift: number, amplitude: number) =>
      points.map(x => +(lift + Math.sin((x + this.ambientTick + offset) / 4) * amplitude + Math.cos((x + offset) / 7) * 7).toFixed(1));

    return {
      series: [
        { name: 'Score signal', data: wave(0, 70, 18) },
        { name: 'Cleanliness signal', data: wave(9, 48, 16) },
        { name: 'Speed signal', data: points.map(x => +(58 + Math.cos((x + this.ambientTick) / 5) * 20).toFixed(1)) },
      ],
      chart: {
        ...baseChart,
        type: 'line',
        height: 430,
        zoom: { enabled: false },
        animations: { enabled: true, easing: 'linear', speed: 500, dynamicAnimation: { enabled: true, speed: 500 } },
      },
      xaxis: {
        categories: points,
        title: { text: 'X - Live preview timeline' },
        labels: { style: labelStyle },
        tickAmount: 8,
      },
      yaxis: {
        min: 0,
        max: 100,
        title: { text: 'Y - Visual activity (%)' },
        labels: { style: labelStyle, formatter: (value: number) => `${Math.round(value)}%` },
      },
      colors: [palette[0], palette[1], palette[2]],
      stroke: { width: 4, curve: 'smooth' },
      markers: { size: 0 },
      grid,
      legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#475569' } },
      tooltip: { theme: 'light', shared: true },
      dataLabels: { enabled: false },
      annotations: this.axisAnnotations('Waiting for real-time data'),
    };
  }

  private axisAnnotations(text: string): any {
    return {
      position: 'front',
      texts: [{
        x: 18,
        y: 28,
        text,
        textAnchor: 'start',
        foreColor: '#475569',
        fontSize: '12px',
        fontWeight: 700,
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderRadius: 6,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 4,
        paddingBottom: 4,
      }],
    };
  }

  private shortLabel(label: string): string {
    return label
      .replace('Config ', 'C')
      .replace(' - ', ' ')
      .replace('All Operators', 'All')
      .replace('No Insert', 'No Insert')
      .replace('Swap + Borders', 'Swap+Borders');
  }
}
