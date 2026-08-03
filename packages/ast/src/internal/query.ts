import ts from "typescript";
import type { AstQueryApi } from "../api/query.js";
import type { AstComment, SourceLocation } from "../api/types.js";
import { traversalApi } from "./traversal.js";

export const queryApi: AstQueryApi = {
  getLocation(sourceFile, node) {
    const start = safeGetStart(sourceFile, node);
    const end = clampPos(sourceFile, node.end);
    const startLc = sourceFile.getLineAndCharacterOfPosition(start);
    const endLc = sourceFile.getLineAndCharacterOfPosition(end);
    return {
      start,
      end,
      startLine: startLc.line + 1,
      startCharacter: startLc.character + 1,
      endLine: endLc.line + 1,
      endCharacter: endLc.character + 1,
    } satisfies SourceLocation;
  },

  getNodeAtPosition(sourceFile, position) {
    // end is exclusive — position == sourceFile.end is EOF, still valid for SourceFile
    if (position < 0 || position > sourceFile.end) {
      return undefined;
    }
    if (position === sourceFile.end) {
      return sourceFile;
    }

    let match: ts.Node = sourceFile;
    const visit = (node: ts.Node): void => {
      const start = safeGetStart(sourceFile, node);
      // [start, end) containment
      if (position < start || position >= node.end) {
        return;
      }
      match = node;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return match;
  },

  getNodesInRange(sourceFile, start, end) {
    if (end < start) {
      return [];
    }
    return traversalApi.findAll(sourceFile, (node) => {
      if (node === sourceFile) {
        return false;
      }
      const nodeStart = safeGetStart(sourceFile, node);
      return nodeStart >= start && node.end <= end;
    });
  },

  getLeadingComments(sourceFile, node) {
    const ranges =
      ts.getLeadingCommentRanges(sourceFile.text, node.pos) ?? [];
    return ranges.map((range) => toComment(sourceFile.text, range));
  },

  getTrailingComments(sourceFile, node) {
    const ranges =
      ts.getTrailingCommentRanges(sourceFile.text, node.end) ?? [];
    return ranges.map((range) => toComment(sourceFile.text, range));
  },

  getAllComments(sourceFile) {
    return collectAllComments(sourceFile);
  },

  getText(sourceFile, node) {
    return node.getText(sourceFile);
  },

  isKind<T extends ts.SyntaxKind>(
    node: ts.Node,
    kind: T,
  ): node is Extract<ts.Node, { kind: T }> {
    return node.kind === kind;
  },

  matchKinds(root, kinds) {
    if (kinds.length === 0) {
      return [];
    }
    if (kinds.length === 1) {
      const kind = kinds[0]!;
      return traversalApi.findAll(root, (node) => node.kind === kind);
    }
    const kindSet = new Set(kinds);
    return traversalApi.findAll(root, (node) => kindSet.has(node.kind));
  },
};

/**
 * Single-pass comment collection via scanner (complete + O(n) in source length).
 * Avoids per-node leading/trailing scans over the full tree.
 */
function collectAllComments(sourceFile: ts.SourceFile): AstComment[] {
  const text = sourceFile.text;
  const comments: AstComment[] = [];

  const shebang = ts.getShebang(text);
  if (shebang) {
    comments.push({
      kind: "hashbang",
      text: shebang,
      fullText: shebang,
      start: 0,
      end: shebang.length,
      hasTrailingNewLine: true,
    });
  }

  const scanner = ts.createScanner(
    sourceFile.languageVersion,
    /* skipTrivia */ false,
    sourceFile.languageVariant,
    text,
  );

  if (shebang) {
    scanner.setTextPos(shebang.length);
  }

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const pos = scanner.getTokenPos();
      const end = scanner.getTextPos();
      comments.push(
        toComment(text, {
          kind: token,
          pos,
          end,
          hasTrailingNewLine:
            end < text.length &&
            (text.charCodeAt(end) === 10 ||
              text.charCodeAt(end) === 13),
        }),
      );
    }
    token = scanner.scan();
  }

  return comments;
}

function toComment(text: string, range: ts.CommentRange): AstComment {
  const fullText = text.slice(range.pos, range.end);
  const kind: AstComment["kind"] =
    range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block";

  let body = fullText;
  if (kind === "line") {
    body = fullText.replace(/^\/\//, "");
  } else {
    body = fullText.replace(/^\/\*/, "").replace(/\*\/$/, "");
  }

  return {
    kind,
    text: body,
    fullText,
    start: range.pos,
    end: range.end,
    hasTrailingNewLine: range.hasTrailingNewLine === true,
  };
}

function safeGetStart(sourceFile: ts.SourceFile, node: ts.Node): number {
  try {
    return clampPos(sourceFile, node.getStart(sourceFile, false));
  } catch {
    return clampPos(sourceFile, node.pos);
  }
}

function clampPos(sourceFile: ts.SourceFile, pos: number): number {
  if (pos < 0) {
    return 0;
  }
  if (pos > sourceFile.text.length) {
    return sourceFile.text.length;
  }
  return pos;
}
