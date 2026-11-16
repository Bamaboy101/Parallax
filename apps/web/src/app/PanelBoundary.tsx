import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Widget title, for the message. */
  title: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps a failing widget inside its own panel: the rest of the terminal keeps running. */
export class PanelBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.title} panel failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        className="grid h-full place-content-center gap-2 bg-panel p-(--pad) text-center"
        role="alert"
      >
        <p className="text-ui text-text">{this.props.title} stopped working.</p>
        <p className="text-label text-muted">{error.message}</p>
        <button
          type="button"
          className="settings-button justify-self-center"
          onClick={() => {
            this.setState({ error: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
