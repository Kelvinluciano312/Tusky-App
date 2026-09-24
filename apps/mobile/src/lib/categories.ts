/**
 * The category tree: groups (parent_id null) and their children. Pure, with
 * type-only imports, so `node --test` runs it with no bundler (Node strips the
 * types). Anything the picker, Budgets and Reports need to know about groups
 * lives here.
 */
import type { Budget, Category } from '@/lib/queries';

export type CategoriesById = Map<string, Category>;
export type CategoryNode = Category & { children: Category[] };

const bySortOrder = (a: Category, b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/** Groups in sort_order, each holding its children in sort_order. A child whose group is missing is dropped. */
export function buildTree(categories: Category[]): CategoryNode[] {
  const groups = new Map<string, CategoryNode>();
  for (const c of categories) if (c.parent_id === null) groups.set(c.id, { ...c, children: [] });
  for (const c of categories) if (c.parent_id !== null) groups.get(c.parent_id)?.children.push(c);
  for (const group of groups.values()) group.children.sort(bySortOrder);
  return [...groups.values()].sort(bySortOrder);
}

/**
 * A group's own id, or a child's group. An id we do not know — say, a
 * category cache from before a migration — maps to itself, so it is kept and
 * counted rather than lost.
 */
export function groupIdOf(id: string, byId: CategoriesById): string {
  return byId.get(id)?.parent_id ?? id;
}

/** Per-category amounts summed per group: each group's own rows plus its children's. */
export function rollupByGroup(amounts: Map<string, number>, byId: CategoriesById): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, amount] of amounts) {
    const groupId = groupIdOf(id, byId);
    out.set(groupId, (out.get(groupId) ?? 0) + amount);
  }
  return out;
}

/**
 * The budgets a new budget on `categoryId` replaces, so that a group and its
 * children are never budgeted at once and nothing counts twice. Setting a
 * group's replaces its children's; setting a child's replaces its group's. A
 * sibling's never.
 */
export function budgetsReplacedBy(categoryId: string, budgets: Budget[], byId: CategoriesById): Budget[] {
  const category = byId.get(categoryId);
  if (!category) return [];
  if (category.parent_id === null) {
    return budgets.filter((b) => byId.get(b.category_id)?.parent_id === categoryId);
  }
  return budgets.filter((b) => b.category_id === category.parent_id);
}

const KIND_ORDER: Category['kind'][] = ['expense', 'income', 'transfer'];

/** The picker's sections: expense groups first, then income, then transfers. Empty kinds are dropped. */
export function sectionsByKind(tree: CategoryNode[]): { kind: Category['kind']; groups: CategoryNode[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, groups: tree.filter((g) => g.kind === kind) })).filter(
    (s) => s.groups.length > 0,
  );
}

/**
 * The tree minus hidden categories, for the picker and Budgets' suggestions. A
 * hidden group takes its children with it. `keepId` survives regardless, with
 * its group, because the picker's current selection must stay visible and
 * checked.
 */
export function withoutHidden(tree: CategoryNode[], keepId: string | null): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const group of tree) {
    const children = group.children.filter((c) => c.id === keepId || (!c.hidden && !group.hidden));
    if (!group.hidden || group.id === keepId || children.length > 0) out.push({ ...group, children });
  }
  return out;
}

/** The picker's sections: hidden categories dropped, except the current selection. */
export function pickerSections(tree: CategoryNode[], { selectedId }: { selectedId: string | null }) {
  return sectionsByKind(withoutHidden(tree, selectedId));
}

/** A category name as stored: trimmed, 1–40 characters, as the database checks. Null when invalid. */
export function validateCategoryName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 40 ? name : null;
}

/**
 * A built-in's edit as an override patch: only the fields that changed, so a
 * colour change does not also pin today's name.
 */
export function changedFields(
  category: Category,
  edits: { name: string; color: string },
): { name?: string; color?: string } {
  const patch: { name?: string; color?: string } = {};
  if (edits.name !== category.name) patch.name = edits.name;
  if (edits.color !== category.color) patch.color = edits.color;
  return patch;
}

/** The delete confirmation's body. */
export function deleteCategoryMessage(count: number, groupName: string, hasBudget: boolean): string {
  const moves =
    count === 0 ? 'It has no transactions' : `Moves its ${count} transaction${count === 1 ? '' : 's'} to ${groupName}`;
  return `${moves}${hasBudget ? ', and removes its budget' : ''}.`;
}

/** Colour choices: the seeded group colours (category colours are data, not theme). */
export const SWATCHES = [
  '#55C084', '#94A198', '#E07856', '#D9A441', '#4E9BD1', '#A97ACD', '#D96BA0', '#46B3A8',
  '#E05A5A', '#C98BB8', '#8C9F5B', '#7C8BA1', '#B5784B', '#9A8C7A', '#6F8FA6',
];

/** Icon choices for a custom category; every name exists in the installed lucide-react-native. */
export const CUSTOM_ICONS = [
  'Tag', 'ShoppingBag', 'Coffee', 'Utensils', 'Car', 'House', 'Heart', 'Gift',
  'Plane', 'Music', 'Book', 'Dumbbell', 'PawPrint', 'Baby', 'Briefcase', 'GraduationCap',
  'Wrench', 'Smartphone', 'Shirt', 'Gamepad2', 'Camera', 'Leaf', 'Star', 'Wallet',
];
