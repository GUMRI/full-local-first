import { Component, Input, signal, WritableSignal, computed, ChangeDetectionStrategy } from '@angular/core';
import { ListRef, Item } from '../../../types'; // Path should be correct

@Component({
  selector: 'lf-studio-main',
  templateUrl: './lf-studio-main.component.html',
  styleUrls: ['./lf-studio-main.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LfStudioMainComponent {
  @Input() listRefs: ListRef<any, any>[] = [];

  selectedListRefIndex: WritableSignal<number | null> = signal(null);

  selectedListRef = computed(() => {
    const idx = this.selectedListRefIndex();
    return (idx !== null && this.listRefs && this.listRefs[idx]) ? this.listRefs[idx] : null;
  });

  showItemDetailModal: WritableSignal<boolean> = signal(false);
  itemDetailJson: WritableSignal<string> = signal('');

  constructor() {}

  onListSelectionChange(event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const newIndex = parseInt(selectElement.value, 10);
    this.selectedListRefIndex.set(isNaN(newIndex) ? null : newIndex);
  }

  openItemDetailModal(item: Item<any, any>): void {
    this.itemDetailJson.set(JSON.stringify(item, null, 2));
    this.showItemDetailModal.set(true);
  }

  closeItemDetailModal(): void {
    this.showItemDetailModal.set(false);
    this.itemDetailJson.set('');
  }
}
