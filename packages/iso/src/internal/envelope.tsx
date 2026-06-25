import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useContext } from 'preact/hooks';
import type { WrapperProps } from '../page.js';
import { LoaderIdContext } from './contexts.js';

/** What the `data-loader` hydration attribute carries. Discriminated + extensible. */
export type HydrationAnchor =
  | { kind: 'none' }
  | { kind: 'data'; value: unknown };

type EnvelopeProps = {
  as?: ComponentType<WrapperProps> | keyof JSX.IntrinsicElements;
  anchor: HydrationAnchor;
  children: ComponentChildren;
};

export const Envelope: FunctionComponent<EnvelopeProps> = ({
  as = 'section',
  anchor,
  children,
}) => {
  const id = useContext(LoaderIdContext);
  if (!id) throw new Error('<Envelope> must be inside a <Loader>');

  // Coerce undefined -> null so JSON.stringify(undefined) never reaches the wire.
  const dataLoader =
    anchor.kind === 'data' ? JSON.stringify(anchor.value ?? null) : 'null';

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
