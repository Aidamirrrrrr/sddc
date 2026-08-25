import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { theme } from "../theme";

/**
 * A filled surface rather than a bordered box.
 *
 * The background is painted on the Box and every child sets its own foreground, so the panel stays
 * readable whatever theme the surrounding terminal uses.
 */
export function Panel({
  title,
  accentColor = theme.accent,
  children,
}: {
  title?: string;
  accentColor?: string;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {title ? (
        <Box>
          <Text backgroundColor={accentColor} color={theme.surface} bold>
            {` ${title} `}
          </Text>
        </Box>
      ) : null}
      <Box
        flexDirection="column"
        backgroundColor={theme.surfaceRaised}
        paddingX={2}
        paddingY={title ? 0 : 1}
      >
        {children}
      </Box>
    </Box>
  );
}

/** Body text inside a panel: every line carries the panel foreground explicitly. */
export function PanelText({
  children,
  color = theme.text,
  dim = false,
}: {
  children: ReactNode;
  color?: string;
  dim?: boolean;
}) {
  return (
    <Text color={color} dimColor={dim} backgroundColor={theme.surfaceRaised}>
      {children}
    </Text>
  );
}

/**
 * Renders pre-formatted document text. Presentation modules already emit ANSI colour, so the lines
 * are passed through untouched rather than re-styled.
 */
export function PanelBody({ body }: { body: string }) {
  return (
    <>
      {body.split("\n").map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: document lines are positional and static
        <Text key={index} backgroundColor={theme.surfaceRaised} color={theme.text}>
          {line || " "}
        </Text>
      ))}
    </>
  );
}
