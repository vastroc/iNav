export interface CategoryIconGroup {
  label: string;
  icons: string[];
}

export const CATEGORY_ICON_GROUPS: CategoryIconGroup[] = [
  { label: "开发", icons: ["code", "terminal", "git-branch", "git-pull-request", "database", "server", "cloud", "cpu", "bug", "braces", "webhook", "package", "container", "workflow", "network", "shield", "lock", "key"] },
  { label: "设计", icons: ["palette", "pen-tool", "type", "image", "layout", "shapes", "frame", "brush", "swatch-book", "component", "ruler", "pipette", "paintbrush", "wand-sparkles", "move", "crop", "grid-2x2"] },
  { label: "内容", icons: ["book-open", "book", "book-marked", "library", "newspaper", "file-text", "file", "files", "file-code", "file-image", "notebook-pen", "sticky-note", "rss", "quote", "film", "megaphone", "mic", "video", "tv", "radio"] },
  { label: "效率", icons: ["briefcase", "calendar", "calendar-days", "check-square", "clipboard", "folder", "archive", "mail", "search", "inbox", "send", "download", "upload", "cloud-upload", "list-checks", "kanban", "timer", "alarm-clock", "target", "flag"] },
  { label: "生活", icons: ["coffee", "play", "music", "headphones", "speaker", "camera", "gamepad-2", "heart", "shopping-bag", "shopping-cart", "gift", "ticket", "utensils", "pizza", "apple", "dumbbell", "bike", "car", "plane", "train", "tent", "palmtree", "umbrella", "sun", "moon", "home"] },
  { label: "通用", icons: ["star", "bookmark", "globe", "link", "external-link", "layers", "grid-3x3", "compass", "sparkles", "zap", "settings", "tag", "hash", "at-sign", "bell", "eye", "filter", "sliders-horizontal", "refresh-cw", "repeat", "shuffle", "plus", "check", "x", "info", "circle-help", "smartphone", "monitor", "mouse-pointer"] },
];

export const CATEGORY_ICONS: Record<string, string> = Object.fromEntries(
  CATEGORY_ICON_GROUPS.flatMap((group) => group.icons.map((icon) => [icon, icon])),
);

export function categoryIcon(name: string, size = 15): string {
  const safeName = name in CATEGORY_ICONS ? name : "folder";
  return (
    '<svg class="cat-icon" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<use href="/category-icons.svg#icon-' + safeName + '"></use>' +
    "</svg>"
  );
}
