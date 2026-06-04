import { useState } from 'preact/hooks';

interface CopyButtonProps {
  text: string;
  class?: string;
}

// Copies `text` to the clipboard and flips its label to "Copied" briefly.
// Clipboard access is client-only; the handler runs on click, so SSR is safe.
export function CopyButton({ text, class: className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = () => {
    void navigator.clipboard?.writeText(text).then(() => {
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
