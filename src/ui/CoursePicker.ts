import * as vscode from 'vscode';
import { Course } from '../types/index.js';
import { CoursePickerItem } from '../classroom/types.js';

/**
 * CoursePicker
 *
 * Provides the interactive VS Code QuickPick interface for choosing
 * a Google Classroom course.
 */
export class CoursePicker {
  /**
   * Prompts the user to pick a course from a list of Google Classroom courses.
   * Returns the selected Course or undefined if cancelled.
   */
  public async promptCourseSelection(
    courses: Course[],
  ): Promise<Course | undefined> {
    if (courses.length === 0) {
      const action = await vscode.window.showInformationMessage(
        'Classroom Submit: No active Google Classroom courses found for your account.',
        'Open Classroom in Browser',
        'Dismiss',
      );
      if (action === 'Open Classroom in Browser') {
        void vscode.env.openExternal(vscode.Uri.parse('https://classroom.google.com'));
      }
      return undefined;
    }

    const items: Array<vscode.QuickPickItem & { course: Course }> = courses.map((course) => {
      const isArchived = course.courseState === 'ARCHIVED';
      const icon = isArchived ? '$(archive)' : '$(mortar-board)';

      let description = course.section ?? '';
      if (course.room) {
        description = description ? `${description} • Room: ${course.room}` : `Room: ${course.room}`;
      }

      const item: vscode.QuickPickItem & { course: Course } = {
        label: `${icon} ${course.name}`,
        course,
      };

      if (description) {
        item.description = description;
      }

      if (course.descriptionHeading) {
        item.detail = isArchived ? `[Archived] ${course.descriptionHeading}` : course.descriptionHeading;
      } else if (isArchived) {
        item.detail = '[Archived]';
      }

      return item;
    });

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select Google Classroom Course',
      placeHolder: 'Search course by name, section, or subject…',
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });

    return selected?.course;
  }

  /**
   * Formats a Course into a CoursePickerItem structure (for testing & decoupled logic).
   */
  public static createPickerItem(course: Course): CoursePickerItem {
    const isArchived = course.courseState === 'ARCHIVED';
    const icon = isArchived ? '$(archive)' : '$(mortar-board)';

    return {
      label: `${icon} ${course.name}`,
      description: course.section,
      detail: course.descriptionHeading,
      course,
    };
  }
}
