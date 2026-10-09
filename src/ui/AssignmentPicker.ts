import * as vscode from 'vscode';
import { AssignmentWithSubmission, AssignmentPickerItem } from '../classroom/types.js';

/**
 * AssignmentPicker
 *
 * Provides the interactive VS Code QuickPick interface for discovering
 * and selecting Google Classroom assignments.
 */
export class AssignmentPicker {
  /**
   * Prompts the user to pick an assignment from a list of assignments with submission status.
   * Returns the selected AssignmentWithSubmission or undefined if cancelled.
   */
  public async promptAssignmentSelection(
    assignments: AssignmentWithSubmission[],
    courseName?: string,
  ): Promise<AssignmentWithSubmission | undefined> {
    if (assignments.length === 0) {
      const courseTitle = courseName ? ` in "${courseName}"` : '';
      await vscode.window.showInformationMessage(
        `Classroom Submit: No active assignments found${courseTitle}.`,
        'OK',
      );
      return undefined;
    }

    const items: Array<vscode.QuickPickItem & { assignment: AssignmentWithSubmission }> =
      assignments.map((assignment) => {
        const pickerItem = AssignmentPicker.createPickerItem(assignment);

        const item: vscode.QuickPickItem & { assignment: AssignmentWithSubmission } = {
          label: pickerItem.label,
          assignment,
        };

        if (pickerItem.description) {
          item.description = pickerItem.description;
        }

        if (pickerItem.detail) {
          item.detail = pickerItem.detail;
        }

        return item;
      });

    const titlePrefix = courseName ? `${courseName} — ` : '';
    const selected = await vscode.window.showQuickPick(items, {
      title: `${titlePrefix}Select Assignment`,
      placeHolder: 'Search assignment by title, due date, or status…',
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });

    return selected?.assignment;
  }

  /**
   * Pure formatter: builds the label, description, and detail for an assignment item.
   */
  public static createPickerItem(item: AssignmentWithSubmission): AssignmentPickerItem {
    const { courseWork, formattedDue, statusLabel, submissionStatus, dueStatus } = item;

    // Status icon
    let statusIcon: string;
    switch (submissionStatus) {
      case 'TURNED_IN':
        statusIcon = '$(check)';
        break;
      case 'RETURNED':
        statusIcon = '$(pass)';
        break;
      case 'RECLAIMED':
        statusIcon = '$(history)';
        break;
      case 'NOT_SUBMITTED':
      default:
        statusIcon = dueStatus === 'OVERDUE' ? '$(alert)' : '$(circle-large-outline)';
        break;
    }

    const label = `${statusIcon} ${courseWork.title}`;

    // Description: Due date summary
    let description = `Due: ${formattedDue}`;
    if (dueStatus === 'OVERDUE' && submissionStatus === 'NOT_SUBMITTED') {
      description = `⚠️ Overdue • Due: ${formattedDue}`;
    } else if (dueStatus === 'DUE_TODAY') {
      description = `⏳ Due Today • ${formattedDue}`;
    }

    // Detail: Status + Points + Short description preview
    const parts: string[] = [`Status: ${statusLabel}`];
    if (courseWork.maxPoints !== undefined && courseWork.maxPoints > 0) {
      parts.push(`${courseWork.maxPoints} pts`);
    }
    if (courseWork.description && courseWork.description.trim()) {
      const cleanDesc = courseWork.description.replace(/\s+/g, ' ').trim();
      const truncated = cleanDesc.length > 80 ? `${cleanDesc.substring(0, 77)}…` : cleanDesc;
      parts.push(truncated);
    }

    return {
      label,
      description,
      detail: parts.join(' • '),
      assignment: item,
    };
  }
}
