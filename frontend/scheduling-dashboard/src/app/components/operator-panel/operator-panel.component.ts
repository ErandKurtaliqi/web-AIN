import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-operator-panel',
  templateUrl: './operator-panel.component.html',
  styleUrls: ['./operator-panel.component.css'],
})
export class OperatorPanelComponent {

  @Input() selectedOperators: string[] = [];
  @Input() selectedAlgorithm!: string;
  @Input() params!: {
    maxIterations: number;
    numRestarts: number;
    insertionInterval: number;
    maxShift: number;
    maxExecutionSeconds: number;
  };
  @Input() algorithms: { key: string; label: string }[] = [];
  @Input() availableOperators: { key: string; label: string; icon: string; color: string; description: string }[] = [];
  @Input() isRunning = false;

  @Output() operatorToggle  = new EventEmitter<string>();
  @Output() algorithmChange = new EventEmitter<string>();
  @Output() runClicked      = new EventEmitter<void>();
  @Output() stopClicked     = new EventEmitter<void>();

  isSelected(key: string): boolean {
    return this.selectedOperators.includes(key);
  }

  toggle(key: string): void {
    this.operatorToggle.emit(key);
  }
}
