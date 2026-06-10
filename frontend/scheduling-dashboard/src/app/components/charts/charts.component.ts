import {
  Component, Input, OnChanges, OnInit, SimpleChanges, ViewChild
} from '@angular/core';
import { ChartComponent } from 'ng-apexcharts';
import { ProgressPoint, ScheduleResult } from '../../models/schedule.models';

const LABEL = '#94a3b8';
const GRID = '#e2e8f0';
const INDIGO = '#6366f1';
const GREEN = '#10b981';
const RED = '#ef4444';

type Pt = [number, number];

@Component({
  selector: 'app-charts',
  templateUrl: './charts.component.html',
  styleUrls: ['./charts.component.css'],
})
export class ChartsComponent implements OnInit, OnChanges {

  @ViewChild('scoreChart') chartRef?: ChartComponent;

  @Input() result: ScheduleResult | null = null;
  @Input() previousResult: ScheduleResult | null = null;
  @Input() livePoints: ProgressPoint[] = [];
  @Input() isRunning = false;
  @Input() elapsedSeconds = 0;
  @Input() timeBudgetSeconds = 30;
  @Input() formatDuration: (s: number) => string = s => `${s.toFixed(1)}s`;

  scoreOpts: any = {};
  hasData = false;
  isLive = false;

  ngOnInit(): void {
    this.scoreOpts = this.buildOpts(this.toSeries([]), true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['result'] || changes['livePoints'] || changes['isRunning'])
      && !this.result
      && this.livePoints.length === 0) {
      this.resetChart(this.isRunning);
    }

    if (changes['livePoints'] && this.isRunning && this.livePoints.length >= 2) {
      const series = this.toSeries(this.livePoints);
      this.isLive = true;
      this.hasData = true;

      if (this.chartRef) {
        this.chartRef.updateSeries(series, false);
        if (this.livePoints.length === 2) {
          this.chartRef.updateOptions({ colors: [RED, GREEN] }, false, false);
        }
      } else {
        this.scoreOpts = this.buildOpts(series, true);
      }
    }

    if (changes['result'] && this.result) {
      const pts = this.result.progressHistory?.length
        ? this.result.progressHistory
        : this.livePoints;
      const series = this.toSeries(pts);
      this.hasData = series[0].data.length >= 2;
      this.isLive = false;

      if (this.hasData) {
        if (this.chartRef) {
          this.chartRef.updateOptions({ colors: [RED, INDIGO] }, false, false);
          this.chartRef.updateSeries(series, true);
        } else {
          this.scoreOpts = this.buildOpts(series, false);
        }
      }
    }

    if (changes['isRunning'] && !this.isRunning) {
      this.isLive = false;
      if (this.chartRef && this.hasData) {
        this.chartRef.updateOptions({ colors: [RED, INDIGO] }, false, false);
      }
    }
  }

  private toSeries(pts: ProgressPoint[]): { name: string; data: Pt[] }[] {
    const current = pts.map(p => [p.iteration, Math.round(p.currentScore ?? p.score)] as Pt);
    const best = pts.map(p => [p.iteration, Math.round(p.bestScore ?? p.score)] as Pt);
    return [
      { name: 'Current solution', data: current },
      { name: 'Best solution', data: best },
    ];
  }

  private resetChart(live: boolean): void {
    this.hasData = false;
    this.isLive = false;
    const series = this.toSeries([]);

    if (this.chartRef) {
      this.chartRef.updateOptions({ colors: [RED, live ? GREEN : INDIGO] }, false, false);
      this.chartRef.updateSeries(series, false);
    } else {
      this.scoreOpts = this.buildOpts(series, live);
    }
  }

  private buildOpts(series: { name: string; data: Pt[] }[], live: boolean): any {
    return {
      series,
      chart: {
        type: 'line',
        height: 230,
        background: '#fff',
        foreColor: LABEL,
        toolbar: { show: false },
        fontFamily: 'Inter, system-ui, sans-serif',
        animations: {
          enabled: true,
          speed: 400,
          animateGradually: { enabled: false },
          dynamicAnimation: { enabled: true, speed: 250 },
        },
      },
      colors: [RED, live ? GREEN : INDIGO],
      stroke: { curve: ['straight', 'smooth'], width: [2, 3] },
      fill: { type: 'solid', opacity: 1 },
      legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'left',
        fontSize: '11px',
        labels: { colors: LABEL },
        markers: { width: 8, height: 8, radius: 8 },
      },
      xaxis: {
        type: 'numeric',
        labels: { style: { colors: LABEL, fontSize: '11px' } },
        axisBorder: { color: GRID },
        axisTicks: { color: GRID },
        title: { text: 'Iteration', style: { color: LABEL, fontSize: '11px', fontWeight: 500 } },
      },
      yaxis: {
        labels: { style: { colors: LABEL, fontSize: '11px' } },
        title: { text: 'Score', style: { color: LABEL, fontSize: '11px', fontWeight: 500 } },
      },
      grid: { borderColor: GRID, strokeDashArray: 4, padding: { right: 8 } },
      tooltip: {
        theme: 'light',
        style: { fontSize: '12px', fontFamily: 'Inter, system-ui' },
        x: { formatter: (v: number) => `Iteration ${v}` },
        y: { formatter: (v: number) => v.toLocaleString() },
      },
      markers: { size: 0, hover: { size: 5 } },
      dataLabels: { enabled: false },
    };
  }

  get currentScore(): number {
    if (this.isRunning && this.livePoints.length > 0) {
      const last = this.livePoints[this.livePoints.length - 1];
      return Math.round(last.bestScore ?? last.score);
    }
    return this.result?.score ? Math.round(this.result.score) : 0;
  }

  get timePct(): number {
    const t = this.isRunning ? this.elapsedSeconds : (this.result?.executionTime ?? 0);
    return Math.min(100, (t / Math.max(1, this.timeBudgetSeconds)) * 100);
  }

  get timeColor(): string {
    const t = this.isRunning ? this.elapsedSeconds : (this.result?.executionTime ?? 0);
    if (t < this.timeBudgetSeconds * 0.35) return '#059669';
    if (t < this.timeBudgetSeconds * 0.75) return '#d97706';
    return '#e11d48';
  }

  get timeDelta(): number | null {
    if (!this.result || !this.previousResult) return null;
    return +(this.result.executionTime - this.previousResult.executionTime).toFixed(2);
  }

  get scoreDelta(): number | null {
    if (!this.result || !this.previousResult) return null;
    return +(this.result.score - this.previousResult.score).toFixed(0);
  }
}
