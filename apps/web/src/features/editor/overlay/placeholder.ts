/**
 * The sample text an empty slot shows in step 1 so its font, size and
 * wrapping can be judged before anything is written: "Your Date here…".
 * A hint only -- never stored, never rendered into the PDF.
 */
export function placeholderText(name: string): string {
  const trimmed = name.trim()
  return `Your ${trimmed || 'text'} here…`
}
