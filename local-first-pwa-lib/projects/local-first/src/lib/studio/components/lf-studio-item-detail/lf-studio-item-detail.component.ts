import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'lf-studio-item-detail',
  templateUrl: './lf-studio-item-detail.component.html',
  styleUrls: ['./lf-studio-item-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LfStudioItemDetailComponent {
  @Input() itemJson: string = '';
}
