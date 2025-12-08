import { marked } from 'marked';

// Configure marked for our use case
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

export function markdownToHtml(markdown: string): string {
  // Handle empty content
  if (!markdown.trim()) {
    return '<p></p>';
  }

  const html = marked.parse(markdown, { async: false }) as string;

  // Fix empty list items that cause TipTap/ProseMirror schema errors.
  // When streaming markdown, partial lists like "-" produce <li></li> which
  // violates ProseMirror's listItem content rules.
  // Insert a <br> placeholder to satisfy the schema.
  const fixedHtml = html.replace(/<li><\/li>/g, '<li><br></li>');

  return fixedHtml;
}
