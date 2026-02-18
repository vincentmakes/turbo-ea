import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";

interface Props {
  children: ReactNode;
  /** Compact inline fallback (e.g. for a single field or section) */
  inline?: boolean;
  /** Label shown in the fallback UI */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors in children and shows a fallback instead of
 * crashing the entire page. Use `inline` for small sections.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ""}]`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.inline) {
      return (
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            color: "error.main",
            fontSize: "0.8rem",
          }}
        >
          <Typography variant="caption" color="error">
            Failed to render{this.props.label ? ` ${this.props.label}` : ""}
          </Typography>
          <Button size="small" onClick={this.handleReset} sx={{ minWidth: 0, fontSize: "0.7rem", textTransform: "none" }}>
            Retry
          </Button>
        </Box>
      );
    }

    return (
      <Box
        sx={{
          p: 2,
          border: "1px solid",
          borderColor: "error.light",
          borderRadius: 1,
          bgcolor: "error.lighter",
        }}
      >
        <Typography variant="subtitle2" color="error" gutterBottom>
          Something went wrong{this.props.label ? ` in "${this.props.label}"` : ""}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="pre" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
          {this.state.error?.message}
        </Typography>
        <Button size="small" variant="outlined" color="error" onClick={this.handleReset}>
          Retry
        </Button>
      </Box>
    );
  }
}
