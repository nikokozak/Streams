import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for our use case
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

// Configure DOMPurify with allowed tags for markdown content
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'del', 's', 'sup', 'sub',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'title', 'target'],
  ALLOW_DATA_ATTR: false,
};

export function markdownToHtml(markdown: string): string {
  // Handle empty content
  if (!markdown.trim()) {
    return '<p></p>';
  }

  const html = marked.parse(markdown, { async: false }) as string;

  // Sanitize to prevent XSS from LLM output
  const sanitized = DOMPurify.sanitize(html, SANITIZE_CONFIG);

  // Fix empty list items that cause TipTap/ProseMirror schema errors.
  // When streaming markdown, partial lists like "-" produce <li></li> which
  // violates ProseMirror's listItem content rules.
  // Insert a <br> placeholder to satisfy the schema.
  const fixedHtml = sanitized.replace(/<li><\/li>/g, '<li><br></li>');

  return fixedHtml;
}
