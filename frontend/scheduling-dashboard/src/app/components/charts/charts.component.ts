import {
  Component, Input, OnChanges, OnInit, SimpleChanges, ViewChild, AfterViewInit
} from '@angular/core';
import { ChartComponent } from 'ng-apexcharts';
import { ScheduleResult } from '../../models/schedule.models';

const LABEL   = '#94a3b8';
const GRID    = '#e2e8f0';
const INDIGO  = '#6366f1';
const GREEN   = '#10b981';

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
  @Input() livePoints: { iteration: number; score: number }[] = [];
  @Input() isRunning = false;
  @Input() elapsedSeconds = 0;
  @Input() formatDuration: (s: number) => string = s => `${s.toFixed(1)}s`;

  // The chart always exists in DOM — we use CSS to show/hide the placeholder
  scoreOpts: any = {};
  hasData = false;
  isLive  = false;   // true while receiving live updates

  ngOnInit(): void {
    this.scoreOpts = this.buildOpts([], true);
  }

  ngOnChanges(changes: SimpleChanges): void {

    // ── Live points arriving while running ──────────────────────────────────
    if (changes['livePoints'] && this.isRunning && this.livePoints.length >= 2) {
      const data = this.toData(this.livePoints);
      this.isLive  = true;
      this.hasData = true;

      if (this.chartRef) {
        // Smooth incremental append — no full rebuild
        this.chartRef.updateSeries([{ name: 'Score', data }], false);
        // Switch colour to green on first live point
        if (this.livePoints.length === 2) {
          this.chartRef.updateOptions({ colors: [GREEN] }, false, false);
        }
      } else {
        // Chart not yet mounted — set options directly
        this.scoreOpts = this.buildOpts(data, true);
      }
    }

    // ── Final result received ────────────────────────────────────────────────
    if (changes['result'] && this.result) {
      const pts = this.result.progressHistory?.length
        ? this.result.progressHistory
        : this.livePoints;
      const data = this.toData(pts);
      this.hasData = data.length >= 2;
      this.isLive  = false;

      if (this.hasData) {
        if (this.chartRef) {
          this.chartRef.updateOptions({ colors: [INDIGO] }, false, false);
          this.chartRef.updateSeries([{ name: 'Score', data }], true);
        } else {
          this.scoreOpts = this.buildOpts(data, false);
        }
      }
    }

    // ── When run stops with no result (cancelled early) ─────────────────────
    if (changes['isRunning'] && !this.isRunning) {
      this.isLive = false;
      if (this.chartRef && this.hasData) {
        this.chartRef.updateOptions({ colors: [INDIGO] }, false, false);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toData(pts: { iteration: number; score: number }[]): Pt[] {
    return pts.map(p => [p.iteration, Math.round(p.score)] as Pt);
  }

  private buildOpts(data: Pt[], live: boolean): any {
    return {
      series: [{ name: 'Score', data }],
      chart: {
        type: 'area',
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
      colors: [live ? GREEN : INDIGO],
      stroke: { curve: 'smooth', width: 2.5 },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.2, opacityTo: 0.02, stops: [0, 100] },
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

  // ── Display helpers ──────────────────────────────────────────────────────

  get currentScore(): number {
    if (this.isRunning && this.livePoints.length > 0) {
      return Math.round(this.livePoints[this.livePoints.length - 1].score);
    }
    return this.result?.score ? Math.round(this.result.score) : 0;
  }

  get timePct(): number {
    const t = this.isRunning ? this.elapsedSeconds : (this.result?.executionTime ?? 0);
    return Math.min(100, (t / 30) * 100);
  }

  get timeColor(): string {
    const t = this.isRunning ? this.elapsedSeconds : (this.result?.executionTime ?? 0);
    if (t < 5)  return '#059669';
    if (t < 15) return '#d97706';
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
