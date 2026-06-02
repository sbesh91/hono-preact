import { useEffect, useState } from 'preact/hooks';
import { Monitor, Moon, Sun } from 'lucide-preact';

type ThemeChoice = 'system' | 'light' | 'dark';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const NEXT_LABELS = {
  system: 'Switch to light theme',
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
} as const;

function readStored(): ThemeChoice {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const el = document.documentElement;
  try {
    if (choice === 'system') {
      el.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    } else {
      el.setAttribute('data-theme', choice);
      localStorage.setItem('theme', choice);
    }
  } catch {
    // storage unavailable; the attribute change alone still applies
    if (choice === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', choice);
  }
}

export function ThemeToggle() {
  // Server can't know the user's choice, so start at 'system' and sync on mount.
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    setChoice(readStored());
  }, []);

  const cycle = () => {
    const nextChoice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    apply(nextChoice);
    setChoice(nextChoice);
  };

  const Icon = ICONS[choice];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={NEXT_LABELS[choice]}
      title={NEXT_LABELS[choice]}
      class="flex items-center justify-center h-8 w-8 rounded text-muted hover:text-foreground hover:bg-foreground/10"
    >
      <Icon size={18} />
    </button>
  );
}
