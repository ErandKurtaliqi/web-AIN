import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../services/schedule.service';
import { CompareRequest, CompareResult, ScheduleResult, AVAILABLE_OPERATORS } from '../../models/schedule.models';

interface CompareConfig {
  label: string;
  operators: Set<string>;
  maxIterations: number;
  numRestarts: number;
  insertionInterval: number;
  maxShift: number;
}

@Component({
  selector: 'app-compare',
  templateUrl: './compare.component.html',
  styleUrls: ['./compare.component.css'],
})
export class CompareComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  instances: { name: string }[] = [];
  selectedInstance = 'toy';
  isRunning = false;
  statusMessage = '';
  compareResult: CompareResult | null = null;

  readonly availableOperators = AVAILABLE_OPERATORS;

  configs: CompareConfig[] = [
    { label: 'Config A – All Operators',    operators: new Set(['insert', 'replace', 'shift', 'swap', 'shift_borders']), maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10 },
    { label: 'Config B – No Insert',        operators: new Set(['replace', 'swap', 'shift_borders']),                    maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10 },
    { label: 'Config C – Swap + Borders',   operators: new Set(['swap', 'shift_borders']),                               maxIterations: 200, numRestarts: 3, insertionInterval: 50, maxShift: 10 },
  ];

  // Charts
  scoreBarOpts: any  = {};
  timeBarOpts: any   = {};
  conflBarOpts: any  = {};
  radarOpts: any     = {};

  constructor(private scheduleService: ScheduleService) {}

  ngOnInit(): void {
    this.scheduleService.getInstances().pipe(takeUntil(this.destroy$)).subscribe(res => {
      this.instances = res.instances;
    });
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
    });
  }

  removeConfig(i: number): void {
    if (this.configs.length > 2) this.configs.splice(i, 1);
  }

  toggleOperatorInConfig(cfg: CompareConfig, key: string): void {
    cfg.operators.has(key) ? cfg.operators.delete(key) : cfg.operators.add(key);
  }

  isOpSelected(cfg: CompareConfig, key: string): boolean {
    return cfg.operators.has(key);
  }

  runComparison(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.statusMessage = 'Running comparison…';
    this.compareResult = null;

    const request: CompareRequest = {
      instance: this.selectedInstance,
      configurations: this.configs.map(c => ({
        label: c.label,
        operators: Array.from(c.operators),
        maxIterations: c.maxIterations,
        numRestarts: c.numRestarts,
        insertionInterval: c.insertionInterval,
        maxShift: c.maxShift,
      })),
    };

    this.scheduleService.compare(request).pipe(takeUntil(this.destroy$)).subscribe({
      next: res  => { this.compareResult = res; this.buildCharts(res); this.isRunning = false; this.statusMessage = 'Done.'; },
      error: err => { this.statusMessage = 'Error: ' + (err.error?.error ?? err.message); this.isRunning = false; },
    });
  }

  private buildCharts(result: CompareResult): void {
    const labels = result.results.map(r => r.label ?? '');
    const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8'];

    const darkGrid  = { borderColor: '#334155', strokeDashArray: 4 };
    const darkChart = { background: 'transparent', foreColor: '#94a3b8' };
    const darkAxis  = { labels: { style: { colors: '#94a3b8', fontSize: '11px' } } };

    // Score bar
    this.scoreBarOpts = {
      series: [{ name: 'Final Score', data: result.results.map(r => Math.round(r.score)) }],
      chart: { ...darkChart, type: 'bar', height: 260, toolbar: { show: false } },
      xaxis: { categories: labels, ...darkAxis },
      yaxis: darkAxis,
      colors: colors,
      plotOptions: { bar: { borderRadius: 5, distributed: true } },
      legend: { show: false },
      tooltip: { theme: 'dark' },
      grid: darkGrid,
      dataLabels: { enabled: true, style: { colors: ['#fff'], fontSize: '12px' } },
    };

    // Execution time bar
    this.timeBarOpts = {
      series: [{ name: 'Exec Time (s)', data: result.results.map(r => r.executionTime) }],
      chart: { ...darkChart, type: 'bar', height: 260, toolbar: { show: false } },
      xaxis: { categories: labels, ...darkAxis },
      yaxis: darkAxis,
      colors: ['#f59e0b'],
      plotOptions: { bar: { borderRadius: 5, distributed: true } },
      legend: { show: false },
      tooltip: { theme: 'dark' },
      grid: darkGrid,
      dataLabels: { enabled: true, style: { colors: ['#fff'] } },
    };

    // Conflicts bar
    this.conflBarOpts = {
      series: [{ name: 'Conflicts', data: result.results.map(r => r.conflicts) }],
      chart: { ...darkChart, type: 'bar', height: 260, toolbar: { show: false } },
      xaxis: { categories: labels, ...darkAxis },
      yaxis: darkAxis,
      colors: ['#ef4444'],
      plotOptions: { bar: { borderRadius: 5, distributed: true } },
      legend: { show: false },
      tooltip: { theme: 'dark' },
      grid: darkGrid,
      dataLabels: { enabled: true, style: { colors: ['#fff'] } },
    };

    // Radar: score / improvement / 1/(time+1) per config
    const maxScore = Math.max(...result.results.map(r => r.score)) || 1;
    const maxImprv = Math.max(...result.results.map(r => r.scoreImprovement)) || 1;
    const maxTime  = Math.max(...result.results.map(r => r.executionTime)) || 1;

    this.radarOpts = {
      series: result.results.map((r, i) => ({
        name: r.label ?? `C${i}`,
        data: [
          Math.round((r.score / maxScore) * 100),
          Math.round(((r.scoreImprovement / maxImprv) || 0) * 100),
          Math.round(((maxTime - r.executionTime) / maxTime) * 100),
          Math.max(0, 100 - r.conflicts * 5),
        ],
      })),
      chart: { ...darkChart, type: 'radar', height: 300, toolbar: { show: false } },
      xaxis: { categories: ['Score', 'Improvement', 'Speed', 'Clean'] },
      colors: colors,
      legend: { labels: { colors: '#94a3b8' } },
      tooltip: { theme: 'dark' },
      fill: { opacity: .2 },
      stroke: { width: 2 },
      markers: { size: 4 },
    };
  }

  isBest(result: ScheduleResult): boolean {
    return this.compareResult?.bestLabel === result.label;
  }
}
