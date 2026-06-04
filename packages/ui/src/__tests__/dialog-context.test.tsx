// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { useDialogContext } from '../dialog/context.js';

function Consumer() {
  // Calling outside a provider must throw a clear, named error.
  useDialogContext('Trigger');
  return null;
}

describe('useDialogContext', () => {
  it('throws a part-named error when used outside Dialog.Root', () => {
    expect(() => render(<Consumer />)).toThrow(
      /<Dialog\.Trigger> must be used within <Dialog\.Root>/
    );
  });
});
