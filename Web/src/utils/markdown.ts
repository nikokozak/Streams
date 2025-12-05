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
  return html;
}
