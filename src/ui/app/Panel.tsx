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
 * Whether a body is a unified diff.
 *
 * Decided for the whole body rather than per line, because plenty of ordinary prose begins a line
 * with a dash, and colouring a bullet list as deletions is worse than leaving a diff grey.
 */
export function looksLikeDiff(body: string): boolean {
  return /^--- a\/.+\n\+\+\+ b\//m.test(body);
}

function diffColor(line: string): { color: string; dim: boolean } {
  if (line.startsWith("+++") || line.startsWith("---")) return { color: theme.muted, dim: true };
  if (line.startsWith("+")) return { color: theme.added, dim: false };
  if (line.startsWith("-")) return { color: theme.removed, dim: false };
  return { color: theme.muted, dim: false };
}

/**
 * Renders pre-formatted document text. Presentation modules already emit ANSI colour, so the lines
 * are passed through untouched — except a diff, whose meaning is carried entirely by a leading
 * character that is easy to miss and cheap to colour.
 */
export function PanelBody({ body }: { body: string }) {
  const diff = looksLikeDiff(body);
  return (
    <>
      {body.split("\n").map((line, index) => {
        const style = diff ? diffColor(line) : { color: theme.text, dim: false };
        return (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: document lines are positional and static
            key={index}
            backgroundColor={theme.surfaceRaised}
            color={style.color}
            dimColor={style.dim}
            // A wrapped diff line puts its continuation under the wrong marker, so the second half
            // reads as context when it is an addition. Losing the tail is the lesser harm.
            wrap={diff ? "truncate-end" : "wrap"}
          >
            {line || " "}
          </Text>
        );
      })}
    </>
  );
}
