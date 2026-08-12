import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.scss';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in ANYA LABS UI:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.screen}>
          <p className={styles.title}>Something went wrong</p>
          <p className={styles.subtitle}>This side of ANYA LABS hit a snag. Try again.</p>
          <button type="button" className={styles.retry} onClick={this.handleRetry}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
