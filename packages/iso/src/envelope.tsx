import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useContext } from 'preact/hooks';
import { isBrowser } from './is-browser.js';
import type { WrapperProps } from './page.js';
import { LoaderDataContext, LoaderIdContext } from './contexts.js';

type EnvelopeProps = {
  as?: ComponentType<WrapperProps> | keyof JSX.IntrinsicElements;
  children: ComponentChildren;
};

export const Envelope: FunctionComponent<EnvelopeProps> = ({
  as = 'section',
  children,
}) => {
  const id = useContext(LoaderIdContext);
  const ctx = useContext(LoaderDataContext);
  if (!id || !ctx)
    throw new Error('<Envelope> must be inside a <Loader>');

  // Coerce undefined → null so JSON.stringify(undefined) (which returns
  // undefined and serializes as the literal string "undefined") never
  // reaches the wire. Loaders that return undefined should hydrate to null.
  const dataLoader = isBrowser() ? 'null' : JSON.stringify(ctx.data ?? null);

  if (typeof as === 'string') {
    const Tag = as as keyof JSX.IntrinsicElements;
    const props = { id, 'data-loader': dataLoader } as JSX.HTMLAttributes;
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Tag {...(props as any)}>{children}</Tag>
    );
  }
  const Wrapper = as as ComponentType<WrapperProps>;
  return (
    <Wrapper id={id} data-loader={dataLoader}>
      {children}
    </Wrapper>
  );
};
