/**
 * Loads views/tasks-model.js (a plain browser script with no module system)
 * and returns its `TasksModel` namespace. Shared by the tasks-* GUI tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

export const PUBLIC_DIR = join(__dirname, '../../gui/public');

export function loadTasksModel(): any {
  const source = readFileSync(join(PUBLIC_DIR, 'views/tasks-model.js'), 'utf-8');
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(`${source}\n;this.__model = TasksModel;`, sandbox);
  return sandbox.__model;
}
