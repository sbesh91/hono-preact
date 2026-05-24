import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useContext } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import type { WrapperProps } from '../page.js';
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
  if (!id || !ctx) throw new Error('<Envelope> must be inside a <Loader>');

  // Coerce undefined → null so JSON.stringify(undefined) (which returns
  // undefined and serializes as the literal string "undefined") never
  // reaches the wire. Loaders that return undefined should hydrate to null.
  const dataLoader = isBrowser() ? 'null' : JSON.stringify(ctx.data ?? null);

  if (typeof as === 'string') {
    const Tag = as;
    return (
      <Tag id={id} data-loader={dataLoader}>
        {children}
      </Tag>
    );
  }
  const Wrapper = as;
  return (
    <Wrapper id={id} data-loader={dataLoader}>
      {children}
    </Wrapper>
  );
};
