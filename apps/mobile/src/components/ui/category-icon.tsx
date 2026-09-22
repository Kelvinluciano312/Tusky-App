import * as Icons from 'lucide-react-native';
import { createElement } from 'react';

/** Resolve a stored lucide icon name, falling back so a bad seed never crashes a row. */
export function categoryIcon(name: string | undefined): Icons.LucideIcon {
  if (!name) return Icons.CircleDashed;
  return (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.CircleDashed;
}

type Props = {
  /** Icon name as stored on the category row. */
  name: string | undefined;
  size: number;
  color: string;
};

/**
 * Renders a category's icon by name. Uses createElement rather than binding the
 * resolved component to a local and rendering `<Icon />`, which the React
 * Compiler lint (react-hooks/static-components) rejects as creating a component
 * during render.
 */
export function CategoryIcon({ name, size, color }: Props) {
  return createElement(categoryIcon(name), { size, color, strokeWidth: 1.75 });
}
