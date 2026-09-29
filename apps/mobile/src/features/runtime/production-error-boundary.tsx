import {
  Component,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  Pressable,
  Text,
  View,
} from "react-native";

type State = {
  failed: boolean;
};

export class ProductionErrorBoundary
  extends Component<
    PropsWithChildren,
    State
  > {
  state: State = {
    failed: false,
  };

  static getDerivedStateFromError() {
    return {
      failed: true,
    };
  }

  componentDidCatch(
    error: Error,
    _info: ErrorInfo,
  ) {
    console.error(
      "[TINDIO_RUNTIME_ERROR]",
      error.name,
    );
  }

  private retry = () => {
    this.setState({
      failed: false,
    });
  };

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <Text>
          TINDIO encountered an unexpected application error.
        </Text>

        <Text>
          Existing locally saved transactions are not cleared by this screen.
        </Text>

        <Pressable
          onPress={this.retry}
        >
          <Text>
            Retry application
          </Text>
        </Pressable>
      </View>
    );
  }
}