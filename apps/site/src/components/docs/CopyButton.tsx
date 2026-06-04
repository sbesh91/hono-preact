import { useState } from 'preact/hooks';

interface CopyButtonProps {
  // A static string to copy, or a getter resolved at click time (used by
  // CodeTabs to read the highlighted block's text out of the DOM).
  text?: string;
  getText?: () => string;
  class?: string;
}

// Copies text to the clipboard and flips its label to "Copied" briefly.
// Clipboard access is client-only; the handler runs on click, so SSR is safe.
export function CopyButton({
  text,
  getText,
  class: className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = () => {
    const value = getText ? getText() : (text ?? '');
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      class={className}
      onClick={onClick}
      aria-label="Copy code to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
