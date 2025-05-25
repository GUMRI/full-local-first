import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox'; // For boolean fields
import { MatDatepickerModule } from '@angular/material/datepicker'; // For dateTime fields
import { MatNativeDateModule } from '@angular/material/core';      // For MatDatepicker
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { ListOptions, FieldType } from '../../models/list.model'; // Adjust path if needed

export interface AddItemDialogData {
  listOptions: ListOptions<any>;
}

@Component({
  selector: 'app-add-item-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule
  ],
  template: `
    <h2 mat-dialog-title>Add New Item to '{{ data.listOptions.name }}'</h2>
    <mat-dialog-content>
      <form [formGroup]="itemForm" (ngSubmit)="onSubmit()">
        <div *ngFor="let field of formFields" class="form-field-container">
          <mat-form-field appearance="outline" *ngIf="isTextType(field.type)">
            <mat-label>{{ field.key }}</mat-label>
            <input matInput [formControlName]="field.key" [type]="field.type === 'number' ? 'number' : 'text'">
          </mat-form-field>

          <mat-checkbox *ngIf="field.type === 'boolean'" [formControlName]="field.key" class="form-checkbox">
            {{ field.key }}
          </mat-checkbox>

          <mat-form-field appearance="outline" *ngIf="field.type === 'dateTime'">
            <mat-label>{{ field.key }}</mat-label>
            <input matInput [matDatepicker]="picker" [formControlName]="field.key">
            <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
            <mat-datepicker #picker></mat-datepicker>
          </mat-form-field>
          
          <!-- Add placeholders or simple inputs for other types like 'file', 'object', 'array' -->
          <mat-form-field appearance="outline" *ngIf="isOtherSimpleType(field.type)">
             <mat-label>{{ field.key }} ({{ field.type }})</mat-label>
             <input matInput [formControlName]="field.key" placeholder="Enter JSON or ID">
          </mat-form-field>

        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onNoClick()">Cancel</button>
      <button mat-raised-button color="primary" [disabled]="!itemForm.valid" (click)="onSubmit()">Add Item</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form-field-container { margin-bottom: 10px; }
    .form-checkbox { margin-top: 10px; margin-bottom: 10px; display: block; }
    mat-form-field { width: 100%; }
  `]
})
export class AddItemDialogComponent implements OnInit {
  itemForm!: FormGroup;
  formFields: { key: string; type: FieldType; required?: boolean }[] = [];

  constructor(
    public dialogRef: MatDialogRef<AddItemDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AddItemDialogData
  ) {}

  ngOnInit(): void {
    const group: any = {};
    for (const key in this.data.listOptions.fields) {
      if (Object.prototype.hasOwnProperty.call(this.data.listOptions.fields, key)) {
        const fieldType = this.data.listOptions.fields[key];
        // For this POC, let's make all fields optional in the form, or add simple required validator.
        // More complex validation would come from listOptions.
        const isRequired = this.data.listOptions.uniqueFields?.includes(key); // Example: unique fields are required
        
        this.formFields.push({ key, type: fieldType, required: isRequired });
        group[key] = new FormControl(this.getDefaultValue(fieldType), isRequired ? Validators.required : null);
      }
    }
    this.itemForm = new FormGroup(group);
  }

  private getDefaultValue(type: FieldType): any {
    switch (type) {
      case 'number': return 0;
      case 'boolean': return false;
      case 'dateTime': return null; // Or new Date()
      case 'array': return [];
      case 'object': case 'map': return {};
      default: return '';
    }
  }

  isTextType(type: FieldType): boolean {
    return type === 'text' || type === 'longText' || type === 'number'; // Number input is type text for matInput styling
  }
  
  isOtherSimpleType(type: FieldType): boolean {
    return type === 'file' || type === 'object' || type === 'array' || type === 'map' || type === 'population' || type === 'populations';
  }


  onNoClick(): void {
    this.dialogRef.close();
  }

  onSubmit(): void {
    if (this.itemForm.valid) {
      const rawValue = this.itemForm.getRawValue();
      // Process values (e.g., convert date to ISO string)
      for (const field of this.formFields) {
        if (field.type === 'dateTime' && rawValue[field.key] instanceof Date) {
          rawValue[field.key] = (rawValue[field.key] as Date).toISOString();
        }
        if (field.type === 'number' && typeof rawValue[field.key] === 'string') {
            rawValue[field.key] = parseFloat(rawValue[field.key]);
        }
      }
      this.dialogRef.close(rawValue);
    }
  }
}
